import os
import json
import shutil
import tempfile
import time
import subprocess
import re
from typing import List, Dict, Any, Optional
import psutil

from openai import OpenAI

class AudioProcessor:
    def __init__(self):
        # API key should be in environment variables: OPENAI_API_KEY
        self.client = OpenAI()
        # Whisper API limit is 25MB. We'll target ~10 minute chunks.
        # 10 mins at 128kbps is ~10MB.
        self.CHUNK_TARGET_DURATION_SEC = 10 * 60  # 10 minutes
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
        try:
            process = psutil.Process(os.getpid())
            mem_info = process.memory_info()
            print(f"[Memory Usage] {tag}: RSS={mem_info.rss / 1024 / 1024:.2f} MB")
        except Exception:
            pass

    def _get_audio_duration(self, file_path: str) -> float:
        """Get duration of audio file in seconds using ffprobe."""
        cmd = [
            "ffprobe", 
            "-v", "error", 
            "-show_entries", "format=duration", 
            "-of", "default=noprint_wrappers=1:nokey=1", 
            file_path
        ]
        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            return float(result.stdout.strip())
        except Exception as e:
            print(f"Error getting duration: {e}")
            return 0.0

    def _detect_silence_intervals(self, file_path: str, silence_thresh="-30dB", min_silence_dur=1.0) -> List[Dict[str, float]]:
        """
        Detects silence intervals using ffmpeg silencedetect filter.
        Returns list of dicts with 'start', 'end', 'duration' of silence.
        """
        print(f"Detecting silence in {file_path}...")
        self._log_memory_usage("Before silence detection")
        
        # ffmpeg -i input -af silencedetect=noise=-30dB:d=1 -f null -
        cmd = [
            "ffmpeg",
            "-i", file_path,
            "-af", f"silencedetect=noise={silence_thresh}:d={min_silence_dur}",
            "-f", "null",
            "-"
        ]
        
        # ffmpeg writes silencedetect output to stderr
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        output = result.stderr
        
        silence_list = []
        
        start_matches = list(re.finditer(r"silence_start: (\d+(\.\d*)?)", output))
        end_matches = list(re.finditer(r"silence_end: (\d+(\.\d*)?)", output))
        
        starts = [float(m.group(1)) for m in start_matches]
        ends = [float(m.group(1)) for m in end_matches]
        
        count = min(len(starts), len(ends))
        for i in range(count):
            silence_list.append({
                "start": starts[i],
                "end": ends[i],
                "duration": ends[i] - starts[i]
            })
            
        print(f"Detected {len(silence_list)} silence intervals.")
        self._log_memory_usage("After silence detection")
        return silence_list

    def _determine_split_points(self, total_duration: float, silence_intervals: List[Dict[str, float]]) -> List[float]:
        """
        Calculates split points (timestamps) to chunk audio.
        Target chunk duration: CHUNK_TARGET_DURATION_SEC
        Ideally split in the middle of a silence interval.
        """
        split_points = []
        current_time = 0.0
        
        while current_time + self.CHUNK_TARGET_DURATION_SEC < total_duration:
            target_time = current_time + self.CHUNK_TARGET_DURATION_SEC
            
            # Find a silence interval near the target time
            # Look for silence in range [target_time - 60s, target_time + 60s]
            search_window_start = max(current_time + 60, target_time - 60)
            search_window_end = min(total_duration, target_time + 60)
            
            candidates = [s for s in silence_intervals if s['start'] >= search_window_start and s['start'] <= search_window_end]
            
            if candidates:
                candidates.sort(key=lambda s: abs(s['start'] - target_time))
                chosen = candidates[0]
                best_split = chosen['start'] + (chosen['duration'] / 2)
            else:
                print(f"Warning: No silence found near {target_time}s. Splitting forcefully.")
                best_split = target_time
            
            split_points.append(best_split)
            current_time = best_split
            
        return split_points

    def process_large_file(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Splits a large file on silence using ffmpeg, transcribes, AND structures chunks sequentially.
        Returns final structured chunks.
        """
        temp_dir = tempfile.mkdtemp()
        final_chunks = []
        
        try:
            print(f"Processing large audio file: {file_path}")
            self._log_memory_usage("Start process_large_file")
            
            total_duration = self._get_audio_duration(file_path)
            print(f"Total duration: {total_duration:.2f}s")
            
            silences = self._detect_silence_intervals(file_path)
            split_points = self._determine_split_points(total_duration, silences)
            
            points = [0.0] + split_points + [total_duration]
            total_chunks = len(points) - 1
            print(f"[Progress] Total chunks to process: {total_chunks}")
            print(f"Split points: {points}")
            
            for i in range(total_chunks):
                start = points[i]
                end = points[i+1]
                duration = end - start
                
                if duration < 0.1:
                    continue
                
                print(f"[Progress] Processing chunk {i+1}/{total_chunks} ({((i+1)/total_chunks)*100:.1f}%)")
                chunk_filename = os.path.join(temp_dir, f"chunk_{i}.mp3")
                print(f"Exporting chunk {i}: {start:.2f}s to {end:.2f}s ({duration:.2f}s) -> {chunk_filename}")
                self._log_memory_usage(f"Before export chunk {i}")

                cmd = [
                    "ffmpeg", 
                    "-v", "error",
                    "-i", file_path,
                    "-ss", str(start),
                    "-to", str(end),
                    "-c:a", "libmp3lame",
                    "-q:a", "4",
                    "-ac", "1",
                    "-y",
                    chunk_filename
                ]
                subprocess.run(cmd, check=True)
                
                chunk_size = os.path.getsize(chunk_filename)
                print(f"Chunk {i} size: {chunk_size / (1024*1024):.2f} MB")
                
                print(f"[Progress] Step: Transcribing chunk {i+1}/{total_chunks}...")
                segments = self.transcribe_with_retry(chunk_filename)
                
                # Cleanup chunk file
                try:
                    os.remove(chunk_filename)
                except:
                    pass
                
                print(f"[Progress] Step: Structuring chunk {i+1}/{total_chunks} with LLM...")
                # Immediately process segments into logical chunks with titles
                # Note: split_and_title returns chunks with start_time/end_time relative to the chunk audio (0.0 based)
                local_chunks = self.split_and_title(segments)
                
                # Adjust timestamps to be absolute relative to the original file
                for chunk in local_chunks:
                    chunk["start_time"] += start
                    chunk["end_time"] += start
                    final_chunks.append(chunk)

        except Exception as e:
            print(f"Error in process_large_file: {e}")
            import traceback
            traceback.print_exc()
            raise e
        finally:
            print(f"Cleaning up temp dir: {temp_dir}")
            shutil.rmtree(temp_dir)

        return final_chunks

    def split_and_title(self, segments: List[Any]) -> List[Dict[str, Any]]:
        """
        Uses GPT-4o-mini to split transcript segments into logical chunks with titles.
        """
        simplified_segments = []
        for s in segments:
            if isinstance(s, dict):
                simplified_segments.append({
                    "start": s.get("start",0), "end": s.get("end",0), "text": s.get("text","")
                })
            else:
                simplified_segments.append({
                    "start": getattr(s, 'start', 0), "end": getattr(s, 'end', 0), "text": getattr(s, 'text', "")
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
        
        # If segments are empty, return empty
        if not simplified_segments:
             return []

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
            chunks = result.get("chunks", [])
            
            # Check if chunks is a list
            if not isinstance(chunks, list):
                print(f"Unexpected format for 'chunks': {type(chunks)}. Content: {content}")
                return []
            
            # Validate each chunk is a dict with required keys
            valid_chunks = []
            for c in chunks:
                if isinstance(c, dict) and "start_time" in c and "end_time" in c:
                    valid_chunks.append(c)
                else:
                    print(f"Skipping invalid chunk format: {c}")
            
            return valid_chunks

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
            # Returns fully structured chunks
            chunks = self.process_large_file(file_path)
        else:
            print(f"Processing small audio file: {file_path}")
            print(f"[Progress] Step: Transcribing small file...")
            segments = self.transcribe(file_path)
            print(f"[Progress] Step: Structuring small file with LLM...")
            chunks = self.split_and_title(segments)

        return chunks
