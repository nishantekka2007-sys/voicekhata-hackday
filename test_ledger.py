"""
Unit tests for GemmaKhata SQLite Ledger Engine
"""

import os
import unittest
import tempfile
from pathlib import Path
from datetime import date

import ledger


class TestGemmaKhataLedger(unittest.TestCase):
    def setUp(self):
        # Create a temporary database for each test to keep tests isolated
        self.temp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = Path(self.temp_dir.name) / "test_ledger.db"
        ledger.init_db(self.test_db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_customer_creation_and_case_insensitivity(self):
        # Customer "Ramesh"
        c1 = ledger.get_or_create_customer("Ramesh", phone="9876543210", db_path=self.test_db_path)
        self.assertEqual(c1["name"], "Ramesh")
        self.assertEqual(c1["phone"], "9876543210")

        # Creating or fetching "ramesh" should return the exact same customer ID
        c2 = ledger.get_or_create_customer("  ramesh  ", db_path=self.test_db_path)
        self.assertEqual(c1["id"], c2["id"])

    def test_record_single_transaction_and_balance(self):
        # Record udhaar of 800 for Ramesh
        tx1 = ledger.record_transaction(
            customer_name="Ramesh",
            tx_type="credit",
            amount=800.0,
            item_description="Atta & Dal",
            db_path=self.test_db_path
        )
        self.assertEqual(tx1["amount"], 800.0)
        self.assertEqual(tx1["type"], "credit")
        self.assertEqual(tx1["current_balance"], 800.0)
        self.assertEqual(tx1["balance_status"], "pending")

        # Ramesh pays 500
        tx2 = ledger.record_transaction(
            customer_name="Ramesh",
            tx_type="payment",
            amount=500.0,
            item_description="Cash payment",
            db_path=self.test_db_path
        )
        self.assertEqual(tx2["amount"], 500.0)
        self.assertEqual(tx2["type"], "payment")
        self.assertEqual(tx2["current_balance"], 300.0)

        # Check balance directly
        bal = ledger.get_customer_balance(tx1["customer_id"], db_path=self.test_db_path)
        self.assertEqual(bal["total_credit"], 800.0)
        self.assertEqual(bal["total_payment"], 500.0)
        self.assertEqual(bal["balance"], 300.0)
        self.assertEqual(bal["status"], "pending")

    def test_batch_transactions_voice_scenario(self):
        """
        Step 1 & 3 scenario from problem statement:
        'Ramesh ne 500 rupaye diye aur Suresh ko 200 rupaye ka chawal udhaar diya.'
        """
        batch = [
            {
                "customer_name": "Ramesh",
                "type": "payment",
                "amount": 500.0,
                "item_description": "Paise diye",
                "date": date.today().isoformat()
            },
            {
                "customer_name": "Suresh",
                "type": "credit",
                "amount": 200.0,
                "item_description": "Chawal (Rice)",
                "date": date.today().isoformat()
            }
        ]

        recorded = ledger.record_batch_transactions(
            batch,
            raw_voice_text="Ramesh ne 500 rupaye diye aur Suresh ko 200 rupaye ka chawal udhaar diya.",
            db_path=self.test_db_path
        )

        self.assertEqual(len(recorded), 2)

        # Suresh should have 200 pending
        suresh_tx = next(tx for tx in recorded if tx["customer_name"] == "Suresh")
        self.assertEqual(suresh_tx["amount"], 200.0)
        self.assertEqual(suresh_tx["type"], "credit")
        self.assertEqual(suresh_tx["item_description"], "Chawal (Rice)")
        self.assertEqual(suresh_tx["current_balance"], 200.0)

        # Ramesh paid 500 without prior credit, so balance is -500 (Advance)
        ramesh_tx = next(tx for tx in recorded if tx["customer_name"] == "Ramesh")
        self.assertEqual(ramesh_tx["amount"], 500.0)
        self.assertEqual(ramesh_tx["type"], "payment")
        self.assertEqual(ramesh_tx["current_balance"], -500.0)
        self.assertEqual(ramesh_tx["balance_status"], "advance")

    def test_ledger_insights(self):
        # Add sample data
        ledger.record_transaction("Anita", "credit", 1200.0, db_path=self.test_db_path)
        ledger.record_transaction("Anita", "payment", 400.0, db_path=self.test_db_path)
        ledger.record_transaction("Suresh", "credit", 600.0, db_path=self.test_db_path)

        insights = ledger.get_ledger_insights(db_path=self.test_db_path)
        self.assertEqual(insights["total_credit"], 1800.0)
        self.assertEqual(insights["total_payment"], 400.0)
        self.assertEqual(insights["net_outstanding"], 1400.0)
        self.assertEqual(insights["total_customers"], 2)
        self.assertEqual(len(insights["top_debtors"]), 2)
        self.assertEqual(insights["top_debtors"][0]["name"], "Anita")
        self.assertEqual(insights["top_debtors"][0]["balance"], 800.0)

    def test_update_and_delete_transaction(self):
        tx = ledger.record_transaction("Dinesh", "credit", 500.0, db_path=self.test_db_path)
        tx_id = tx["id"]
        customer_id = tx["customer_id"]

        # Update amount to 650
        updated = ledger.update_transaction(tx_id, amount=650.0, db_path=self.test_db_path)
        self.assertIsNotNone(updated)
        self.assertEqual(updated["amount"], 650.0)
        self.assertEqual(updated["current_balance"], 650.0)

        # Delete transaction
        deleted = ledger.delete_transaction(tx_id, db_path=self.test_db_path)
        self.assertTrue(deleted)

        bal = ledger.get_customer_balance(customer_id, db_path=self.test_db_path)
        self.assertEqual(bal["balance"], 0.0)
        self.assertEqual(bal["status"], "settled")


if __name__ == "__main__":
    unittest.main()
