"""
GemmaKhata — Speech-to-Text Engine using faster-whisper
=========================================================
Converts shopkeeper's voice recordings into transcribed text.
Supports Hindi, English, Hinglish, Marathi, and auto-detection.

Pipeline:
  Audio (mic/file) → faster-whisper → Transcribed text → gemma_ai.py

Key design decisions:
  - Model is loaded ONCE and reused (not reloaded on every request)
  - Auto language detection if shopkeeper doesn't specify
  - Accepts raw audio bytes (from FastAPI multipart upload) or file paths
  - All arithmetic and validation in Python; AI only used for text understanding

Usage:
  from speech import transcribe_audio_bytes, transcribe_file, get_model_status

  result = transcribe_audio_bytes(raw_audio_bytes, language="hi")
  result = transcribe_file("recording.wav", language="auto")
"""

import io
import os
import logging
import tempfile
import time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(levelname)s [speech] %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# faster-whisper model size:
#   "tiny"   — fastest, least accurate  (~75 MB)
#   "base"   — good balance             (~150 MB)  ← default for hackathon
#   "small"  — better accuracy          (~500 MB)
#   "medium" — high accuracy            (~1.5 GB)
#   "large-v3" — best accuracy          (~3 GB)
WHISPER_MODEL_SIZE = "base"

# Compute type: "int8" is fast on CPU, "float16" needs a GPU
COMPUTE_TYPE = "int8"

# Device: "cpu" works on all machines; "cuda" needs an NVIDIA GPU
DEVICE = "cpu"

# Supported languages with their Whisper language codes
SUPPORTED_LANGUAGES = {
    "hi": "Hindi",
    "en": "English",
    "mr": "Marathi",
    "auto": "Auto-detect",
}

# Default language for Indian kirana store use case
DEFAULT_LANGUAGE = "hi"

# Audio constraints
MAX_AUDIO_SIZE_MB = 25
MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024

# ---------------------------------------------------------------------------
# Singleton Model Cache — loaded once, reused on every request
# ---------------------------------------------------------------------------
_whisper_model = None
_model_load_time = None


def _get_model():
    """
    Returns a cached faster-whisper WhisperModel instance.
    Loads it on first call; subsequent calls reuse the same model.
    Raises ImportError with setup instructions if faster-whisper isn't installed.
    """
    global _whisper_model, _model_load_time

    if _whisper_model is not None:
        return _whisper_model

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise ImportError(
            "faster-whisper is not installed.\n"
            "Install it with: pip install faster-whisper\n"
            "Documentation: https://github.com/SYSTRAN/faster-whisper"
        )

    log.info(f"Loading Whisper model '{WHISPER_MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE})...")
    start = time.time()

    _whisper_model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
        download_root=str(Path(__file__).parent / "data" / "whisper_models")
    )

    _model_load_time = round(time.time() - start, 2)
    log.info(f"Whisper model loaded in {_model_load_time}s.")
    return _whisper_model


def unload_model():
    """Force-unloads the cached model to free memory."""
    global _whisper_model
    _whisper_model = None
    log.info("Whisper model unloaded.")


# ---------------------------------------------------------------------------
# Model Status
# ---------------------------------------------------------------------------
def get_model_status() -> dict[str, Any]:
    """
    Returns the current status of the Whisper model:
    - Whether it's loaded or not
    - Model size and device configuration
    - Load time (if already loaded)
    """
    try:
        from faster_whisper import WhisperModel  # noqa: just checking import
        installed = True
    except ImportError:
        installed = False

    return {
        "installed": installed,
        "model_loaded": _whisper_model is not None,
        "model_size": WHISPER_MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model_load_time_seconds": _model_load_time,
        "supported_languages": SUPPORTED_LANGUAGES,
        "default_language": DEFAULT_LANGUAGE,
        "message": (
            "faster-whisper ready." if installed
            else "faster-whisper not installed. Run: pip install faster-whisper"
        )
    }


# ---------------------------------------------------------------------------
# Core Transcription — from audio bytes (API upload)
# ---------------------------------------------------------------------------
def transcribe_audio_bytes(
    audio_bytes: bytes,
    language: str = DEFAULT_LANGUAGE,
    beam_size: int = 5,
) -> dict[str, Any]:
    """
    Transcribes raw audio bytes from a browser microphone recording.
    Used by the FastAPI endpoint that receives multipart audio uploads.

    Args:
        audio_bytes : Raw audio data (WebM, WAV, MP3, OGG all accepted).
        language    : Whisper language code ("hi", "en", "mr") or "auto" for detection.
        beam_size   : Higher = more accurate but slower (5 is a good default).

    Returns:
        {
            "success"          : bool,
            "text"             : str,          # Full transcribed text
            "language"         : str,          # Detected/used language code
            "language_name"    : str,          # Human-readable language name
            "duration_seconds" : float,        # Audio duration
            "processing_time"  : float,        # Transcription time in seconds
            "segments"         : [...],        # Individual word/phrase segments
            "error"            : str | None
        }
    """
    if not audio_bytes:
        return _error_response("No audio data received.")

    if len(audio_bytes) > MAX_AUDIO_SIZE_BYTES:
        return _error_response(
            f"Audio file too large ({len(audio_bytes) / 1024 / 1024:.1f} MB). "
            f"Max allowed: {MAX_AUDIO_SIZE_MB} MB."
        )

    # Write bytes to a temp file — faster-whisper needs a file path or file-like object
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        return _run_transcription(tmp_path, language=language, beam_size=beam_size)
    finally:
        # Always clean up the temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Core Transcription — from a file path
# ---------------------------------------------------------------------------
def transcribe_file(
    file_path: str,
    language: str = DEFAULT_LANGUAGE,
    beam_size: int = 5,
) -> dict[str, Any]:
    """
    Transcribes audio from a file path on disk.
    Useful for testing or batch processing saved recordings.

    Args:
        file_path : Absolute or relative path to audio file.
        language  : Whisper language code or "auto".
        beam_size : Beam search width (higher = more accurate, slower).
    """
    path = Path(file_path)
    if not path.exists():
        return _error_response(f"Audio file not found: {file_path}")
    if not path.is_file():
        return _error_response(f"Path is not a file: {file_path}")

    return _run_transcription(str(path), language=language, beam_size=beam_size)


# ---------------------------------------------------------------------------
# Internal transcription runner
# ---------------------------------------------------------------------------
def _run_transcription(
    audio_path: str,
    language: str,
    beam_size: int,
) -> dict[str, Any]:
    """
    Runs faster-whisper transcription on a given audio file path.
    Handles language detection, segment aggregation, and error wrapping.
    """
    start_time = time.time()

    # Normalize language input
    lang_code = _normalize_language(language)

    try:
        model = _get_model()
    except ImportError as e:
        return _error_response(str(e))

    try:
        log.info(f"Transcribing '{audio_path}' | lang={lang_code or 'auto'} | beam={beam_size}")

        # Run transcription
        # If lang_code is None, Whisper auto-detects the language
        segments_iter, info = model.transcribe(
            audio_path,
            language=lang_code,          # None triggers auto-detection
            beam_size=beam_size,
            vad_filter=True,             # Voice Activity Detection — ignores silence
            vad_parameters={
                "min_silence_duration_ms": 500,  # Ignore gaps shorter than 0.5s
            },
            word_timestamps=False,        # Not needed for our use case
        )

        # Consume the generator into a list
        segments = list(segments_iter)

        processing_time = round(time.time() - start_time, 2)

        # Build full transcription text from all segments
        full_text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
        full_text = full_text.strip()

        # Extract detected language
        detected_lang = info.language if info.language else (lang_code or "hi")
        lang_name = SUPPORTED_LANGUAGES.get(detected_lang, detected_lang.upper())

        # Build segment list for frontend display (timestamps for each phrase)
        segment_list = [
            {
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            }
            for seg in segments
            if seg.text.strip()
        ]

        audio_duration = round(info.duration, 2) if hasattr(info, "duration") else 0.0

        log.info(
            f"Transcription done in {processing_time}s | "
            f"lang={detected_lang} | duration={audio_duration}s | "
            f"text='{full_text[:80]}...'"
        )

        if not full_text:
            return _error_response(
                "No speech detected in the audio. "
                "Please speak clearly and try again.",
                language=detected_lang,
                processing_time=processing_time
            )

        return {
            "success": True,
            "text": full_text,
            "language": detected_lang,
            "language_name": lang_name,
            "language_probability": round(info.language_probability, 3) if hasattr(info, "language_probability") else 1.0,
            "duration_seconds": audio_duration,
            "processing_time": processing_time,
            "segments": segment_list,
            "error": None
        }

    except Exception as e:
        processing_time = round(time.time() - start_time, 2)
        log.error(f"Transcription error: {e}")
        return _error_response(
            f"Transcription failed: {str(e)}",
            processing_time=processing_time
        )


# ---------------------------------------------------------------------------
# Language Normalization
# ---------------------------------------------------------------------------
def _normalize_language(language: str) -> str | None:
    """
    Converts user-facing language strings to Whisper language codes.
    Returns None for auto-detection.

    Examples:
        "hi"      → "hi"
        "Hindi"   → "hi"
        "auto"    → None  (Whisper auto-detects)
        "english" → "en"
        "marathi" → "mr"
        "hinglish"→ "hi"  (Whisper handles code-switching well in hi mode)
    """
    lang = language.strip().lower()

    mapping = {
        # Hindi variants
        "hi": "hi", "hindi": "hi", "हिंदी": "hi", "hinglish": "hi",
        # English variants
        "en": "en", "english": "en", "eng": "en",
        # Marathi variants
        "mr": "mr", "marathi": "mr", "मराठी": "mr",
        # Auto-detect
        "auto": None, "automatic": None, "detect": None, "": None,
    }

    return mapping.get(lang, lang if len(lang) == 2 else "hi")


# ---------------------------------------------------------------------------
# Error Response Helper
# ---------------------------------------------------------------------------
def _error_response(
    message: str,
    language: str = DEFAULT_LANGUAGE,
    processing_time: float = 0.0
) -> dict[str, Any]:
    return {
        "success": False,
        "text": "",
        "language": language,
        "language_name": SUPPORTED_LANGUAGES.get(language, language),
        "language_probability": 0.0,
        "duration_seconds": 0.0,
        "processing_time": processing_time,
        "segments": [],
        "error": message
    }


# ---------------------------------------------------------------------------
# Quick Demo / Manual Test (run: python speech.py path/to/audio.wav)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    print("=" * 60)
    print("GemmaKhata — Speech-to-Text Engine (faster-whisper)")
    print("=" * 60)

    # Show model status
    status = get_model_status()
    print(f"\n[Status]")
    print(f"  Installed    : {status['installed']}")
    print(f"  Model Size   : {status['model_size']}")
    print(f"  Device       : {status['device']} ({status['compute_type']})")
    print(f"  Message      : {status['message']}")

    if not status["installed"]:
        print("\n  Run: pip install faster-whisper")
        sys.exit(0)

    # Transcribe a file if path is given as CLI argument
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
        lang = sys.argv[2] if len(sys.argv) > 2 else "auto"

        print(f"\n[Transcribing] {audio_path} (language: {lang})")
        result = transcribe_file(audio_path, language=lang)

        if result["success"]:
            print(f"\n  Text     : {result['text']}")
            print(f"  Language : {result['language_name']} ({result['language']})")
            print(f"  Duration : {result['duration_seconds']}s")
            print(f"  Time     : {result['processing_time']}s")
            print(f"\n  Segments ({len(result['segments'])}):")
            for seg in result["segments"]:
                print(f"    [{seg['start']}s → {seg['end']}s] {seg['text']}")
        else:
            print(f"\n  Error: {result['error']}")
    else:
        print("\n  Usage: python speech.py <audio_file_path> [language]")
        print("  Example: python speech.py recording.wav hi")
        print("  Example: python speech.py audio.mp3 auto")
        print("\n  Supported languages: hi (Hindi), en (English), mr (Marathi), auto")
