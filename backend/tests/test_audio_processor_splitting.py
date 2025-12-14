
import unittest
from unittest.mock import MagicMock, patch
import os
import tempfile
import json

# Set dummy API key before importing the module that initializes OpenAI
os.environ["OPENAI_API_KEY"] = "dummy-key"

from services.audio_processor import AudioProcessor

# Helper class to mock AudioSegment behavior simpler than MagicMock
class MockAudioSegment:
    def __init__(self, length_ms=0):
        self.length_ms = length_ms
        self.dBFS = -20

    def __len__(self):
        return self.length_ms

    def __add__(self, other):
        return MockAudioSegment(self.length_ms + len(other))

    def export(self, *args, **kwargs):
        pass

class TestAudioProcessorSplitting(unittest.TestCase):

    def setUp(self):
        self.processor = AudioProcessor()
        # Mock the OpenAI client
        self.processor.client = MagicMock()

    @patch('services.audio_processor.AudioSegment')
    @patch('services.audio_processor.split_on_silence')
    @patch('services.audio_processor.os.path.getsize')
    def test_process_large_file_logic(self, mock_getsize, mock_split_on_silence, mock_audio_segment_cls):
        """
        Test that process_large_file:
        1. Loads the audio
        2. Splits it
        3. Groups into chunks
        4. Transcribes each chunk (mocked)
        5. Offsets timestamps correctly
        """

        # --- Setup Mocks ---
        # Ensure getsize returns a safe small size for the chunk checks
        mock_getsize.return_value = 1024 # 1KB

        # Mock AudioSegment.from_file to return a dummy audio object
        mock_audio_segment_cls.from_file.return_value = MockAudioSegment(25 * 60 * 1000)
        mock_audio_segment_cls.empty.return_value = MockAudioSegment(0)

        # Mock split_on_silence to return 3 segments using our MockAudioSegment class
        seg1 = MockAudioSegment(8 * 60 * 1000) # 8 mins
        seg2 = MockAudioSegment(8 * 60 * 1000) # 8 mins
        seg3 = MockAudioSegment(9 * 60 * 1000) # 9 mins

        mock_split_on_silence.return_value = [seg1, seg2, seg3]

        # Mock transcribe_with_retry to return fake segments
        def mock_transcribe_side_effect(file_path, max_retries=3):
            return [
                {"start": 60.0, "end": 120.0, "text": "Hello"}
            ]

        self.processor.transcribe_with_retry = MagicMock(side_effect=mock_transcribe_side_effect)

        # Act
        result_segments = self.processor.process_large_file("fake_large_file.mp3")

        # Assert
        # 1. Check transcribe calls
        # Logic: 8 < 10, current=8. 8+8=16 > 10. process 8. current=8. 8+9=17 > 10. process 8. current=9. process 9.
        self.assertEqual(self.processor.transcribe_with_retry.call_count, 3)

        # 2. Check timestamps
        self.assertEqual(len(result_segments), 3)

        # Segment 1
        self.assertEqual(result_segments[0]['start'], 60.0)

        # Segment 2 (Offset 8 mins = 480s)
        self.assertEqual(result_segments[1]['start'], 60.0 + 480.0)

        # Segment 3 (Offset 16 mins = 960s)
        self.assertEqual(result_segments[2]['start'], 60.0 + 960.0)

    @patch('services.audio_processor.AudioSegment')
    @patch('services.audio_processor.split_on_silence')
    @patch('services.audio_processor.os.path.getsize')
    def test_process_decision_logic(self, mock_getsize, mock_split, mock_audio):
        """
        Test that process() calls process_large_file() if file is big.
        """
        # Setup
        mock_getsize.return_value = 21 * 1024 * 1024 # 21 MB (limit is 20MB)
        self.processor.process_large_file = MagicMock(return_value=[])
        self.processor.split_and_title = MagicMock(return_value=[])

        # Act
        self.processor.process("big_file.mp3")

        # Assert
        self.processor.process_large_file.assert_called_once_with("big_file.mp3")

    @patch('services.audio_processor.os.path.getsize')
    def test_process_decision_logic_small(self, mock_getsize):
        """
        Test that process() calls transcribe() if file is small.
        """
        # Setup
        mock_getsize.return_value = 5 * 1024 * 1024 # 5 MB
        self.processor.transcribe = MagicMock(return_value=[])
        self.processor.split_and_title = MagicMock(return_value=[])

        # Act
        self.processor.process("small_file.mp3")

        # Assert
        self.processor.transcribe.assert_called_once_with("small_file.mp3")

if __name__ == '__main__':
    unittest.main()
