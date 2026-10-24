"""
main.py - GemmaKhata backend (FastAPI).

Run:   uvicorn main:app --reload --port 8000
Open:  http://localhost:8000
       (browsers only allow the microphone on localhost or HTTPS)
"""
import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import speech

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gemmakhata")

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MIN_UPLOAD_BYTES = 1024  # anything smaller is an empty or clipped recording

# MediaRecorder gives webm/opus on Chrome/Firefox/Android and mp4 on Safari/iOS.
CONTENT_TYPE_SUFFIX = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/flac": ".flac",
}
ALLOWED_SUFFIXES = set(CONTENT_TYPE_SUFFIX.values()) | {".oga", ".opus"}


def _warm_up() -> None:
    try:
        speech.preload()
        log.info("Whisper model ready: %s", speech.info())
    except Exception as exc:  # the first request will report the same problem
        log.warning("Whisper preload failed: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the model in the background so the server starts instantly and the
    # first recording doesn't pay the loading cost. Set WHISPER_PRELOAD=0 to skip.
    if os.getenv("WHISPER_PRELOAD", "1") != "0":
        threading.Thread(target=_warm_up, daemon=True, name="whisper-preload").start()
    yield


app = FastAPI(title="GemmaKhata", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "whisper": speech.info()}


def _suffix_for(upload: UploadFile) -> str:
    ctype = (upload.content_type or "").split(";")[0].strip().lower()
    if ctype in CONTENT_TYPE_SUFFIX:
        return CONTENT_TYPE_SUFFIX[ctype]
    ext = Path(upload.filename or "").suffix.lower()
    return ext if ext in ALLOWED_SUFFIXES else ".webm"


# A plain `def` (not async) so FastAPI runs the slow transcription in its
# thread pool instead of blocking the event loop.
@app.post("/api/transcribe")
def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
) -> dict:
    if language not in speech.LANGUAGES:
        raise HTTPException(400, f"Unknown language '{language}'. Use one of: {', '.join(speech.LANGUAGES)}.")

    data = audio.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Audio is larger than 25 MB. Record a shorter entry.")
    if len(data) < MIN_UPLOAD_BYTES:
        raise HTTPException(400, "The recording is empty or too short. Hold the mic a little longer and try again.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=_suffix_for(audio), delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        return speech.transcribe(tmp_path, language)
    except speech.ModelUnavailable as exc:
        log.error("%s", exc)
        raise HTTPException(503, "The speech model is not ready. The first run downloads it and needs internet. Check the server window for details.")
    except Exception as exc:
        log.exception("Transcription failed")
        if type(exc).__module__.startswith("av"):  # PyAV could not decode the file
            raise HTTPException(422, "This audio file could not be read. Try recording again or upload a wav/mp3/m4a file.")
        raise HTTPException(500, "Transcription failed. Try recording again.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
