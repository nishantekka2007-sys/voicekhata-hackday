# GemmaKhata — Voice-First Digital Ledger

A multilingual, voice-first digital ledger web application for micro-vendors, kirana store owners, and local artisans in India. Vendors speak naturally in Hindi, English, Hinglish, or Marathi to record customer credit (*udhaar*), payments (*jama*), and instantly view balances and financial summaries.

---

## 📁 Repository Structure

```text
gemma-khata/
├── main.py             # FastAPI backend — REST API server                      [DONE]
├── ledger.py           # SQLite schema, balance arithmetic, aggregate queries   [DONE]
├── gemma_ai.py         # Gemma 4 E2B via Ollama — transaction extraction        [DONE]
├── speech.py           # faster-whisper — audio to text transcription            [DONE]
├── test_ledger.py      # Unit tests — database & financial logic (5 tests)     [DONE]
├── test_gemma_ai.py    # Unit tests — AI extraction engine (17 tests)          [DONE]
├── test_speech.py      # Unit tests — speech-to-text engine (22 tests)         [DONE]
├── requirements.txt    # Python dependencies
├── .gitignore
├── templates/
│   └── index.html      # Responsive 3-screen frontend                          [DONE]
├── static/
│   ├── style.css       # Mobile-first kirana-friendly UI                       [DONE]
│   └── app.js          # Mic recording, Gemma cards, Chart.js dashboard        [DONE]
└── data/
    └── .gitkeep        # Auto-generated ledger.db lives here (git-ignored)
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

## How It Works

```
Step 1: Shopkeeper speaks → "Ramesh ne 500 rupaye diye aur Suresh ko 200 ka chawal udhaar diya"
Step 2: faster-whisper converts speech to text (Hindi/English/Marathi)
Step 3: Gemma 4 E2B extracts structured transactions (names, amounts, types)
Step 4: Shopkeeper reviews editable cards and confirms
Step 5: SQLite saves transactions and updates balances instantly
```

## Three Screens

1. **Voice Entry** — Large mic button, language selector, transcription, Gemma extraction, editable transaction cards
2. **Digital Ledger** — Customer search, balance display, transaction history modal
3. **Quick Insights** — Chart.js 7-day trend bar chart, credit/payment doughnut chart, top debtors, AI summary

---

## Setup & Run

### Prerequisites
```bash
# 1. Install Ollama: https://ollama.com/download
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

### Run the App
```bash
python main.py
# Opens at http://localhost:8000
```

### Run All Tests (44 tests — works fully offline)
```bash
python test_ledger.py      # 5 tests
python test_gemma_ai.py    # 17 tests
python test_speech.py      # 22 tests
```

### Seed Sample Data
```bash
python -c "import ledger; ledger.seed_sample_data()"
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Serves the web app |
| GET | `/api/health` | Check Ollama & Whisper status |
| POST | `/api/transcribe` | Audio → text (faster-whisper) |
| POST | `/api/extract` | Text → transactions (Gemma AI) |
| POST | `/api/transactions` | Save confirmed transactions |
| GET | `/api/customers` | List all customers with balances |
| GET | `/api/customers/{id}/transactions` | Customer transaction history |
| GET | `/api/transactions/recent` | Recent transactions |
| DELETE | `/api/transactions/{id}` | Delete a transaction |
| GET | `/api/insights` | Dashboard data with Chart.js datasets |
| POST | `/api/seed` | Seed sample kirana data |
