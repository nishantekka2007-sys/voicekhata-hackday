"""
Tests for GemmaKhata AI extraction engine.
Mocks the Ollama client so tests run offline without a real Gemma model.
"""

import unittest
from unittest.mock import MagicMock, patch

import gemma_ai


class TestTransactionExtraction(unittest.TestCase):

    def _mock_ollama_response(self, json_body: str):
        mock_msg = MagicMock()
        mock_msg.message.content = json_body
        return mock_msg

    # ------------------------------------------------------------------
    # JSON Parsing & Validation
    # ------------------------------------------------------------------
    def test_parse_single_payment(self):
        raw = '[{"customer_name": "Ramesh", "type": "payment", "amount": 500.0, "item_description": ""}]'
        result = gemma_ai._parse_and_validate(raw, "Ramesh ne 500 diye")
        self.assertEqual(len(result), 1)
        tx = result[0]
        self.assertEqual(tx["customer_name"], "Ramesh")
        self.assertEqual(tx["type"], "payment")
        self.assertEqual(tx["amount"], 500.0)
        self.assertFalse(tx["needs_confirmation"])
        self.assertEqual(tx["missing_fields"], [])

    def test_parse_multi_transaction_voice_scenario(self):
        """The exact problem statement: Ramesh payment + Suresh credit"""
        raw = '''[
            {"customer_name": "Ramesh", "type": "payment", "amount": 500.0, "item_description": ""},
            {"customer_name": "Suresh", "type": "credit", "amount": 200.0, "item_description": "Chawal"}
        ]'''
        result = gemma_ai._parse_and_validate(raw, "test")
        self.assertEqual(len(result), 2)

        ramesh = next(t for t in result if t["customer_name"] == "Ramesh")
        suresh = next(t for t in result if t["customer_name"] == "Suresh")

        self.assertEqual(ramesh["type"], "payment")
        self.assertEqual(ramesh["amount"], 500.0)
        self.assertEqual(suresh["type"], "credit")
        self.assertEqual(suresh["amount"], 200.0)
        self.assertEqual(suresh["item_description"], "Chawal")

    def test_parse_markdown_fenced_json(self):
        """Gemma sometimes wraps its output in markdown code fences."""
        raw = '```json\n[{"customer_name": "Anita", "type": "credit", "amount": 1250.0, "item_description": "Masala"}]\n```'
        result = gemma_ai._parse_and_validate(raw, "test")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["customer_name"], "Anita")
        self.assertEqual(result[0]["amount"], 1250.0)

    def test_missing_amount_sets_needs_confirmation(self):
        raw = '[{"customer_name": "Priya", "type": "credit", "amount": null, "item_description": "Rice"}]'
        result = gemma_ai._parse_and_validate(raw, "test")
        tx = result[0]
        self.assertIsNone(tx["amount"])
        self.assertTrue(tx["needs_confirmation"])
        self.assertIn("amount", tx["missing_fields"])

    def test_missing_name_sets_needs_confirmation(self):
        raw = '[{"customer_name": null, "type": "payment", "amount": 300.0, "item_description": ""}]'
        result = gemma_ai._parse_and_validate(raw, "test")
        tx = result[0]
        self.assertIsNone(tx["customer_name"])
        self.assertTrue(tx["needs_confirmation"])
        self.assertIn("customer_name", tx["missing_fields"])

    def test_udhaar_type_normalized_to_credit(self):
        for udhaar_variant in ("udhaar", "udhar", "gave", "debit", "Udhaar"):
            raw = f'[{{"customer_name": "Dinesh", "type": "{udhaar_variant}", "amount": 400.0, "item_description": ""}}]'
            result = gemma_ai._parse_and_validate(raw, "test")
            self.assertEqual(result[0]["type"], "credit", f"Failed for: {udhaar_variant}")

    def test_jama_type_normalized_to_payment(self):
        for payment_variant in ("jama", "received", "got", "paid", "Jama"):
            raw = f'[{{"customer_name": "Ravi", "type": "{payment_variant}", "amount": 600.0, "item_description": ""}}]'
            result = gemma_ai._parse_and_validate(raw, "test")
            self.assertEqual(result[0]["type"], "payment", f"Failed for: {payment_variant}")

    def test_customer_name_title_cased(self):
        raw = '[{"customer_name": "ramesh kumar", "type": "payment", "amount": 100.0, "item_description": ""}]'
        result = gemma_ai._parse_and_validate(raw, "test")
        self.assertEqual(result[0]["customer_name"], "Ramesh Kumar")

    def test_negative_amount_treated_as_missing(self):
        raw = '[{"customer_name": "Mehul", "type": "credit", "amount": -100.0, "item_description": ""}]'
        result = gemma_ai._parse_and_validate(raw, "test")
        self.assertIsNone(result[0]["amount"])
        self.assertTrue(result[0]["needs_confirmation"])

    def test_single_object_wrapping(self):
        raw = '{"customer_name": "Sunita", "type": "credit", "amount": 750.0, "item_description": "Oil"}'
        result = gemma_ai._parse_and_validate(raw, "test")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["customer_name"], "Sunita")

    # ------------------------------------------------------------------
    # Regex Fallback
    # ------------------------------------------------------------------
    def test_regex_fallback_simple_pattern(self):
        result = gemma_ai._regex_fallback_extraction("Ramesh 500 payment received")
        self.assertTrue(len(result) >= 1)

    def test_regex_fallback_no_match_returns_placeholder(self):
        result = gemma_ai._regex_fallback_extraction("aaj bohot baarish thi")
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["needs_confirmation"])
        self.assertIsNone(result[0]["customer_name"])
        self.assertIsNone(result[0]["amount"])

    # ------------------------------------------------------------------
    # extract_transactions() — mocked Ollama
    # ------------------------------------------------------------------
    def test_extract_transactions_empty_input(self):
        result = gemma_ai.extract_transactions("")
        self.assertFalse(result["success"])
        self.assertIsNotNone(result["error"])

    def test_extract_transactions_whitespace_only(self):
        result = gemma_ai.extract_transactions("   ")
        self.assertFalse(result["success"])

    @patch("gemma_ai._get_ollama_client")
    def test_extract_transactions_success_mocked(self, mock_get_client):
        mock_ollama = MagicMock()
        mock_get_client.return_value = mock_ollama
        mock_ollama.list.return_value.models = [MagicMock(model="gemma4:e2b")]
        mock_response = MagicMock()
        mock_response.message.content = '''[
            {"customer_name": "Ramesh", "type": "payment", "amount": 500.0, "item_description": ""},
            {"customer_name": "Suresh", "type": "credit", "amount": 200.0, "item_description": "Chawal"}
        ]'''
        mock_ollama.chat.return_value = mock_response

        result = gemma_ai.extract_transactions(
            "Ramesh ne 500 rupaye diye aur Suresh ko 200 rupaye ka chawal udhaar diya."
        )

        self.assertTrue(result["success"])
        self.assertEqual(len(result["transactions"]), 2)
        self.assertIsNone(result["error"])

        ramesh = next(t for t in result["transactions"] if t["customer_name"] == "Ramesh")
        self.assertEqual(ramesh["type"], "payment")
        self.assertEqual(ramesh["amount"], 500.0)

    @patch("gemma_ai._get_ollama_client")
    def test_extract_transactions_ollama_exception(self, mock_get_client):
        mock_ollama = MagicMock()
        mock_get_client.return_value = mock_ollama
        mock_ollama.list.return_value.models = [MagicMock(model="gemma4:e2b")]
        mock_ollama.chat.side_effect = Exception("Connection refused")

        result = gemma_ai.extract_transactions("Ramesh ne 500 diye")
        self.assertFalse(result["success"])
        self.assertIn("Connection refused", result["error"])
        self.assertEqual(result["transactions"], [])

    # ------------------------------------------------------------------
    # Error response helper
    # ------------------------------------------------------------------
    def test_error_response_structure(self):
        result = gemma_ai._error_response("Something broke", "test input")
        self.assertFalse(result["success"])
        self.assertEqual(result["raw_text"], "test input")
        self.assertEqual(result["transactions"], [])
        self.assertEqual(result["error"], "Something broke")


if __name__ == "__main__":
    unittest.main()
