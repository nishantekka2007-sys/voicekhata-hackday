"""VoiceKhata FastAPI backend: SQLite ledger and Google OAuth authentication.

Google OAuth is optional in local development. Configure GOOGLE_CLIENT_ID to enable
the Google Identity Services sign-in button in the frontend. Never collect Gmail passwords.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("VOICEKHATA_DB_PATH", str(ROOT / "voicekhata.db")))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "VOICEKHATA_CORS_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="VoiceKhata API", version="0.2.0", description="Voice-first digital khata API")
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
    """Resolve a verified Google identity token; tokens are never stored in SQLite."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in with Google to continue.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing access credential.")
    return _upsert_user(_verify_google_token(token))

def public_transaction(row: sqlite3.Row | dict) -> dict:
    item = dict(row)
    item["amount"] = item.pop("amount_paise") / 100
    return item


@app.get("/api/health")
def health():
    init_db()
    return {"status": "ok", "service": "VoiceKhata API", "database": "sqlite"}


@app.get("/api/auth/config")
def auth_config():
    return {"google_client_id": GOOGLE_CLIENT_ID, "google_login_enabled": bool(GOOGLE_CLIENT_ID)}


@app.post("/api/auth/google")
def google_login(body: GoogleCredential):
    """Verify a Google Identity Services ID token and return the profile."""
    return _profile(_upsert_user(_verify_google_token(body.credential)))

def _profile(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "picture": user["picture"], "created_at": user["created_at"],
    }


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
    return {"transactions": [public_transaction(row) for row in rows]}


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
    return public_transaction(row)


@app.get("/api/summary")
def get_summary(user: dict = Depends(authenticated_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    transactions = [public_transaction(row) for row in rows]
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
    credit_given = [
        item for item in transactions if item["kind"] == "credit_sale"
    ]
    payments = [
        item for item in transactions if item["kind"] == "payment_received"
    ]
    return {
        "total_due": round(sum(max(0.0, amount) for amount in balances.values()), 2),
        "collected_today": round(collected_today, 2),
        "credit_today": round(credit_today, 2),
        "active_customers": len(balances),
        "customers": [
            {"customer": name, "balance": round(balance, 2)}
            for name, balance in sorted(balances.items(), key=lambda entry: entry[0].casefold())
        ],
        "daily_flow": _daily_flow(credit_given, payments),
    }


def _daily_flow(credit_rows: list[dict], payment_rows: list[dict]) -> list[dict]:
    from datetime import timedelta
    dates = [datetime.now(timezone.utc).date() - timedelta(days=offset) for offset in range(6, -1, -1)]
    result = []
    for day in dates:
        key = day.isoformat()
        result.append({
            "date": key,
            "credit": round(sum(x["amount"] for x in credit_rows if x["created_at"].startswith(key)), 2),
            "payments": round(sum(x["amount"] for x in payment_rows if x["created_at"].startswith(key)), 2),
        })
    return result


@app.post("/api/transactions/parse")
def parse_transaction(body: TransactionParse, user: dict = Depends(authenticated_user)):
    """Conservative fallback parser. Returns a draft only; it never inserts a row."""
    import re
    text = body.text.strip()
    amount_match = re.search(r"(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:\s*(?:rupees?|rs\.?))?", text, re.I)
    amount = float(amount_match.group(1).replace(",", "")) if amount_match else 0.0
    lowered = text.casefold()
    kind: Kind = "payment_received" if re.search(r"\b(paid|payment|repaid|returned|collected)\b", lowered) else (
        "cash_expense" if re.search(r"\b(expense|electricity bill|rent|shop purchase)\b", lowered) else "credit_sale"
    )
    customer_text = text
    if amount_match:
        customer_text = customer_text.replace(amount_match.group(0), " ")
    customer_text = re.sub(r"\b(on credit|as credit|credit|worth of|worth|rupees?|paid|payment|gave me|repaid|returned|collected|took|bought|for|to|from|the|me|and)\b", " ", customer_text, flags=re.I)
    customer_text = re.sub(r"[₹,:]", " ", customer_text)
    customer_text = re.sub(r"\s+", " ", customer_text).strip()
    customer = " ".join(customer_text.split()[:2]).title()
    return {"customer": customer, "kind": kind, "amount": amount, "note": text, "requires_confirmation": True}
