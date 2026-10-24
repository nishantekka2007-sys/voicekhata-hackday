# VoiceKhata

**A voice-first digital ledger for small vendors, designed for Gemma 4.**

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

MIT. See [LICENSE](LICENSE).
# GemmaKhata — Voice-First Digital Ledger

A multilingual, voice-first digital ledger web application for micro-vendors, kirana store owners, and local artisans in India. Vendors speak naturally in Hindi, English, Hinglish, or Marathi to record customer credit (*udhaar*), payments (*jama*), and instantly view balances and financial summaries.

---

## 📁 Repository Structure

```text
gemma-khata/
├── ledger.py           # SQLite schema, balance arithmetic, aggregate queries     [DONE]
├── gemma_ai.py         # Gemma 4 E2B via Ollama — transaction extraction           [DONE]
├── test_ledger.py      # Unit tests for database and financial logic               [DONE]
├── test_gemma_ai.py    # Unit tests for AI extraction engine (works offline)       [DONE]
├── requirements.txt    # Python dependencies
├── .gitignore
├── data/
│   └── .gitkeep        # Auto-generated ledger.db lives here (git-ignored)
│
│   ── Coming next ──
├── speech.py           # faster-whisper audio → text processor
├── main.py             # FastAPI REST API endpoints
├── templates/
│   └── index.html      # Responsive 3-screen frontend
└── static/
    ├── style.css       # Kirana-friendly UI styles
    └── app.js          # Mic recording, confirmation cards, Chart.js
```

---

## Tech Stack

| Component        | Technology                  |
|------------------|-----------------------------|
| Web Frontend     | HTML, CSS, JavaScript       |
| Backend          | Python + FastAPI            |
| Main AI          | Gemma 4 E2B via Ollama      |
| Speech-to-Text   | faster-whisper              |
| Database         | SQLite                      |
| Dashboard Charts | Chart.js                    |

---

## Modules Complete

### 1. `ledger.py` — SQLite Database Engine
- Relational schema: `customers` + `transactions` tables with WAL mode and FK cascading
- Case-insensitive customer deduplication (`"ramesh"` == `"Ramesh"`)
- Atomic multi-transaction batching (one voice recording → multiple DB writes)
- Balance = Credit (Udhaar) - Payment (Jama) → Pending / Settled / Advance
- Insights API: all-time totals, today's transactions, top debtors, 7-day Chart.js dataset

### 2. `gemma_ai.py` — Gemma 4 E2B AI Engine
- Sends transcribed voice text to `gemma4:e2b` via Ollama
- Extracts multiple transactions from one Hindi/English/Hinglish sentence
- Normalizes Hindi type words: `udhaar` → `credit`, `jama` → `payment`
- Marks missing fields (`amount`, `customer_name`) as `needs_confirmation: true`
- Handles markdown-fenced JSON, single objects, and has a regex fallback
- `get_ledger_summary()` generates friendly Hindi/English financial summaries for Screen 3

---

## Setup & Run

### Prerequisites
```bash
# 1. Install Ollama
# https://ollama.com/download

# 2. Pull Gemma 4 E2B
ollama pull gemma4:e2b

# 3. Start Ollama
ollama serve
```

### Install Python Dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Run All Tests (works fully offline — no Ollama needed)
```bash
python test_ledger.py      # 5 tests
python test_gemma_ai.py    # 17 tests
```

### Seed Sample Data
```bash
python -c "import ledger; ledger.seed_sample_data()"
```

### Test Live Gemma Extraction (Ollama must be running)
```bash
python gemma_ai.py
```

---

## Example — Voice to Transactions

**Shopkeeper says:**
> "Ramesh ne 500 rupaye diye aur Suresh ko 200 rupaye ka chawal udhaar diya."

**Gemma extracts:**
| Customer | Type    | Amount | Item   |
|----------|---------|--------|--------|
| Ramesh   | payment | Rs.500 | —      |
| Suresh   | credit  | Rs.200 | Chawal |

Both transactions are shown as editable cards. Nothing is saved until the shopkeeper confirms.

0132778342cd790763f979573e76e907060987b5
