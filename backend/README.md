# VoiceKhata FastAPI backend

## Run locally

Requires Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
export GOOGLE_CLIENT_ID="your-google-web-client-id.apps.googleusercontent.com"
export VOICEKHATA_DB_PATH="$PWD/backend/voicekhata.db"
export VOICEKHATA_CORS_ORIGINS="http://localhost:5500,http://127.0.0.1:5500"
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

OpenAPI docs: http://127.0.0.1:8000/docs

## Google sign-in setup

1. Configure the OAuth consent screen in Google Cloud Console.
2. Create an OAuth client ID of type **Web application**.
3. Add `http://localhost:5500` under Authorized JavaScript origins.
4. Set `GOOGLE_CLIENT_ID` in the backend environment.
5. Do not collect Gmail passwords. Google Identity Services returns an ID token; FastAPI verifies the token with Google, checks the issuer and exact audience, and checks that the email is verified.
6. For production, use HTTPS and add the deployed frontend origin to `VOICEKHATA_CORS_ORIGINS`.

The backend stores Google subject ID, email and basic profile only; it does not store the ID token. Each ledger row includes `user_id`, and all ledger queries are scoped to that authenticated account.

## API routes

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`
- `GET /api/auth/me`
- `GET /api/transactions`
- `POST /api/transactions`
- `POST /api/transactions/parse` — returns an unsaved draft
- `GET /api/summary` — totals, balances, and seven-day flow

Money is stored as integer paise; Python performs balance arithmetic. The current parse route is a simple baseline. Replace/extend it with your Gemma/Ollama service when ready. The frontend's audio UI still needs a `POST /api/voice/transcribe` faster-whisper endpoint.
