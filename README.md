# VoiceKhata

**A voice-first digital ledger for small vendors and local shops.**

VoiceKhata helps shopkeepers track credit sales (udhaar), payments received, and shop expenses through a simple ledger with a review-before-save workflow.

## Features

- Responsive dashboard with ledger-derived totals and money-flow chart
- Searchable transaction history
- Customer balance summaries
- Manual transaction entry with confirmation before saving
- Google Identity Services sign-in foundation
- FastAPI backend with SQLite and user-scoped transactions
- API health and authentication tests

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Python, FastAPI, Pydantic
- Database: SQLite; amounts stored as integer paise
- Charts: Chart.js
- Authentication: Google Identity Services

## Current limitations

- Google OAuth must be configured before private ledger actions can be used.
- Voice recording UI exists, but speech-to-text is not connected in this branch.
- Transaction parsing is a deterministic baseline, not a Gemma/Ollama integration. Always verify the extracted name, amount and transaction type.
- This is a hackathon MVP, not a production financial service. Use HTTPS, review session handling, and back up the database before entering real customer data.

## Run locally

Requires Python 3.10+.

### 1. Start the backend

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
export GOOGLE_CLIENT_ID="your-google-web-client-id.apps.googleusercontent.com"
export VOICEKHATA_DB_PATH="$PWD/backend/voicekhata.db"
export VOICEKHATA_CORS_ORIGINS="http://localhost:5500,http://127.0.0.1:5500"
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Backend health: http://127.0.0.1:8000/api/health  
Interactive API docs: http://127.0.0.1:8000/docs

### 2. Start the frontend

In a second terminal:

With the virtual environment activated:

```bash
cd frontend
python3 -m http.server 5500
```

Open http://localhost:5500.

## Google sign-in setup

In Google Cloud Console, configure the OAuth consent screen and create a **Web application** OAuth client ID. Add `http://localhost:5500` as an authorized JavaScript origin. Set `GOOGLE_CLIENT_ID` in the backend environment. For deployment, use HTTPS and configure the real frontend origin in `VOICEKHATA_CORS_ORIGINS`.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API and database health |
| GET | `/api/auth/config` | Login configuration |
| POST | `/api/auth/google` | Verify Google credential |
| GET | `/api/auth/me` | Current account |
| GET | `/api/transactions` | List signed-in user's transactions |
| POST | `/api/transactions` | Save a transaction |
| POST | `/api/transactions/parse` | Prepare an editable transaction draft |
| GET | `/api/summary` | Ledger totals and customer balances |

All ledger endpoints require Google authentication. Parsing returns a draft only; saving requires explicit confirmation.

## Test

```bash
python -m pip install -r backend/requirements.txt
pytest -q backend/tests
node --check frontend/app.js
node --check frontend/auth.js
```

## Contributing

1. Create a feature branch.
2. Keep balance calculations deterministic and preserve the confirmation-before-save workflow.
3. Run the tests and syntax checks.
4. Open a pull request describing the change and how it was tested.

## License

MIT — see [LICENSE](LICENSE).
