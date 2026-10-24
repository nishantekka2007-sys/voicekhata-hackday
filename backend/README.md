# VoiceKhata FastAPI backend

## Run locally

Python 3.10+ recommended.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Set GOOGLE_CLIENT_ID in your shell or load backend/.env yourself.
export GOOGLE_CLIENT_ID="your-google-web-client-id.apps.googleusercontent.com"
export VOICEKHATA_DB_PATH="$PWD/backend/voicekhata.db"
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

## Google login setup

1. Open Google Cloud Console and configure the OAuth consent screen.
2. Create an OAuth client ID of type **Web application**.
3. Add the exact frontend origin (for local use: `http://localhost:5500`) to Authorized JavaScript origins.
4. Set `GOOGLE_CLIENT_ID` to that client ID before starting FastAPI.
5. Never ask a person for their Gmail password. Google Identity Services supplies an ID token; the backend validates it with Google's token endpoint and checks the audience.
6. Add production HTTPS origins to `VOICEKHATA_CORS_ORIGINS` before deployment.

The API verifies Google identity and stores only the user profile (Google subject, email, name, picture). It does not store the Google ID token. Each ledger query and transaction is scoped to the authenticated user's numeric ID.

## API

- `GET /api/health` — health check
- `GET /api/auth/config` — public Google client configuration
- `POST /api/auth/google` — verify the Google ID token and return profile
- `GET /api/auth/me` — current signed-in profile
- `GET /api/transactions` — current user's transactions
- `POST /api/transactions` — save one confirmed transaction
- `POST /api/transactions/parse` — return extracted draft (does not save)
- `GET /api/summary` — totals, customer balances and seven-day flow

Transaction amounts are stored as integer paise. Balances and summaries are computed with deterministic Python logic, not the language model. The parse endpoint is a conservative baseline; connect the team's Gemma/Ollama extraction service when available.
