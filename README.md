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
