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
"""
GemmaKhata - SQLite Database & Digital Ledger Engine
Handles customer records, credit (udhaar), payments (jama), balances,
and real-time financial aggregation for micro-vendors and kirana shops.
"""

import os
import sqlite3
from datetime import datetime, date
from pathlib import Path
from typing import List, Dict, Any, Optional

# Default database directory and path
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "ledger.db"


def get_db_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """
    Creates and returns a connection to the SQLite database.
    Enables WAL mode and foreign keys for high concurrency and relational integrity.
    """
    target_path = Path(db_path) if db_path else DEFAULT_DB_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(target_path)
    conn.row_factory = sqlite3.Row  # Return rows as dict-like objects
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(db_path: Optional[Path] = None) -> None:
    """
    Initializes the SQLite schema:
    1. customers: Tracks customer names, contact, and registration time.
    2. transactions: Records every credit (udhaar) or payment (jama) event.
    Creates necessary indexes for lightning-fast lookups and balance calculations.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()

        # Customers table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                phone TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
        """)

        # Transactions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                customer_name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('credit', 'payment')),
                amount REAL NOT NULL CHECK(amount > 0),
                item_description TEXT DEFAULT '',
                raw_voice_text TEXT DEFAULT '',
                date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
        """)

        # Performance Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);")

        conn.commit()


def normalize_transaction_type(tx_type: str) -> str:
    """
    Normalizes different variants of transaction types:
    - 'udhaar', 'credit', 'debit', 'gave' -> 'credit' (Money owed by customer increases)
    - 'jama', 'payment', 'received', 'got' -> 'payment' (Money owed by customer decreases)
    """
    tx_type_clean = tx_type.strip().lower()
    if tx_type_clean in ('credit', 'udhaar', 'debit', 'gave', 'udhar'):
        return 'credit'
    elif tx_type_clean in ('payment', 'jama', 'received', 'got', 'paise mile', 'paid'):
        return 'payment'
    else:
        raise ValueError(f"Unknown transaction type: '{tx_type}'. Must be 'credit' or 'payment'.")


def get_or_create_customer(name: str, phone: Optional[str] = None, db_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Finds a customer by name (case-insensitive) or creates a new entry if not found.
    Trims whitespace and standardizes formatting.
    """
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Customer name cannot be empty.")

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM customers WHERE name = ? COLLATE NOCASE LIMIT 1;", (clean_name,))
        row = cursor.fetchone()

        if row:
            # If phone is provided and wasn't previously set, update it
            if phone and not row["phone"]:
                cursor.execute(
                    "UPDATE customers SET phone = ?, updated_at = datetime('now', 'localtime') WHERE id = ?;",
                    (phone.strip(), row["id"])
                )
                conn.commit()
                cursor.execute("SELECT * FROM customers WHERE id = ?;", (row["id"],))
                row = cursor.fetchone()
            return dict(row)

        # Create new customer
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            "INSERT INTO customers (name, phone, created_at, updated_at) VALUES (?, ?, ?, ?);",
            (clean_name, phone.strip() if phone else None, now, now)
        )
        conn.commit()
        customer_id = cursor.lastrowid

        cursor.execute("SELECT * FROM customers WHERE id = ?;", (customer_id,))
        return dict(cursor.fetchone())


def record_transaction(
    customer_name: str,
    tx_type: str,
    amount: float,
    item_description: str = "",
    raw_voice_text: str = "",
    date_str: Optional[str] = None,
    phone: Optional[str] = None,
    db_path: Optional[Path] = None
) -> Dict[str, Any]:
    """
    Records a single transaction (credit or payment) for a customer.
    Automatically ensures customer exists.
    """
    if amount <= 0:
        raise ValueError("Transaction amount must be greater than zero.")

    norm_type = normalize_transaction_type(tx_type)
    customer = get_or_create_customer(customer_name, phone=phone, db_path=db_path)
    tx_date = date_str if date_str else date.today().isoformat()

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO transactions (
                customer_id, customer_name, type, amount, item_description, raw_voice_text, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (
            customer["id"],
            customer["name"],
            norm_type,
            round(float(amount), 2),
            item_description.strip(),
            raw_voice_text.strip(),
            tx_date
        ))
        conn.commit()
        tx_id = cursor.lastrowid

        cursor.execute("SELECT * FROM transactions WHERE id = ?;", (tx_id,))
        saved_tx = dict(cursor.fetchone())

    # Return transaction details along with the new customer balance
    balance_info = get_customer_balance(customer["id"], db_path=db_path)
    saved_tx["current_balance"] = balance_info["balance"]
    saved_tx["balance_status"] = balance_info["status"]
    return saved_tx


def record_batch_transactions(
    transactions: List[Dict[str, Any]],
    raw_voice_text: str = "",
    db_path: Optional[Path] = None
) -> List[Dict[str, Any]]:
    """
    Atomically records multiple transactions extracted from a single voice recording
    (e.g., Ramesh payment + Suresh credit).
    Either all transactions succeed or none are committed.
    """
    if not transactions:
        return []

    saved_records = []
    with get_db_connection(db_path) as conn:
        try:
            cursor = conn.cursor()
            for tx in transactions:
                c_name = tx.get("customer_name", "").strip()
                if not c_name:
                    continue

                raw_amt = tx.get("amount", 0)
                try:
                    amount = round(float(raw_amt), 2)
                except (ValueError, TypeError):
                    continue

                if amount <= 0:
                    continue

                tx_type = normalize_transaction_type(tx.get("type", "credit"))
                item_desc = tx.get("item_description", "").strip()
                tx_date = tx.get("date") or date.today().isoformat()
                voice_text = tx.get("raw_voice_text", raw_voice_text)

                # Get or create customer within this transaction
                cursor.execute("SELECT * FROM customers WHERE name = ? COLLATE NOCASE LIMIT 1;", (c_name,))
                c_row = cursor.fetchone()
                if c_row:
                    customer_id = c_row["id"]
                    standard_name = c_row["name"]
                else:
                    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    cursor.execute(
                        "INSERT INTO customers (name, created_at, updated_at) VALUES (?, ?, ?);",
                        (c_name, now, now)
                    )
                    customer_id = cursor.lastrowid
                    standard_name = c_name

                cursor.execute("""
                    INSERT INTO transactions (
                        customer_id, customer_name, type, amount, item_description, raw_voice_text, date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (
                    customer_id,
                    standard_name,
                    tx_type,
                    amount,
                    item_desc,
                    voice_text,
                    tx_date
                ))
                saved_records.append(cursor.lastrowid)

            conn.commit()
        except Exception:
            conn.rollback()
            raise

    # Fetch recorded transactions
    result = []
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        for tx_id in saved_records:
            cursor.execute("SELECT * FROM transactions WHERE id = ?;", (tx_id,))
            row = dict(cursor.fetchone())
            bal_info = get_customer_balance(row["customer_id"], db_path=db_path)
            row["current_balance"] = bal_info["balance"]
            row["balance_status"] = bal_info["status"]
            result.append(row)

    return result


def get_customer_balance(customer_id: int, db_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Calculates the exact balance for a customer:
    - total_credit: Sum of all udhaar (credit) given to customer
    - total_payment: Sum of all payments (jama) made by customer
    - balance: total_credit - total_payment
        > 0 : Customer owes shopkeeper (Lene Baaki / Pending)
        = 0 : Settled (Hisaab Barabar)
        < 0 : Shopkeeper owes customer / Advance (Dene Baaki / Advance)
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, phone FROM customers WHERE id = ?;", (customer_id,))
        customer = cursor.fetchone()
        if not customer:
            raise ValueError(f"Customer with ID {customer_id} not found.")

        cursor.execute("""
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_credit,
                COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS total_payment,
                COUNT(id) AS tx_count
            FROM transactions
            WHERE customer_id = ?;
        """, (customer_id,))
        stats = cursor.fetchone()

        total_credit = round(stats["total_credit"], 2)
        total_payment = round(stats["total_payment"], 2)
        balance = round(total_credit - total_payment, 2)

        if balance > 0:
            status = "pending"  # Customer owes vendor
            status_label = "Pending (Lene Baaki)"
        elif balance < 0:
            status = "advance"  # Customer has advance credit
            status_label = "Advance (Dene Baaki)"
        else:
            status = "settled"  # Clean balance
            status_label = "Settled (Hisaab Barabar)"

        return {
            "customer_id": customer["id"],
            "customer_name": customer["name"],
            "phone": customer["phone"],
            "total_credit": total_credit,
            "total_payment": total_payment,
            "balance": balance,
            "status": status,
            "status_label": status_label,
            "transaction_count": stats["tx_count"]
        }


def get_all_customers_with_balance(search_query: str = "", db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """
    Returns all customers along with their current balances, total credit, and total payments.
    Supports filtering by search query (name or phone).
    Sorted with highest pending balances first.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()

        query = """
            SELECT 
                c.id,
                c.name,
                c.phone,
                c.created_at,
                c.updated_at,
                COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) AS total_credit,
                COALESCE(SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END), 0) AS total_payment,
                COUNT(t.id) AS transaction_count,
                MAX(t.date) AS last_transaction_date
            FROM customers c
            LEFT JOIN transactions t ON c.id = t.customer_id
        """
        params = []
        if search_query.strip():
            query += " WHERE c.name LIKE ? OR c.phone LIKE ?"
            term = f"%{search_query.strip()}%"
            params.extend([term, term])

        query += """
            GROUP BY c.id, c.name, c.phone, c.created_at, c.updated_at
            ORDER BY (COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) - 
                      COALESCE(SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END), 0)) DESC,
                     c.name ASC;
        """

        cursor.execute(query, params)
        rows = cursor.fetchall()

        results = []
        for row in rows:
            tot_credit = round(row["total_credit"], 2)
            tot_payment = round(row["total_payment"], 2)
            balance = round(tot_credit - tot_payment, 2)

            if balance > 0:
                status = "pending"
                status_label = "Pending"
            elif balance < 0:
                status = "advance"
                status_label = "Advance"
            else:
                status = "settled"
                status_label = "Settled"

            results.append({
                "id": row["id"],
                "name": row["name"],
                "phone": row["phone"],
                "total_credit": tot_credit,
                "total_payment": tot_payment,
                "balance": balance,
                "status": status,
                "status_label": status_label,
                "transaction_count": row["transaction_count"],
                "last_transaction_date": row["last_transaction_date"]
            })

        return results


def get_customer_transactions(customer_id: int, limit: int = 100, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """
    Returns the transaction history for a specific customer, ordered newest first.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM transactions 
            WHERE customer_id = ? 
            ORDER BY date DESC, id DESC 
            LIMIT ?;
        """, (customer_id, limit))
        return [dict(row) for row in cursor.fetchall()]


def get_recent_transactions(limit: int = 20, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """
    Returns the latest transactions across all customers.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.*, c.phone as customer_phone
            FROM transactions t
            LEFT JOIN customers c ON t.customer_id = c.id
            ORDER BY t.date DESC, t.id DESC 
            LIMIT ?;
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


def delete_transaction(tx_id: int, db_path: Optional[Path] = None) -> bool:
    """
    Deletes a transaction and updates the customer's balance.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM transactions WHERE id = ?;", (tx_id,))
        conn.commit()
        return cursor.rowcount > 0


def update_transaction(
    tx_id: int,
    amount: Optional[float] = None,
    tx_type: Optional[str] = None,
    item_description: Optional[str] = None,
    date_str: Optional[str] = None,
    db_path: Optional[Path] = None
) -> Optional[Dict[str, Any]]:
    """
    Updates an existing transaction's details.
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM transactions WHERE id = ?;", (tx_id,))
        row = cursor.fetchone()
        if not row:
            return None

        new_amount = round(float(amount), 2) if amount is not None else row["amount"]
        new_type = normalize_transaction_type(tx_type) if tx_type is not None else row["type"]
        new_item = item_description.strip() if item_description is not None else row["item_description"]
        new_date = date_str if date_str is not None else row["date"]

        cursor.execute("""
            UPDATE transactions
            SET amount = ?, type = ?, item_description = ?, date = ?
            WHERE id = ?;
        """, (new_amount, new_type, new_item, new_date, tx_id))
        conn.commit()

        cursor.execute("SELECT * FROM transactions WHERE id = ?;", (tx_id,))
        updated = dict(cursor.fetchone())
        bal = get_customer_balance(updated["customer_id"], db_path=db_path)
        updated["current_balance"] = bal["balance"]
        return updated


def get_ledger_insights(db_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Provides comprehensive financial summaries for the Screen 3 Quick Insights dashboard:
    - Total Udhaar (Credit given all-time)
    - Total Jama (Payments collected all-time)
    - Net Outstanding Amount (Pending cash to collect)
    - Today's Udhaar & Jama
    - Count of active debtors
    - Top 5 customers with highest pending credit
    - Daily trend for Chart.js
    """
    today_str = date.today().isoformat()

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()

        # All-time aggregates
        cursor.execute("""
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_credit,
                COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS total_payment,
                COUNT(id) AS total_transactions
            FROM transactions;
        """)
        overall = cursor.fetchone()

        total_credit = round(overall["total_credit"], 2)
        total_payment = round(overall["total_payment"], 2)
        net_outstanding = round(total_credit - total_payment, 2)

        # Today's aggregates
        cursor.execute("""
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS today_credit,
                COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS today_payment,
                COUNT(id) AS today_tx_count
            FROM transactions
            WHERE date = ?;
        """, (today_str,))
        today_stats = cursor.fetchone()

        # Customer counts
        cursor.execute("SELECT COUNT(id) AS total_customers FROM customers;")
        cust_stats = cursor.fetchone()

        # Top 5 Debtors (Customers who owe the most)
        cursor.execute("""
            SELECT 
                c.id, c.name, c.phone,
                (COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) -
                 COALESCE(SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END), 0)) AS balance
            FROM customers c
            JOIN transactions t ON c.id = t.customer_id
            GROUP BY c.id, c.name, c.phone
            HAVING balance > 0
            ORDER BY balance DESC
            LIMIT 5;
        """)
        top_debtors = [
            {"id": row["id"], "name": row["name"], "phone": row["phone"], "balance": round(row["balance"], 2)}
            for row in cursor.fetchall()
        ]

        # Last 7 days breakdown for Chart.js
        cursor.execute("""
            SELECT 
                date,
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS daily_credit,
                COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS daily_payment
            FROM transactions
            GROUP BY date
            ORDER BY date DESC
            LIMIT 7;
        """)
        chart_rows = list(reversed(cursor.fetchall()))
        chart_data = {
            "labels": [r["date"] for r in chart_rows],
            "credit": [round(r["daily_credit"], 2) for r in chart_rows],
            "payment": [round(r["daily_payment"], 2) for r in chart_rows]
        }

        # Plain language summary
        plain_summary = (
            f"You have ₹{net_outstanding:,.2f} pending to collect across all customers. "
            f"Today, you recorded ₹{round(today_stats['today_credit'], 2):,.2f} in udhaar "
            f"and collected ₹{round(today_stats['today_payment'], 2):,.2f} in payments."
        )

        return {
            "total_credit": total_credit,
            "total_payment": total_payment,
            "net_outstanding": net_outstanding,
            "today_credit": round(today_stats["today_credit"], 2),
            "today_payment": round(today_stats["today_payment"], 2),
            "today_transactions_count": today_stats["today_tx_count"],
            "total_customers": cust_stats["total_customers"],
            "total_transactions": overall["total_transactions"],
            "top_debtors": top_debtors,
            "chart_data": chart_data,
            "summary_text": plain_summary
        }


def seed_sample_data(db_path: Optional[Path] = None) -> None:
    """
    Populates sample data demonstrating real kirana store situations:
    - Ramesh: Received ₹500 payment
    - Suresh: Took ₹200 udhaar for chawal (rice)
    - Anita Sharma: ₹1,250 udhaar for spices & cooking oil
    - Mukesh Kumar: Settled previous bill of ₹750
    """
    init_db(db_path)
    today = date.today().isoformat()

    sample_txs = [
        {"customer_name": "Ramesh", "type": "credit", "amount": 800.0, "item_description": "Atta & Dal", "date": today},
        {"customer_name": "Ramesh", "type": "payment", "amount": 500.0, "item_description": "Cash payment", "date": today},
        {"customer_name": "Suresh", "type": "credit", "amount": 200.0, "item_description": "Chawal (Rice)", "date": today},
        {"customer_name": "Anita Sharma", "type": "credit", "amount": 1250.0, "item_description": "Cooking Oil & Masala", "date": today},
        {"customer_name": "Mukesh Kumar", "type": "credit", "amount": 750.0, "item_description": "Dairy & Milk pack", "date": today},
        {"customer_name": "Mukesh Kumar", "type": "payment", "amount": 750.0, "item_description": "UPI payment", "date": today},
    ]

    record_batch_transactions(sample_txs, raw_voice_text="Sample initial ledger data", db_path=db_path)


if __name__ == "__main__":
    print(f"Initializing GemmaKhata SQLite Database at {DEFAULT_DB_PATH}...")
    init_db()
    print("Database initialized successfully.")
