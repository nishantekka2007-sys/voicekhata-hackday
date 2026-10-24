# VoiceKhata – Your Shop, In Your Words

**VoiceKhata** is a voice‑first digital ledger designed for small vendors and local shops. It lets you record transactions with Hindi, English, or Marathi speech, automatically transcribes them, and saves them to a ledger.

---

## Live Demo

Explore the live GitHub Pages demo:

- **WEB URL:** https://nishantekka2007-sys.github.io/voicekhata-hackday/?utm_source=chatgpt.com

The demo runs entirely in the browser – no server is required. Transactions are stored locally in `localStorage` and are **not** synced to a backend.

---

## Key Features

- **Voice‑first entry** – record credit sales, payments, and expenses using speech.
- **Multilingual support** – Hindi, Hinglish, Marathi, and English.
- **On‑device Whisper** – optional local Whisper model for higher accuracy (downloads on first use).
- **Review‑before‑save workflow** – edit the transcription and parsed fields before committing.
- **Responsive dashboard** – view totals, customer balances, and recent activity.
- **FastAPI backend (optional)** – when deployed with Google sign‑in, data is stored in SQLite and syncs across devices.

---

## Running Locally (Full‑stack)

```bash
# Clone the repository
git clone https://github.com/nishantekka2007-sys/voicekhata-hackday.git
cd voicekhata-hackday

# Backend setup
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
export GOOGLE_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID"
export VOICEKHATA_CORS_ORIGINS="http://localhost:5500,http://127.0.0.1:5500"
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# Frontend (static) server
cd frontend
python3 -m http.server 5500
```

Open **http://localhost:5500** in a browser. After signing in with Google, transactions are persisted in the backend SQLite database.

---

## Speech & Language Improvements (Oct 2026)

- Hindi/ Hinglish transcription now defaults to the multilingual Whisper model, fixing the previous Urdu fallback.
- Added configurable decoding parameters (`WHISPER_BEAM_SIZE`, `WHISPER_TEMPERATURE`, `WHISPER_PATIENCE`).
- Audio preprocessing ensures all recordings are normalized to 16 kHz mono wav.
- Better handling of silent/short audio and clearer retry messages.

---

## Contributing

Feel free to fork the repository, open issues, or submit pull requests. For frontend changes, make sure the demo still works in a browser without a backend.

---

## License

MIT License – see the [LICENSE](LICENSE) file for details.
