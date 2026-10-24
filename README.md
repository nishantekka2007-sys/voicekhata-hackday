# VoiceKhata

**A voice-first digital khata for small shops and local vendors in India.**

VoiceKhata helps shopkeepers record credit sales, payments received and shop expenses using a review-before-save workflow.

## Stack

- Frontend: HTML, CSS, JavaScript
- Dashboard charts: Chart.js (values calculated from the signed-in user's real transactions)
- Backend API: Python + FastAPI
- Database: SQLite, with user-scoped transactions and integer paise storage
- Login: Google Identity Services (Google account sign-in; never collect Gmail passwords)
- Planned/integration point: Gemma via Ollama for transaction extraction, faster-whisper for voice transcription

## Current features in this branch

- Google sign-in foundation with backend token verification and audience checks
- A separate SQLite user profile and ledger for each Google account
- Authenticated transaction listing, saving, and summary endpoints
- Amount stored as integer paise; deterministic Python balance calculations
- Draft parsing endpoint that does not save anything until the user confirms
- Dashboard chart based on actual ledger transactions, not hard-coded chart figures
- API health and authentication tests

## Run the backend

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

Open API docs at http://127.0.0.1:8000/docs. See [backend/README.md](backend/README.md) for setting up the Google OAuth client.

## Run the frontend

In a second terminal:

With the virtual environment activated:

```bash
cd frontend
python3 -m http.server 5500
```

Open http://localhost:5500. Set `window.VOICEKHATA_API_BASE` before the app scripts if your API runs at a different URL.

## Google sign-in setup

In Google Cloud Console, configure the OAuth consent screen, create a **Web application** OAuth client ID, and add `http://localhost:5500` as an Authorized JavaScript origin for local development. Export that client ID as `GOOGLE_CLIENT_ID` when running FastAPI. For production, use HTTPS and configure your actual frontend origin in `VOICEKHATA_CORS_ORIGINS`.

## API endpoints

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`
- `GET /api/auth/me`
- `GET /api/transactions`
- `POST /api/transactions`
- `POST /api/transactions/parse`
- `GET /api/summary`

All ledger endpoints require a Google ID token in the Authorization header. The transaction parse route returns a draft only. Always review the name, amount and transaction type before confirming.

## Tests

```bash
python -m pip install -r backend/requirements.txt
pytest -q backend/tests
```

## Important MVP limitations

- Google Cloud OAuth setup must be completed by the project owner before sign-in works.
- The parser in this branch is a simple baseline, not the Gemma/Ollama extraction integration.
- The existing voice UI expects `POST /api/voice/transcribe`; connect faster-whisper to enable real audio transcription.
- This is a hackathon MVP, not yet a production financial service. Deploy with HTTPS, review security/session handling, and back up the database before using it with real customer data.

## Contributing

Use a feature branch and open a pull request. Keep transaction math deterministic and do not allow AI-extracted drafts to save without user confirmation.

## License

This project is licensed under the MIT License. See LICENSE.


## Publish the frontend

The frontend can be hosted as a static site with GitHub Pages. The workflow at `.github/workflows/pages.yml` publishes the `frontend/` directory when changes are pushed to `main`.

In the repository settings, open **Pages**, choose **GitHub Actions** as the build and deployment source, and wait for the **Deploy VoiceKhata frontend** workflow to finish successfully. The website URL is:

https://nishantekka2007-sys.github.io/voicekhata-hackday/

This is the browser-based demo: shop setup, dashboard, browser speech recognition (where supported), and browser-local demo entries. Browser-local entries stay in that browser and are not synchronized to other devices. The Python API, server-side Gemma transcription, authenticated accounts, and persistent shared database are not publicly hosted by GitHub Pages; deploy the backend separately and configure its API URL, CORS origins, and secrets before presenting those features as online services.
