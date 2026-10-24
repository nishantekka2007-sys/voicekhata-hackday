"""
GemmaKhata — FastAPI Backend
=============================
REST API server connecting all modules:
  - speech.py   → /api/transcribe
  - gemma_ai.py → /api/extract
  - ledger.py   → /api/transactions, /api/customers, /api/insights
  - Frontend    → Serves index.html, style.css, app.js

Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

import ledger
import gemma_ai
import speech

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="GemmaKhata",
    description="Voice-First Digital Ledger for Kirana Store Owners",
    version="1.0.0"
)

# CORS (allow browser mic & fetch calls)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


# ---------------------------------------------------------------------------
# Startup — Initialize database
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    ledger.init_db()


# ---------------------------------------------------------------------------
# Frontend — Serve the single-page app
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serves the main GemmaKhata web app."""
    html_path = BASE_DIR / "templates" / "index.html"
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# API: Health Check
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    """Returns status of all backend services."""
    ollama_status = gemma_ai.check_ollama_connection()
    whisper_status = speech.get_model_status()
    return {
        "status": "ok",
        "ollama": ollama_status,
        "whisper": whisper_status
    }


# ---------------------------------------------------------------------------
# API: Speech-to-Text (Step 2 — Whisper transcription)
# ---------------------------------------------------------------------------
@app.post("/api/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("hi")
):
    """
    Accepts audio file from browser mic recording.
    Returns transcribed text in Hindi/English/Marathi.
    """
    audio_bytes = await audio.read()
    result = speech.transcribe_audio_bytes(audio_bytes, language=language)
    return result


# ---------------------------------------------------------------------------
# API: Gemma Transaction Extraction (Step 3 — AI parsing)
# ---------------------------------------------------------------------------
@app.post("/api/extract")
async def extract_transactions(text: str = Form(...)):
    """
    Takes transcribed text and uses Gemma to extract transactions.
    Returns structured JSON with customer names, amounts, types.
    """
    result = gemma_ai.extract_transactions(text)
    return result


# ---------------------------------------------------------------------------
# API: Save Confirmed Transactions (Step 5 — SQLite write)
# ---------------------------------------------------------------------------
@app.post("/api/transactions")
async def save_transactions(payload: dict):
    """
    Saves confirmed transactions to SQLite.
    Expects: {"transactions": [...], "raw_voice_text": "..."}
    """
    transactions = payload.get("transactions", [])
    raw_text = payload.get("raw_voice_text", "")

    if not transactions:
        raise HTTPException(status_code=400, detail="No transactions provided.")

    try:
        saved = ledger.record_batch_transactions(transactions, raw_voice_text=raw_text)
        return {"success": True, "saved": saved, "count": len(saved)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# API: Get All Customers with Balances (Screen 2 — Digital Ledger)
# ---------------------------------------------------------------------------
@app.get("/api/customers")
async def get_customers(search: str = Query("", description="Search by name or phone")):
    """Returns all customers with their current balances."""
    customers = ledger.get_all_customers_with_balance(search_query=search)
    return {"customers": customers, "count": len(customers)}


# ---------------------------------------------------------------------------
# API: Get Customer Transaction History (Screen 2 — detail view)
# ---------------------------------------------------------------------------
@app.get("/api/customers/{customer_id}/transactions")
async def get_customer_transactions(customer_id: int, limit: int = Query(100)):
    """Returns transaction history for a specific customer."""
    try:
        balance = ledger.get_customer_balance(customer_id)
        transactions = ledger.get_customer_transactions(customer_id, limit=limit)
        return {
            "customer": balance,
            "transactions": transactions,
            "count": len(transactions)
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# API: Get Recent Transactions
# ---------------------------------------------------------------------------
@app.get("/api/transactions/recent")
async def get_recent_transactions(limit: int = Query(20)):
    """Returns the most recent transactions across all customers."""
    txns = ledger.get_recent_transactions(limit=limit)
    return {"transactions": txns, "count": len(txns)}


# ---------------------------------------------------------------------------
# API: Delete a Transaction
# ---------------------------------------------------------------------------
@app.delete("/api/transactions/{tx_id}")
async def delete_transaction(tx_id: int):
    """Deletes a single transaction."""
    deleted = ledger.delete_transaction(tx_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return {"success": True, "deleted_id": tx_id}


# ---------------------------------------------------------------------------
# API: Quick Insights (Screen 3 — Dashboard with Chart.js data)
# ---------------------------------------------------------------------------
@app.get("/api/insights")
async def get_insights():
    """
    Returns comprehensive financial summary:
    - Total credit, payments, outstanding
    - Today's numbers
    - Top debtors
    - 7-day chart data for Chart.js
    - Plain-language summary
    """
    insights = ledger.get_ledger_insights()

    # Try generating an AI summary; fall back to pre-computed if Gemma is offline
    try:
        ai_summary = gemma_ai.get_ledger_summary(insights)
        insights["ai_summary"] = ai_summary
    except Exception:
        insights["ai_summary"] = insights.get("summary_text", "")

    return insights


# ---------------------------------------------------------------------------
# API: Seed Sample Data (for demo/testing)
# ---------------------------------------------------------------------------
@app.post("/api/seed")
async def seed_sample_data():
    """Seeds the database with sample kirana store transactions for demo."""
    ledger.seed_sample_data()
    return {"success": True, "message": "Sample data seeded successfully."}


# ---------------------------------------------------------------------------
# Run directly: python main.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    print("Starting GemmaKhata server at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
