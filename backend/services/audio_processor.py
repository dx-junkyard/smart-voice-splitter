import os
import json
from openai import OpenAI
from typing import List, Dict, Any

class AudioProcessor:
    def __init__(self):
        # API key should be in environment variables: OPENAI_API_KEY
        self.client = OpenAI()

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

    def split_and_title(self, segments: List[Any]) -> List[Dict[str, Any]]:
        """
        Uses GPT-4o-mini to split transcript segments into logical chunks with titles.
        """
        # Prepare input for LLM to save tokens and focus on content
        simplified_segments = [
            {"start": s["start"], "end": s["end"], "text": s["text"]}
            if isinstance(s, dict) else {"start": s.start, "end": s.end, "text": s.text}
            for s in segments
        ]

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
        segments = self.transcribe(file_path)
        chunks = self.split_and_title(segments)
        return chunks
