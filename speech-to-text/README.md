# Speech-to-text (faster-whisper)

A self-contained demo of the voice entry step: record in the browser, transcribe with faster-whisper, and show an editable transcript. It does not touch `backend/` or `frontend/`.

## Run it

```bash
cd speech-to-text
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000. Browsers only allow the microphone on `localhost` or HTTPS. The first run downloads the Whisper model, so it needs internet once.

## API

`POST /api/transcribe` takes a form with an `audio` file and a `language` field (`auto`, `hinglish`, `hi`, `mr` or `en`). It returns JSON with `text`, `language`, `duration`, `elapsed` and `segments`. `GET /api/health` reports the loaded model.

## Settings

Environment variables: `WHISPER_MODEL` (default `small`; try `medium` for Marathi), `WHISPER_DEVICE` (`auto`, `cpu` or `cuda`), `WHISPER_COMPUTE`, and `WHISPER_PRELOAD=0` to skip loading the model at startup.

## Status

The recorder page was tested in a headless browser against a mocked endpoint, and `speech.py` against a stand-in model. It has not yet been run against the real faster-whisper model or real Hindi, Hinglish or Marathi speech.

## Hooking it into the main app

The page fires a `transcript:ready` event and exposes `window.GemmaKhata.getTranscript()` so the extraction step can read the transcript.
