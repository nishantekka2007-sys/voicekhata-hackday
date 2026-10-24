"""VoiceKhata FastAPI API with SQLite and Google OAuth."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import tempfile
from functools import lru_cache
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("VOICEKHATA_DB_PATH", str(ROOT / "voicekhata.db")))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "VOICEKHATA_CORS_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="VoiceKhata API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_sub TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT '',
            picture TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            customer TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('credit_sale','payment_received','cash_expense')),
            amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_user_created
            ON transactions(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_transactions_user_customer
            ON transactions(user_id, customer COLLATE NOCASE);
        """)


@app.on_event("startup")
def startup() -> None:
    init_db()


Kind = Literal["credit_sale", "payment_received", "cash_expense"]


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=20, max_length=10000)


class TransactionCreate(BaseModel):
    customer: str = Field(min_length=1, max_length=120)
    kind: Kind
    amount: float = Field(gt=0, le=100_000_000)
    note: str = Field(default="", max_length=1000)


class TransactionParse(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="auto", max_length=10)


def _verify_google_token(token: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google login is not configured. Set GOOGLE_CLIENT_ID.")
    try:
        response = httpx.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": token},
            timeout=8.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified.") from None

    if payload.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Google token audience does not match this app.")
    if payload.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Invalid Google token issuer.")
    if str(payload.get("email_verified")).lower() != "true":
        raise HTTPException(status_code=401, detail="Use a verified Google account.")
    if not payload.get("sub") or not payload.get("email"):
        raise HTTPException(status_code=401, detail="Google did not return a verified identity.")
    return payload


def _upsert_user(payload: dict) -> dict:
    google_sub = payload["sub"]
    email = str(payload["email"]).strip().lower()
    with db() as conn:
        conn.execute(
            """INSERT INTO users (google_sub, email, name, picture, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(google_sub) DO UPDATE SET
                 email=excluded.email, name=excluded.name, picture=excluded.picture""",
            (google_sub, email, payload.get("name", ""), payload.get("picture", ""), utc_now()),
        )
        row = conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Could not create user profile.")
        return dict(row)


def authenticated_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in with Google to continue.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing access credential.")
    return _upsert_user(_verify_google_token(token))


def _profile(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "picture": user["picture"], "created_at": user["created_at"],
    }


def _public_transaction(row: sqlite3.Row | dict) -> dict:
    item = dict(row)
    item["amount"] = item.pop("amount_paise") / 100
    return item


@app.get("/api/health")
def health():
    init_db()
    return {"status": "ok", "service": "VoiceKhata API", "database": "sqlite", "speech_model": os.getenv("GEMMA_MODEL_ID", "google/gemma-4-E2B-it")}


@lru_cache(maxsize=1)
def _gemma_audio_pipeline():
    """Load Gemma 4 on the first request rather than during API startup."""
    try:
        from transformers import pipeline
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Gemma 4 dependencies missing. Run pip install -r backend/requirements.txt.") from exc
    model_id = os.getenv("GEMMA_MODEL_ID", "google/gemma-4-E2B-it")
    try:
        return pipeline(task="any-to-any", model=model_id, device_map="auto", dtype="auto")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not load {model_id}. Check model access, memory, and Transformers installation.") from exc


@app.post("/api/voice/transcribe")
async def transcribe_voice(
    file: UploadFile = File(...),
    language: str = Form(default="auto"),
    authorization: str | None = Header(default=None),
):
    """Transcribe browser audio with Gemma 4. This endpoint never saves a transaction."""
    if GOOGLE_CLIENT_ID:
        if not authorization:
            raise HTTPException(status_code=401, detail="Sign in with Google before using voice entry.")
        authenticated_user(authorization)

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="The recording is empty. Please record again.")
    if len(audio_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large. Keep it under 30 seconds.")

    with tempfile.TemporaryDirectory(prefix="voicekhata-") as temp_dir:
        source = Path(temp_dir) / Path(file.filename or "recording.webm").name
        wav_path = Path(temp_dir) / "recording.wav"
        source.write_bytes(audio_bytes)
        try:
            converted = subprocess.run(
                ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                 "-vn", "-ac", "1", "-ar", "16000", "-t", "30", str(wav_path)],
                capture_output=True, text=True, timeout=25, check=False,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail="FFmpeg is required. Install it with: brew install ffmpeg.") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=408, detail="Audio conversion timed out. Try a shorter recording.") from exc
        if converted.returncode != 0 or not wav_path.exists() or wav_path.stat().st_size < 100:
            raise HTTPException(status_code=400, detail="Could not decode this browser recording. Please record again.")

        language_names = {"auto": "its original language", "en": "English", "hi": "Hindi", "bn": "Bengali"}
        target_language = language_names.get(language, "its original language")
        messages = [{"role": "user", "content": [
            {"type": "text", "text": f"Transcribe the following speech segment in {target_language} into text. Only output the transcription, with no newlines. Preserve the spoken language. Write spoken numbers as digits. Do not explain or summarize."},
            {"type": "audio", "audio": str(wav_path)},
        ]}]
        try:
            output = _gemma_audio_pipeline()(messages, return_full_text=False, generate_kwargs={"max_new_tokens": 128})
            transcript = str(output[0].get("generated_text", "")).strip()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Gemma 4 could not transcribe this recording. Try a clearer or shorter sentence.") from exc
        if not transcript:
            raise HTTPException(status_code=422, detail="Gemma 4 returned an empty transcript. Please speak clearly and retry.")
        return {"text": transcript, "transcript": transcript, "model": os.getenv("GEMMA_MODEL_ID", "google/gemma-4-E2B-it")}


@app.get("/api/auth/config")
def auth_config():
    return {"google_client_id": GOOGLE_CLIENT_ID, "google_login_enabled": bool(GOOGLE_CLIENT_ID)}


@app.post("/api/auth/google")
def google_login(body: GoogleCredential):
    return _profile(_upsert_user(_verify_google_token(body.credential)))


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(authenticated_user)):
    return _profile(user)


@app.get("/api/transactions")
def get_transactions(
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(authenticated_user),
):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
            (user["id"], limit),
        ).fetchall()
    return {"transactions": [_public_transaction(row) for row in rows]}


@app.post("/api/transactions", status_code=201)
def create_transaction(body: TransactionCreate, user: dict = Depends(authenticated_user)):
    customer = body.customer.strip()
    if not customer:
        raise HTTPException(status_code=422, detail="Customer name is required.")
    amount_paise = round(body.amount * 100)
    if amount_paise <= 0:
        raise HTTPException(status_code=422, detail="Amount must be at least ₹0.01.")
    with db() as conn:
        cursor = conn.execute(
            """INSERT INTO transactions (user_id, customer, kind, amount_paise, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user["id"], customer, body.kind, amount_paise, body.note.strip(), utc_now()),
        )
        row = conn.execute("SELECT * FROM transactions WHERE id=?", (cursor.lastrowid,)).fetchone()
    return _public_transaction(row)


@app.get("/api/summary")
def get_summary(user: dict = Depends(authenticated_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    transactions = [_public_transaction(row) for row in rows]
    balances: dict[str, float] = {}
    today = datetime.now(timezone.utc).date().isoformat()
    collected_today = credit_today = 0.0
    for item in transactions:
        if item["kind"] != "cash_expense":
            balances[item["customer"]] = balances.get(item["customer"], 0.0) + (
                item["amount"] if item["kind"] == "credit_sale" else -item["amount"]
            )
        if item["created_at"].startswith(today):
            if item["kind"] == "payment_received":
                collected_today += item["amount"]
            elif item["kind"] == "credit_sale":
                credit_today += item["amount"]
    credit_rows = [x for x in transactions if x["kind"] == "credit_sale"]
    payment_rows = [x for x in transactions if x["kind"] == "payment_received"]
    return {
        "total_due": round(sum(max(0.0, amount) for amount in balances.values()), 2),
        "collected_today": round(collected_today, 2),
        "credit_today": round(credit_today, 2),
        "active_customers": len(balances),
        "customers": [
            {"customer": name, "balance": round(balance, 2)}
            for name, balance in sorted(balances.items(), key=lambda entry: entry[0].casefold())
        ],
        "daily_flow": _daily_flow(credit_rows, payment_rows),
    }


def _daily_flow(credit_rows: list[dict], payment_rows: list[dict]) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    dates = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    return [
        {
            "date": day.isoformat(),
            "credit": round(sum(x["amount"] for x in credit_rows if x["created_at"].startswith(day.isoformat())), 2),
            "payments": round(sum(x["amount"] for x in payment_rows if x["created_at"].startswith(day.isoformat())), 2),
        }
        for day in dates
    ]


@app.post("/api/transactions/parse")
def parse_transaction(body: TransactionParse, user: dict = Depends(authenticated_user)):
    """Conservative parser. Returns a draft only; it never inserts a row."""
    import re
    text = body.text.strip()
    amount_match = re.search(
        r"(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:\s*(?:rupees?|rs\.?))?",
        text, re.I,
    )
    amount = float(amount_match.group(1).replace(",", "")) if amount_match else 0.0
    lowered = text.casefold()
    kind: Kind = "payment_received" if re.search(
        r"\b(paid|payment|repaid|returned|collected)\b", lowered
    ) else (
        "cash_expense" if re.search(r"\b(expense|electricity bill|rent|shop purchase)\b", lowered)
        else "credit_sale"
    )
    customer_text = text
    if amount_match:
        customer_text = customer_text.replace(amount_match.group(0), " ")
    customer_text = re.sub(
        r"\b(on credit|as credit|credit|worth of|worth|rupees?|paid|payment|gave me|repaid|returned|collected|took|bought|for|to|from|the|me|and)\b",
        " ", customer_text, flags=re.I,
    )
    customer_text = re.sub(r"[₹,:]", " ", customer_text)
    customer_text = re.sub(r"\s+", " ", customer_text).strip()
    customer = " ".join(customer_text.split()[:2]).title()
    return {
        "customer": customer, "kind": kind, "amount": amount, "note": text,
        "requires_confirmation": True,
    }
