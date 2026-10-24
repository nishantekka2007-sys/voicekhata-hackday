
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "khata.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()

    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                phone TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                type TEXT NOT NULL
                    CHECK(type IN ('credit', 'payment')),
                amount_paise INTEGER NOT NULL
                    CHECK(amount_paise > 0),
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(customer_id) REFERENCES customers(id)
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_customer
            ON transactions(customer_id);
        """)
        conn.commit()
    finally:
        conn.close()


def create_customer(name, phone=""):
    name = name.strip()

    if not name:
        raise ValueError("Customer name is required")

    conn = get_connection()

    try:
        cursor = conn.execute(
            "INSERT INTO customers (name, phone) VALUES (?, ?)",
            (name, phone.strip()),
        )
        conn.commit()

        return {
            "id": cursor.lastrowid,
            "name": name,
            "phone": phone.strip(),
        }
    finally:
        conn.close()


def list_customers():
    conn = get_connection()

    try:
        rows = conn.execute("""
            SELECT
                c.id,
                c.name,
                c.phone,
                COALESCE(SUM(
                    CASE
                        WHEN t.type = 'credit'
                            THEN t.amount_paise
                        ELSE -t.amount_paise
                    END
                ), 0) AS balance_paise
            FROM customers c
            LEFT JOIN transactions t
                ON t.customer_id = c.id
            GROUP BY c.id
            ORDER BY c.name COLLATE NOCASE
        """).fetchall()

        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_customer(customer_id):
    conn = get_connection()

    try:
        row = conn.execute(
            "SELECT id, name, phone, created_at "
            "FROM customers WHERE id = ?",
            (customer_id,),
        ).fetchone()

        return dict(row) if row else None
    finally:
        conn.close()


def get_balance(customer_id):
    conn = get_connection()

    try:
        row = conn.execute("""
            SELECT COALESCE(SUM(
                CASE
                    WHEN type = 'credit' THEN amount_paise
                    ELSE -amount_paise
                END
            ), 0) AS balance_paise
            FROM transactions
            WHERE customer_id = ?
        """, (customer_id,)).fetchone()

        return int(row["balance_paise"])
    finally:
        conn.close()


def create_transaction(customer_id, transaction_type,
                       amount_paise, note=""):
    if transaction_type not in {"credit", "payment"}:
        raise ValueError("Type must be credit or payment")

    if (
        isinstance(amount_paise, bool)
        or not isinstance(amount_paise, int)
        or amount_paise <= 0
    ):
        raise ValueError("Amount must be positive integer paise")

    conn = get_connection()

    try:
        customer = conn.execute(
            "SELECT id FROM customers WHERE id = ?",
            (customer_id,),
        ).fetchone()

        if customer is None:
            raise ValueError("Customer not found")

        cursor = conn.execute("""
            INSERT INTO transactions
                (customer_id, type, amount_paise, note)
            VALUES (?, ?, ?, ?)
        """, (
            customer_id,
            transaction_type,
            amount_paise,
            note.strip(),
        ))

        conn.commit()

        transaction_id = cursor.lastrowid

        balance = conn.execute("""
            SELECT COALESCE(SUM(
                CASE
                    WHEN type = 'credit' THEN amount_paise
                    ELSE -amount_paise
                END
            ), 0) AS balance_paise
            FROM transactions
            WHERE customer_id = ?
        """, (customer_id,)).fetchone()["balance_paise"]

        return {
            "transaction_id": transaction_id,
            "customer_id": customer_id,
            "type": transaction_type,
            "amount_paise": amount_paise,
            "balance_paise": int(balance),
        }
    finally:
        conn.close()


def get_transactions(customer_id):
    conn = get_connection()

    try:
        rows = conn.execute("""
            SELECT id, customer_id, type, amount_paise,
                   note, created_at
            FROM transactions
            WHERE customer_id = ?
            ORDER BY id DESC
        """, (customer_id,)).fetchall()

        return [dict(row) for row in rows]
    finally:
        conn.close()


init_db()
