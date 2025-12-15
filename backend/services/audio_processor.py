import os
import json
import shutil
import tempfile
import time
from typing import List, Dict, Any, Optional
import psutil

from openai import OpenAI
from pydub import AudioSegment
from pydub.silence import split_on_silence

class AudioProcessor:
    def __init__(self):
        # API key should be in environment variables: OPENAI_API_KEY
        self.client = OpenAI()
        # Whisper API limit is 25MB. We'll target ~20MB chunks to be safe.
        # However, pydub works with duration.
        # MP3 128kbps is approx 1MB per minute. 20MB is ~20 mins.
        # Let's be conservative: 10 minutes chunks to be safe with various bitrates.
        self.CHUNK_TARGET_DURATION_MS = 10 * 60 * 1000  # 10 minutes
        self.FILE_SIZE_LIMIT_BYTES = 20 * 1024 * 1024   # 20 MB

    def transcribe(self, file_path: str) -> List[Any]:
        """
        Transcribes audio file using OpenAI Whisper API.
        Returns a list of segments with start, end, and text.
        """
        with open(file_path, "rb") as audio_file:
            transcript = self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json"
            )
        # The verbose_json response includes 'segments'
        return transcript.segments

    def transcribe_with_retry(self, file_path: str, max_retries: int = 3) -> List[Any]:
        """
        Transcribes a file with retry logic.
        """
        last_exception = None
        for attempt in range(max_retries):
            try:
                return self.transcribe(file_path)
            except Exception as e:
                last_exception = e
                print(f"Attempt {attempt + 1} failed for {file_path}: {e}")
                time.sleep(1) # wait a bit before retry

        print(f"All {max_retries} attempts failed for {file_path}")
        raise last_exception

    def _log_memory_usage(self, tag: str = ""):
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        print(f"[Memory Usage] {tag}: RSS={mem_info.rss / 1024 / 1024:.2f} MB")

    def process_large_file(self, file_path: str) -> List[Any]:
        """
        Splits a large file on silence and transcribes chunks sequentially.
        """
        temp_dir = tempfile.mkdtemp()
        all_segments = []
        total_duration_offset = 0.0

        try:
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            print(f"Processing large audio file: {file_path} (Size: {file_size_mb:.2f} MB)")
            self._log_memory_usage("Before loading audio")

            print(f"Loading large audio file: {file_path}")
            audio = AudioSegment.from_file(file_path)
            self._log_memory_usage("After loading audio")

            # 1. Split on silence
            # min_silence_len: minimum length of silence to be considered a split point (ms)
            # silence_thresh: loudness below which is considered silence (dBFS)
            # keep_silence: amount of silence to leave at the beginning/end of the chunks
            print("Splitting audio on silence...")
            # Using defaults that usually work well for speech: 1000ms silence, -40dBFS
            # We might want to make these configurable or robust
            segments_audio = split_on_silence(
                audio,
                min_silence_len=1000,
                silence_thresh=audio.dBFS - 16, # relative to average dBFS
                keep_silence=500,
                seek_step=100
            )
            self._log_memory_usage("After splitting audio")

            if not segments_audio:
                # If no silence found, fall back to simple chunking or just one chunk
                # Ideally, we should just process as one, but if it's too big, it will fail.
                # Let's assume if split_on_silence fails to find splits, we treat the whole as one,
                # but if it was > 25MB, we might need force split.
                # For now, let's treat the whole thing as one segment if splitting returned nothing.
                segments_audio = [audio]

            # 2. Group small segments into chunks of approx CHUNK_TARGET_DURATION_MS
            chunks_to_process = []
            current_chunk = AudioSegment.empty()

            for seg in segments_audio:
                if len(current_chunk) + len(seg) < self.CHUNK_TARGET_DURATION_MS:
                    current_chunk += seg
                else:
                    if len(current_chunk) > 0:
                        chunks_to_process.append(current_chunk)
                    current_chunk = seg

            if len(current_chunk) > 0:
                chunks_to_process.append(current_chunk)

            print(f"Audio split into {len(chunks_to_process)} chunks.")

            # 3. Process each chunk
            for i, chunk_audio in enumerate(chunks_to_process):
                chunk_filename = os.path.join(temp_dir, f"chunk_{i}.mp3")
                print(f"Exporting chunk {i} to {chunk_filename}")
                # Export as mp3 to save space/bandwidth
                # Use standard bitrate and mono to ensure compatibility with Whisper API
                chunk_audio.export(chunk_filename, format="mp3", bitrate="128k", parameters=["-ac", "1"])

                chunk_size = os.path.getsize(chunk_filename)
                print(f"Chunk {i} size: {chunk_size / (1024*1024):.2f} MB")

                if chunk_size == 0:
                    print(f"Error: Chunk {i} is empty (0 bytes). Skipping transcription for this chunk.")
                    continue

                # Check size just in case
                if chunk_size > 25 * 1024 * 1024:
                    print(f"Warning: Chunk {i} is larger than 25MB even after splitting.")
                    # In a real robust system, we would force-split this chunk further.

                print(f"Transcribing chunk {i}...")
                segments = self.transcribe_with_retry(chunk_filename)

                # 4. Adjust timestamps and merge
                chunk_duration_sec = len(chunk_audio) / 1000.0

                for segment in segments:
                    # 'segment' is usually an object or dict depending on library version.
                    # The existing code handles dict or object access in split_and_title.
                    # Here we need to update it.
                    # Since transcribe returns objects usually, let's assume objects or dicts.
                    # Actually transcribe returns transcript.segments which are objects in openai v1

                    # We need to modify the segment. We can't easily modify the API response object directly
                    # if it's frozen. Let's convert to dict if possible or create a new structure.
                    # Existing code expects: s["start"] or s.start

                    # Let's convert to a simple dict to be safe and consistent
                    start = getattr(segment, 'start', segment.get('start', 0))
                    end = getattr(segment, 'end', segment.get('end', 0))
                    text = getattr(segment, 'text', segment.get('text', ""))

                    new_seg = {
                        "start": start + total_duration_offset,
                        "end": end + total_duration_offset,
                        "text": text
                    }
                    all_segments.append(new_seg)

                total_duration_offset += chunk_duration_sec

        finally:
            # Cleanup
            print(f"Cleaning up temp dir: {temp_dir}")
            shutil.rmtree(temp_dir)

        return all_segments

    def split_and_title(self, segments: List[Any]) -> List[Dict[str, Any]]:
        """
        Uses GPT-4o-mini to split transcript segments into logical chunks with titles.
        """
        # Prepare input for LLM to save tokens and focus on content
        # Note: If segments come from process_large_file, they are already dicts.
        # If they come from transcribe(), they are objects.
        simplified_segments = []
        for s in segments:
            if isinstance(s, dict):
                simplified_segments.append({
                    "start": s["start"], "end": s["end"], "text": s["text"]
                })
            else:
                simplified_segments.append({
                    "start": s.start, "end": s.end, "text": s.text
                })

        prompt = """
        You are an intelligent assistant that processes audio transcripts.
        I will provide a list of transcript segments with timestamps.
        Your task is to:
        1. Group these segments into logical chunks based on context and topic shifts.
        2. Generate a concise and descriptive title for each chunk.
        3. Combine the text of the segments to form the 'transcript' for the chunk.
        4. Determine the 'start_time' (start of the first segment in the chunk) and 'end_time' (end of the last segment in the chunk).

        Return the result as a JSON object with a single key "chunks", which is a list of objects.
        Each object must have the following keys: "title", "start_time", "end_time", "transcript".
        """

        response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(simplified_segments)}
            ],
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content
        try:
            result = json.loads(content)
            return result.get("chunks", [])
        except json.JSONDecodeError:
            print("Failed to decode JSON from LLM response")
            return []

    def process(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Orchestrates the transcription and splitting process.
        """
        file_size = os.path.getsize(file_path)

        if file_size > self.FILE_SIZE_LIMIT_BYTES:
            print(f"File size {file_size} exceeds limit {self.FILE_SIZE_LIMIT_BYTES}. Using split processing.")
            segments = self.process_large_file(file_path)
        else:
            segments = self.transcribe(file_path)

        chunks = self.split_and_title(segments)
        return chunks
