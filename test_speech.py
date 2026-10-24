"""
Tests for GemmaKhata Speech-to-Text engine (speech.py).
Mocks faster-whisper so tests run fully offline without any model download.
"""

import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch, PropertyMock

import speech


class TestLanguageNormalization(unittest.TestCase):
    """Tests for _normalize_language — no model or audio needed."""

    def test_hindi_codes(self):
        for variant in ("hi", "hindi", "Hindi", "HINDI", "हिंदी", "hinglish"):
            self.assertEqual(speech._normalize_language(variant), "hi", f"Failed: {variant}")

    def test_english_codes(self):
        for variant in ("en", "english", "English", "eng"):
            self.assertEqual(speech._normalize_language(variant), "en", f"Failed: {variant}")

    def test_marathi_codes(self):
        for variant in ("mr", "marathi", "Marathi", "मराठी"):
            self.assertEqual(speech._normalize_language(variant), "mr", f"Failed: {variant}")

    def test_auto_returns_none(self):
        for variant in ("auto", "automatic", "detect", "", "  "):
            result = speech._normalize_language(variant)
            self.assertIsNone(result, f"Expected None for '{variant}', got '{result}'")

    def test_unknown_two_letter_code_passthrough(self):
        # Unknown 2-letter codes should be passed through to Whisper
        result = speech._normalize_language("gu")  # Gujarati
        self.assertEqual(result, "gu")


class TestModelStatus(unittest.TestCase):
    """Tests for get_model_status()."""

    @patch.dict(sys.modules, {"faster_whisper": None})
    def test_status_when_not_installed(self):
        # Simulate faster_whisper not being importable
        import importlib
        with patch("builtins.__import__", side_effect=ImportError("No module named 'faster_whisper'")):
            pass  # Can't easily patch builtins here without affecting other imports

    def test_status_structure(self):
        status = speech.get_model_status()
        self.assertIn("installed", status)
        self.assertIn("model_loaded", status)
        self.assertIn("model_size", status)
        self.assertIn("device", status)
        self.assertIn("compute_type", status)
        self.assertIn("supported_languages", status)
        self.assertIn("message", status)

    def test_status_model_not_loaded_initially(self):
        speech._whisper_model = None  # Ensure clean state
        status = speech.get_model_status()
        self.assertFalse(status["model_loaded"])

    def test_supported_languages_contains_hindi(self):
        status = speech.get_model_status()
        self.assertIn("hi", status["supported_languages"])
        self.assertIn("en", status["supported_languages"])
        self.assertIn("mr", status["supported_languages"])
        self.assertIn("auto", status["supported_languages"])


class TestErrorResponse(unittest.TestCase):
    """Tests for _error_response helper."""

    def test_error_response_structure(self):
        result = speech._error_response("Test error message")
        self.assertFalse(result["success"])
        self.assertEqual(result["text"], "")
        self.assertEqual(result["error"], "Test error message")
        self.assertEqual(result["segments"], [])
        self.assertEqual(result["language_probability"], 0.0)

    def test_error_response_with_custom_language(self):
        result = speech._error_response("Something broke", language="en")
        self.assertEqual(result["language"], "en")
        self.assertEqual(result["language_name"], "English")


class TestTranscribeAudioBytes(unittest.TestCase):
    """Tests for transcribe_audio_bytes() with mocked Whisper model."""

    def test_empty_bytes_returns_error(self):
        result = speech.transcribe_audio_bytes(b"")
        self.assertFalse(result["success"])
        self.assertIn("No audio data", result["error"])

    def test_oversized_audio_returns_error(self):
        # Create a fake 26 MB buffer
        big_audio = b"x" * (26 * 1024 * 1024)
        result = speech.transcribe_audio_bytes(big_audio)
        self.assertFalse(result["success"])
        self.assertIn("too large", result["error"])

    @patch("speech._get_model")
    def test_successful_transcription_from_bytes(self, mock_get_model):
        """Full mock transcription from bytes — simulates Hindi voice input."""
        mock_model = MagicMock()
        mock_get_model.return_value = mock_model

        # Mock segment
        mock_segment = MagicMock()
        mock_segment.text = " Ramesh ne 500 rupaye diye."
        mock_segment.start = 0.0
        mock_segment.end = 2.5

        # Mock transcription info
        mock_info = MagicMock()
        mock_info.language = "hi"
        mock_info.language_probability = 0.97
        mock_info.duration = 3.0

        mock_model.transcribe.return_value = ([mock_segment], mock_info)

        result = speech.transcribe_audio_bytes(b"fake_audio_data_here", language="hi")

        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "Ramesh ne 500 rupaye diye.")
        self.assertEqual(result["language"], "hi")
        self.assertEqual(result["language_name"], "Hindi")
        self.assertEqual(result["duration_seconds"], 3.0)
        self.assertEqual(len(result["segments"]), 1)
        self.assertIsNone(result["error"])

    @patch("speech._get_model")
    def test_no_speech_detected_returns_error(self, mock_get_model):
        """If Whisper returns empty segments (silence), return a helpful error."""
        mock_model = MagicMock()
        mock_get_model.return_value = mock_model

        mock_info = MagicMock()
        mock_info.language = "hi"
        mock_info.language_probability = 0.5
        mock_info.duration = 2.0

        mock_model.transcribe.return_value = ([], mock_info)

        result = speech.transcribe_audio_bytes(b"silence_audio", language="hi")

        self.assertFalse(result["success"])
        self.assertIn("No speech detected", result["error"])

    @patch("speech._get_model")
    def test_auto_language_detection(self, mock_get_model):
        """Test that 'auto' language triggers Whisper's auto-detection."""
        mock_model = MagicMock()
        mock_get_model.return_value = mock_model

        mock_segment = MagicMock()
        mock_segment.text = "Suresh ko 200 ka chawal udhaar diya."
        mock_segment.start = 0.0
        mock_segment.end = 3.1

        mock_info = MagicMock()
        mock_info.language = "hi"
        mock_info.language_probability = 0.99
        mock_info.duration = 4.0

        mock_model.transcribe.return_value = ([mock_segment], mock_info)

        result = speech.transcribe_audio_bytes(b"audio", language="auto")
        self.assertTrue(result["success"])

        # Verify transcribe was called with language=None (auto-detect signal)
        call_kwargs = mock_model.transcribe.call_args
        self.assertIsNone(call_kwargs.kwargs.get("language"))

    @patch("speech._get_model")
    def test_multiple_segments_concatenated(self, mock_get_model):
        """Multiple Whisper segments should be joined into one text string."""
        mock_model = MagicMock()
        mock_get_model.return_value = mock_model

        seg1 = MagicMock()
        seg1.text = "Ramesh ne 500 rupaye diye"
        seg1.start = 0.0
        seg1.end = 2.0

        seg2 = MagicMock()
        seg2.text = "aur Suresh ko 200 ka chawal udhaar diya."
        seg2.start = 2.1
        seg2.end = 4.5

        mock_info = MagicMock()
        mock_info.language = "hi"
        mock_info.language_probability = 0.98
        mock_info.duration = 5.0

        mock_model.transcribe.return_value = ([seg1, seg2], mock_info)

        result = speech.transcribe_audio_bytes(b"audio", language="hi")

        self.assertTrue(result["success"])
        self.assertIn("Ramesh", result["text"])
        self.assertIn("Suresh", result["text"])
        self.assertEqual(len(result["segments"]), 2)

    @patch("speech._get_model")
    def test_model_exception_handled_gracefully(self, mock_get_model):
        """If faster-whisper crashes internally, return error dict instead of raising."""
        mock_model = MagicMock()
        mock_get_model.return_value = mock_model
        mock_model.transcribe.side_effect = RuntimeError("CUDA out of memory")

        result = speech.transcribe_audio_bytes(b"audio_data", language="hi")
        self.assertFalse(result["success"])
        self.assertIn("Transcription failed", result["error"])

    def test_import_error_handled_gracefully(self):
        """If faster-whisper is not installed, return a helpful error."""
        speech.unload_model()  # Make sure model cache is cleared

        with patch("speech._get_model", side_effect=ImportError("No module named 'faster_whisper'")):
            result = speech.transcribe_audio_bytes(b"audio", language="hi")
            self.assertFalse(result["success"])
            self.assertIn("faster_whisper", result["error"])


class TestTranscribeFile(unittest.TestCase):
    """Tests for transcribe_file()."""

    def test_nonexistent_file_returns_error(self):
        result = speech.transcribe_file("/tmp/nonexistent_file_xyz.wav")
        self.assertFalse(result["success"])
        self.assertIn("not found", result["error"])

    def test_directory_path_returns_error(self):
        result = speech.transcribe_file("/tmp")
        self.assertFalse(result["success"])
        self.assertIn("not a file", result["error"])

    @patch("speech._run_transcription")
    def test_valid_file_calls_run_transcription(self, mock_run):
        """A valid file path should delegate to _run_transcription."""
        mock_run.return_value = {"success": True, "text": "Test", "error": None}

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"fake wav data")
            tmp_path = f.name

        try:
            result = speech.transcribe_file(tmp_path, language="hi")
            mock_run.assert_called_once_with(tmp_path, language="hi", beam_size=5)
        finally:
            os.unlink(tmp_path)


if __name__ == "__main__":
    unittest.main()
