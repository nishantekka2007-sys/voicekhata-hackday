# GemmaKhata — Voice-First Digital Ledger (Database & Ledger Engine)

A voice-first digital ledger web application for micro-vendors, kirana store owners, and local artisans in India. Allows vendors to speak natural multilingual sentences (Hindi, English, Hinglish, Marathi, etc.) to record customer credit (*udhaar*), payments (*jama*), calculate balances, and review financial insights.

---

## 📁 Repository Structure

```text
gemma-khata/
├── ledger.py           # Core SQLite schema, balance arithmetic, and aggregate queries
├── test_ledger.py      # Automated unit tests for database and financial logic
├── requirements.txt    # Project dependencies (FastAPI, Ollama, faster-whisper, etc.)
├── .gitignore          # Ignores Python bytecode and SQLite binary files
├── data/
│   └── .gitkeep        # Directory for the auto-generated SQLite database (ledger.db)
└── README.md
```

Upcoming modules to merge into this repository:
```text
├── main.py             # FastAPI backend API endpoints
├── gemma_ai.py         # Gemma 4 E2B via Ollama for transaction extraction
├── speech.py           # faster-whisper STT audio processor
├── templates/
│   └── index.html      # Responsive 3-screen frontend
└── static/
    ├── style.css       # Clean Kirana UI styling
    └── app.js          # Audio recording, editing cards & Chart.js integration
```

---

## 🛠️ Current Database Features (`ledger.py`)

- **Relational Schema**: `customers` and `transactions` tables with SQLite WAL mode and foreign key cascading.
- **Deduplication**: Case-insensitive and trimmed customer resolution (`get_or_create_customer`).
- **Atomic Multi-Transaction Batching**: Multiple transactions extracted from a single voice sentence (e.g. Ramesh payment + Suresh credit) are committed atomically.
- **Accurate Balance Math**:
  $$\text{Balance} = \sum \text{Credit (Udhaar)} - \sum \text{Payment (Jama)}$$
  - `> 0`: Pending (Lene Baaki)
  - `= 0`: Settled (Hisaab Barabar)
  - `< 0`: Advance (Dene Baaki)
- **Dashboard & Insights**: Aggregates for all-time totals, today's transactions, top debtors, and 7-day time series data for Chart.js.

---

## 🚀 How to Run & Verify

1. **Set up Python Virtual Environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Run Unit Tests**:
   ```bash
   python test_ledger.py
   ```

3. **Initialize Database with Sample Kirana Data**:
   ```bash
   python -c "import ledger; ledger.seed_sample_data()"
   ```
