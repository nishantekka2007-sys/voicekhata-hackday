"""Small, deterministic SQLite ledger for VoiceKhata."""
from pathlib import Path
import sqlite3

DEFAULT_DB_PATH = Path("voicekhata.db")


def connect(db_path=DEFAULT_DB_PATH):
    """Open a connection and ensure the transaction table exists."""
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('credit_sale', 'payment_received', 'cash_expense')),
            amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.commit()
    return connection


def add_transaction(connection, customer, kind, amount_rupees, note=""):
    """Save a confirmed transaction. Amount is accepted in rupees, stored as paise."""
    customer = customer.strip()
    if not customer:
        raise ValueError("Customer name is required.")
    if kind not in {"credit_sale", "payment_received", "cash_expense"}:
        raise ValueError("Unsupported transaction type.")
    if isinstance(amount_rupees, bool) or amount_rupees <= 0:
        raise ValueError("Amount must be greater than zero.")

    amount_paise = round(float(amount_rupees) * 100)
    if amount_paise <= 0:
        raise ValueError("Amount must be at least ₹0.01.")

    cursor = connection.execute(
        "INSERT INTO transactions (customer, kind, amount_paise, note) VALUES (?, ?, ?, ?)",
        (customer, kind, amount_paise, note.strip()),
    )
    connection.commit()
    return cursor.lastrowid


def list_transactions(connection, limit=100):
    return connection.execute(
        "SELECT * FROM transactions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()


def customer_balances(connection):
    """Return customer balances in rupees; credit adds, payments reduce."""
    rows = connection.execute(
        """
        SELECT customer,
               SUM(CASE
                   WHEN kind = 'credit_sale' THEN amount_paise
                   WHEN kind = 'payment_received' THEN -amount_paise
                   ELSE 0
               END) AS balance_paise
        FROM transactions
        WHERE kind IN ('credit_sale', 'payment_received')
        GROUP BY customer
        ORDER BY customer COLLATE NOCASE
        """
    ).fetchall()
    return {row["customer"]: row["balance_paise"] / 100 for row in rows}
