"""
speech.py - faster-whisper speech-to-text for GemmaKhata.

The Whisper model is loaded once (lazily, or at server start via preload())
and reused for every request. faster-whisper decodes audio with its bundled
PyAV, so browser recordings (webm / ogg / mp4 / wav) work without installing
a system ffmpeg.

Environment overrides:
    WHISPER_MODEL    tiny | base | small | medium | large-v3   (default: small)
    WHISPER_DEVICE   auto | cpu | cuda                         (default: auto)
    WHISPER_COMPUTE  int8 | int8_float16 | float16 | float32   (default: by device)

Quick test from the terminal:
    python speech.py recording.wav hinglish
"""
from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any, Dict, Optional

MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "auto").lower()
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "")

# Whisper treats initial_prompt as "previous text": it nudges spelling, script
# and vocabulary. This one biases Roman-script Hinglish and kirana words.
HINGLISH_PROMPT = (
    "Ramesh ne 500 rupaye diye. Suresh ko 200 rupaye ka chawal udhaar diya. "
    "Sunita ka hisaab, baaki paisa wapas, aata, dal, cheeni, tel, chai patti."
)

# UI value -> (Whisper language code or None for auto-detect, bias prompt)
LANGUAGES: Dict[str, tuple] = {
    "auto": (None, None),
    "hi": ("hi", None),          # Hindi, written in Devanagari
    "mr": ("mr", None),          # Marathi, written in Devanagari
    "en": ("en", None),          # English
    "hinglish": ("en", HINGLISH_PROMPT),  # Hindi-English mix, Roman script
}


class ModelUnavailable(RuntimeError):
    """The Whisper model could not be loaded (not downloaded, no network, no memory...)."""


_model = None
_runtime: Dict[str, str] = {}
_load_lock = threading.Lock()
_run_lock = threading.Lock()  # one transcription at a time keeps CPU/RAM predictable


def _pick_runtime() -> tuple:
    device = DEVICE
    if device == "auto":
        try:
            import ctranslate2

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    compute = COMPUTE_TYPE or ("float16" if device == "cuda" else "int8")
    return device, compute


def get_model():
    """Return the shared WhisperModel, loading it on first use."""
    global _model
    if _model is None:
        with _load_lock:
            if _model is None:
                try:
                    from faster_whisper import WhisperModel

                    device, compute = _pick_runtime()
                    _model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute)
                    _runtime.update(device=device, compute_type=compute)
                except Exception as exc:
                    raise ModelUnavailable(
                        f"Could not load Whisper model '{MODEL_SIZE}': {exc}"
                    ) from exc
    return _model


def preload() -> None:
    """Load the model now so the first recording isn't slow."""
    get_model()


def info() -> Dict[str, Any]:
    return {
        "model": MODEL_SIZE,
        "loaded": _model is not None,
        "device": _runtime.get("device"),
        "compute_type": _runtime.get("compute_type"),
    }


def _run(model, audio_path: str, lang: Optional[str], prompt: Optional[str]):
    segments, meta = model.transcribe(
        audio_path,
        language=lang,
        task="transcribe",
        beam_size=5,
        vad_filter=True,                       # drop silence / shop background noise
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=prompt,
        condition_on_previous_text=False,      # avoids repeated-phrase loops
    )
    items = [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segments  # generator: decoding actually happens here
    ]
    return items, meta


def transcribe(audio_path: str, language: str = "auto") -> Dict[str, Any]:
    """Transcribe an audio file.

    language: one of LANGUAGES ("auto", "hi", "mr", "en", "hinglish").
    Returns text, detected language, duration and per-segment timestamps.
    """
    if language not in LANGUAGES:
        raise ValueError(f"Unknown language '{language}'")
    lang, prompt = LANGUAGES[language]

    model = get_model()
    started = time.perf_counter()
    with _run_lock:
        items, meta = _run(model, audio_path, lang, prompt)
        # Whisper often labels Hindi speech as Urdu (Perso-Arabic script) in
        # auto mode. Our users speak Hindi/Marathi/English, so retry as Hindi.
        if language == "auto" and meta.language == "ur":
            items, meta = _run(model, audio_path, "hi", None)

    text = " ".join(i["text"] for i in items if i["text"]).strip()
    return {
        "text": text,
        "language": meta.language,
        "language_probability": round(float(meta.language_probability), 3),
        "duration": round(float(meta.duration), 2),
        "segments": items,
        "elapsed": round(time.perf_counter() - started, 2),
        "model": MODEL_SIZE,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python speech.py <audio-file> [auto|hi|mr|en|hinglish]")
    out = transcribe(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "auto")
    print(f"[{out['language']} {out['language_probability']:.2f}, "
          f"{out['duration']}s audio, {out['elapsed']}s to transcribe]")
    print(out["text"] or "(no speech detected)")
