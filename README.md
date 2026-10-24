# VoiceKhata

**A voice-first digital khata for small shops and local vendors in India.**

VoiceKhata is a hackathon MVP that helps shopkeepers record customer credit sales and payments with a review-before-save workflow. The goal is to make everyday ledger entry easier using natural speech and a simple dashboard.

> **Project status:** Active prototype. The repository contains a FastAPI + SQLite application and a Gemma 4 audio-transcription endpoint. A public live demo has not been confirmed; use the local setup below. AI transcription, Google sign-in, and deployment should be tested in the target environment before relying on them.

## Links

- **Repository:** https://github.com/nishantekka2007-sys/voicekhata-hackday
- **Live website/demo:** Not deployed yet
- **API documentation (local):** http://127.0.0.1:8000/docs

## What it aims to do

- Capture a shopkeeper's voice recording from the web interface.
- Send audio to the FastAPI backend for transcription with Gemma 4.
- Let the user review transaction details before saving.
- Record customer, product, due amount, paid amount, and remaining amount.
- Store transactions in SQLite and display ledger summaries.
- Keep transaction data scoped to the signed-in Google account when Google OAuth is configured.

For a credit sale, the remaining amount is calculated as **due amount − paid amount**. Review the draft before saving; speech recognition can make mistakes.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| API | Python, FastAPI, Uvicorn |
| AI audio transcription | Hugging Face Transformers pipeline configured for google/gemma-4-E2B-it |
| Audio conversion | FFmpeg |
| Database | SQLite |
| Authentication | Google Identity Services / Google ID-token verification |
| Tests | pytest |

## Repository layout

\`\`\`text
voicekhata-hackday/
├── backend/
│   ├── main.py              # FastAPI routes, auth, SQLite, voice transcription
│   ├── requirements.txt     # Backend Python dependencies
│   ├── README.md            # Backend setup and API notes
│   └── tests/               # Backend tests (where present)
├── frontend/
│   ├── index.html           # Main web interface
│   ├── app.js               # UI and API interactions
│   └── styles.css           # Interface styles
├── tests/                   # Additional project tests
├── app.py                   # Earlier prototype entry point
├── ledger.py                # Ledger/data logic from the prototype
├── gemma_ai.py              # Earlier Gemma extraction prototype
├── test_ledger.py           # Ledger tests for the prototype
├── test_gemma_ai.py         # AI extraction tests for the prototype
├── requirements.txt         # Root/prototype dependencies
├── .gitignore
├── LICENSE
└── README.md
\`\`\`

The root-level prototype modules are retained for reference. The current web API entry point is backend/main.py.

## Quick start

### 1. Prerequisites

Install:

- Python 3.10 or newer
- Git
- FFmpeg
- Enough memory and disk space for the selected Gemma model and its dependencies

On macOS, install FFmpeg with Homebrew if needed:

\`\`\`bash
brew install ffmpeg
\`\`\`

### 2. Clone the repository

\`\`\`bash
git clone https://github.com/nishantekka2007-sys/voicekhata-hackday.git
cd voicekhata-hackday
\`\`\`

To use the current Gemma voice-entry work before it is merged into main:

\`\`\`bash
git switch feat/gemma4-voice-entry
\`\`\`

### 3. Create a virtual environment and install dependencies

Run these commands from the repository root:

\`\`\`bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
\`\`\`

### 4. Configure Google sign-in

Google sign-in is optional for starting the server, but authenticated ledger endpoints require a configured Google Web OAuth client.

1. In Google Cloud Console, configure the OAuth consent screen.
2. Create an OAuth client ID of type **Web application**.
3. Add http://localhost:5500 and http://127.0.0.1:5500 as authorized JavaScript origins for local development.
4. Set the client ID in your terminal:

\`\`\`bash
export GOOGLE_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
export VOICEKHATA_CORS_ORIGINS="http://localhost:5500,http://127.0.0.1:5500"
\`\`\`

Do not commit real credentials or put secrets in frontend code. The application verifies Google ID tokens; it should never ask users for their Google password.

### 5. Start the backend

From the repository root, with the virtual environment activated:

\`\`\`bash
uvicorn main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
\`\`\`

Keep this terminal open. Verify the API health endpoint at http://127.0.0.1:8000/api/health and open the interactive API docs at http://127.0.0.1:8000/docs.

If port 8000 is already in use, check the process before stopping it:

\`\`\`bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
\`\`\`

### 6. Start the frontend

Open a second terminal in the repository root:

\`\`\`bash
python3 -m http.server 5500 --directory frontend
\`\`\`

Then open http://localhost:5500 in your browser.

### 7. First voice-transcription request

The first transcription request may take time because the configured model and model dependencies may need to load. Ensure the machine has sufficient memory and internet access for model downloads. The endpoint converts uploaded audio to mono 16 kHz WAV with FFmpeg before sending it to the model.

The voice endpoint is:

\`\`\`text
POST /api/voice/transcribe
\`\`\`

It accepts an audio file and an optional language field. It returns recognized text and does **not** save a transaction. Always check the transcript and transaction fields before saving.

## Data and privacy notes

- SQLite data is stored locally by default at backend/voicekhata.db.
- Set VOICEKHATA_DB_PATH to choose another database path.
- Database files and environment files should stay out of Git.
- When Google OAuth is enabled, ledger routes require a valid Google ID token and filter transactions by the authenticated user.
- Do not use real customer or financial data in a public demo without appropriate security, access controls, backups, and privacy review.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/health | Health and service information |
| GET | /api/auth/config | Frontend authentication configuration |
| POST | /api/auth/google | Verify Google sign-in credential |
| GET | /api/auth/me | Current signed-in profile |
| GET | /api/transactions | List the signed-in user's transactions |
| POST | /api/transactions | Save a reviewed transaction |
| POST | /api/transactions/parse | Return a transaction draft from text |
| POST | /api/voice/transcribe | Transcribe uploaded audio; does not save a transaction |
| GET | /api/summary | Ledger totals and daily summary |

See the automatically generated API docs at http://127.0.0.1:8000/docs while the backend is running.

## Run tests

With the virtual environment activated:

\`\`\`bash
pytest -q backend/tests
\`\`\`

The repository also contains prototype tests at the root:

\`\`\`bash
python -m pytest -q test_ledger.py test_gemma_ai.py
\`\`\`

Run the tests relevant to the code you change and include the results in your pull request. Tests passing does not by itself verify live Google OAuth or model transcription.

## Contributing

We welcome contributions from the hackathon team and other contributors.

1. Create a branch for your change: feat/short-description or fix/short-description.
2. Keep changes focused and avoid committing local databases, credentials, virtual environments, or model files.
3. Run relevant tests and basic syntax checks.
4. Open a pull request to main, describe the change, and include screenshots or test output where useful.
5. Ask for review before merging.

See CONTRIBUTING.md for the collaboration workflow.

## Known limitations

- This is a hackathon MVP, not a production-ready accounting or financial service.
- The live website has not been confirmed as deployed.
- Gemma model availability, compatibility, memory use, and transcription quality depend on the runtime environment; test before presenting.
- Google OAuth must be configured separately for authenticated ledger features.
- Review AI-generated transcripts and transaction fields before saving.
- Production deployment requires HTTPS, correct CORS configuration, security/session review, monitoring, and database backup/restore procedures.

## License

This project is licensed under the MIT License. See LICENSE.
