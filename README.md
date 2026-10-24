# VoiceKhata

**A voice-first digital ledger for small vendors and local shops.**

VoiceKhata helps shopkeepers track credit sales (udhaar), payments received, and shop expenses through a simple ledger with a review-before-save workflow.

**Live prototype:** [Open VoiceKhata on GitHub Pages](https://nishantekka2007-sys.github.io/voicekhata-hackday/).

## Features

- Responsive dashboard with ledger-derived totals and money-flow chart
- Searchable transaction history
- Customer balance summaries
- Manual transaction entry with confirmation before saving
- Browser-based voice-to-text entry (Hindi, English, and Marathi) with editable transaction drafts
- Google Identity Services sign-in foundation
- FastAPI backend with SQLite and user-scoped transactions
- API health and authentication tests

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Python, FastAPI, Pydantic
- Database: SQLite; amounts stored as integer paise
- Charts: Chart.js
- Authentication: Google Identity Services

## Prototype behavior and limitations

- The GitHub Pages prototype is a browser-only demo. Shop details and saved demo transactions are stored in that browser's `localStorage`; they are not synced to the backend or across devices.
- Voice entry uses the browser's Web Speech API. The prototype offers Hindi, English, and Marathi. In recent Chrome versions, it attempts on-device recognition when a language pack is available and can prompt for a one-time download; English may use the US English on-device pack. Otherwise it falls back to the browser's online speech service, which can fail separately from normal browsing. Allow microphone access and use a compatible browser. Recognition support and accuracy depend on the browser and language pack.
- The transaction parser is a deterministic baseline, not a Gemma/Ollama integration. It prepares an editable draft; check the customer, amount, and transaction type before confirming.
- The FastAPI/SQLite API is a separate backend foundation. GitHub Pages currently serves the browser demo and does not connect that demo to the backend. The backend's private endpoints require Google OAuth and environment configuration.
- This is a hackathon MVP, not a production financial service. Do not enter real customer data until authentication, backend integration, security, and backups have been reviewed.

## Try the voice prototype

1. Open the [live demo](https://nishantekka2007-sys.github.io/voicekhata-hackday/) in Chrome or Edge.
2. Enter the shop owner's name and shop name, then open **Voice Entry**.
3. Select Hindi, English, or Marathi. Tap the microphone and allow access when prompted.
4. Speak a transaction, then tap the microphone again to stop. Review the transcribed text and choose **Understand Transaction**.
5. Verify or edit the suggested fields, confirm the transaction, and check the ledger. The saved demo data remains in that browser.

For a local frontend demo, open a terminal in the repository and run:

```bash
cd frontend
python3 -m http.server 5500
```

Then open http://localhost:5500. Microphone access works on `localhost` and HTTPS when supported by the browser.

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
