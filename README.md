# VoiceKhata

**A voice-first digital ledger for small vendors and local shops.**

VoiceKhata helps shopkeepers track credit sales (udhaar), payments received, and shop expenses through a simple ledger with a review-before-save workflow.

**Live prototype:** [Open VoiceKhata on GitHub Pages](https://nishantekka2007-sys.github.io/voicekhata-hackday/).

## Frontend and backend integration (October 2026)

All earlier feature branches and pull requests are already ancestors of `main`. The combined site now supports two **explicit modes**:

- **Public GitHub Pages preview:** Works without a server, uses local Whisper for browser voice input and stores demo transactions only in that browser. It does **not** sync financial data.
- **Authenticated full-stack app:** FastAPI serves the exact same `frontend/index.html` at `/`, and `/api` routes handle Google sign-in and private SQLite transactions. After Google sign-in, the existing review form saves to the API and reloads its ledger from SQLite. Failed server writes do not silently become local demo records.

### Run the combined website locally

```bash
git clone https://github.com/nishantekka2007-sys/voicekhata-hackday.git
cd voicekhata-hackday
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
export GOOGLE_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID"
export VOICEKHATA_CORS_ORIGINS="http://localhost:8000,http://127.0.0.1:8000"
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/** to use the combined site; verify **http://127.0.0.1:8000/api/health**. Configure the Google OAuth Web application to authorize `http://127.0.0.1:8000` as a JavaScript origin. The account login only works after `GOOGLE_CLIENT_ID` is set.

**Optional local Gemma parsing:** Run `ollama pull gemma4:e2b`, start Ollama, then set `VOICEKHATA_USE_GEMMA=1` before starting FastAPI. Otherwise the current conservative parser is used. Gemma extraction is a draft only; customers must check and confirm amounts.

### Make GitHub Pages use the real backend

GitHub Pages **cannot run Python, FastAPI, Ollama or SQLite**. To sync from `https://nishantekka2007-sys.github.io/voicekhata-hackday/`, independently deploy the FastAPI service to a persistent HTTPS host, configure:

1. `GOOGLE_CLIENT_ID` with Google OAuth origin `https://nishantekka2007-sys.github.io`.
2. `VOICEKHATA_CORS_ORIGINS=https://nishantekka2007-sys.github.io` on the hosted backend.
3. Persistent database storage via `VOICEKHATA_DB_PATH`, on a mounted volume. Avoid temporary filesystem storage for real data.
4. `frontend/config.js` to set `window.VOICEKHATA_API_BASE = "https://YOUR-BACKEND-URL/api";` (HTTPS only), commit this public URL to `main`, and let the Pages deployment run.

The public backend URL is not a secret. **Do not store Google client secrets, tokens, or other API keys in `frontend/config.js`.** Without a deployed backend URL, Pages intentionally remains preview-only. Running Ollama on a laptop does not make it accessible to a publicly hosted backend.

### Integration verification

```bash
python -m pip install -r backend/requirements.txt
pytest -q backend/tests
node --check frontend/cloud.js
node --check frontend/config.js
node --check frontend/whisper-stt.js
```

Test signing in, saving a transaction, reloading the browser, and confirming the same private ledger entries persist. Use fake transaction data while security and deployment are under review.

## October 2026 reliability and language improvements

- The browser interface has a dedicated, tested Hindi/Hinglish/Marathi transaction parser. The *Hinglish / Auto detect* option no longer forces English transcription.
- Browser-local Whisper now uses the multilingual base model for improved Hindi accuracy where devices have sufficient resources. This is heavier than the previous tiny model: first download may be larger and CPU/mobile inference may be slower. Actual accuracy depends on accent, microphone and device. Always review transcription and fields before saving.
- Silent audio, short recordings and some unreliable stock transcripts now produce clearer retry messages.
- One speech entry can be reviewed and saved at a time in the public interface. Multiple transactions in a sentence are flagged rather than silently dropped.
- The ledger supports CSV export from the currently loaded workspace. Keep downloaded customer information private.
- On GitHub Pages, **Google sign-in cannot work without an HTTPS-hosted FastAPI backend, configured Google OAuth client ID, approved JavaScript origin and CORS**. The site shows an explicit offline workspace status instead of pretending login or cloud sync is active.
- Regression tests for Hindi script, Hindi digits, Hinglish, missing amounts and multi-entry detection run in GitHub Actions.

Use the working demo with *fictional* customers and balances. Avoid real financial records until authentication and production storage are properly configured.

## Speech and login troubleshooting (October 2026)

### Voice entry on the GitHub Pages demo

- The previous Whisper loader was broken by a JavaScript comment accidentally hiding the model declaration; this has been corrected.
- **Browser speech (default):** On Chrome/Edge, select Hindi or Hinglish, press the microphone, speak, and press it again to stop. Browser speech can rely on an online recognition service. It does **not** require a Whisper model download.
- **Local Whisper (optional):** Select *Local Whisper* for on-device audio transcription. It downloads the open-source multilingual `whisper-tiny` model. Browser extensions, blocked CDNs, memory and device performance can still prevent a model from loading; in that case choose Browser speech or type your transaction.
- Audio and automatic parsing can be inaccurate, especially for names and amounts. Check and correct the review form before saving. The public browser demo is not a production accounting service.

### Google sign-in on GitHub Pages

The public GitHub Pages URL is **not a Google-authenticated service** by itself. It provides a usable **on-device guest ledger** without a sign-in window. Google login and private SQLite syncing require a separately deployed HTTPS FastAPI API, a valid Google OAuth web client with `https://nishantekka2007-sys.github.io` as an authorized JavaScript origin, correctly configured CORS and the backend URL in `frontend/config.js`. We do not pretend local/browser-only data is cross-device synced.

## Start portal and Hindi voice fix (October 2026)

The first screen now offers a **local shop workspace portal**. New shops enter owner name, shop name and a 6–10 digit device PIN. An existing shop profile is preserved and can add a device PIN without deleting its ledger. Returning users can unlock their device-local workspace. This is a **convenience lock, not secure authentication or encryption**: all browser-local transactions remain readable by anyone with browser storage access. Do not treat the PIN as protection for sensitive customer data. For authenticated multi-device storage, separately host FastAPI with configured Google OAuth.

Hindi voice now defaults to **Local Whisper**, avoiding Chrome's remote Web Speech network dependency. The first use **still needs internet** to download Transformers.js and the multilingual model; the browser can cache them. Hindi/Hinglish first attempts quantized Whisper Base, then falls back to multilingual Tiny if the larger model fails. Recognition is not guaranteed and errors may still occur when the CDN is unreachable, the cache is cleared, or the device lacks sufficient memory. Review all recognized names and money values before saving; typing is always available.

The alternate Browser speech mode may use remote speech services and can return a network error even when other websites work.

## Features

- Responsive dashboard with ledger-derived totals and money-flow chart
- Searchable transaction history
- Customer-wise total credit, paid amount, remaining balance, and automatic paid-in-full check mark
- Automatic transaction date/time and delete actions with customer balances recalculated
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
- Voice entry records audio with the browser's MediaRecorder API and transcribes it in-browser with Transformers.js and the multilingual Whisper Tiny model. Audio is processed in your browser rather than sent to Chrome's remote speech-recognition service. The first use downloads the JavaScript runtime and model from public CDNs; later model use is cached by the browser. Recognition speed and accuracy depend on your device and the selected language.
- The transaction parser is a deterministic baseline, not a Gemma/Ollama integration. It prepares an editable draft; check the customer, amount, and transaction type before confirming.
- The FastAPI/SQLite API is a separate backend foundation. GitHub Pages currently serves the browser demo and does not connect that demo to the backend. The backend's private endpoints require Google OAuth and environment configuration.
- This is a hackathon MVP, not a production financial service. Do not enter real customer data until authentication, backend integration, security, and backups have been reviewed.

## Try the voice prototype

1. Open the [live demo](https://nishantekka2007-sys.github.io/voicekhata-hackday/) in Chrome or Edge.
2. Enter the shop owner's name and shop name, then open **Voice Entry**.
3. Select Hindi, English, or Marathi. Tap the microphone and allow access when prompted. On first use, the app downloads the browser-local speech model; keep the page open and the internet connected until loading finishes.
4. Speak a transaction, then tap the microphone again to stop. Whisper transcribes the recording in the browser. Review the text and choose **Understand Transaction**.
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
