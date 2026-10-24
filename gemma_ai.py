"""
GemmaKhata — Gemma 4 E2B AI Transaction Extraction Engine
=========================================================
Uses Gemma 4 E2B (via Ollama) to extract structured transaction data from
multilingual voice transcripts (Hindi, English, Hinglish, Marathi, etc.).

Core responsibilities:
  1. Send raw transcribed text to Gemma 4 E2B
  2. Receive structured JSON of extracted transactions
  3. Validate and sanitize extracted data before returning
  4. Handle edge cases: missing amounts, missing names, ambiguous language

Usage:
  from gemma_ai import extract_transactions, check_ollama_connection, get_ledger_summary

  result = extract_transactions("Ramesh ne 500 rupaye diye aur Suresh ko 200 ka chawal udhaar diya")
  # Returns list of validated transaction dicts ready for ledger.record_batch_transactions()
"""

import json
import re
import logging
from typing import Any

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(levelname)s [gemma_ai] %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
OLLAMA_MODEL = "gemma4:e2b"          # Primary model
OLLAMA_MODEL_FALLBACK = "gemma2:2b"  # Lightweight fallback if E2B unavailable

OLLAMA_HOST = "http://localhost:11434"
TIMEOUT_SECONDS = 60


# ---------------------------------------------------------------------------
# Ollama Client (lazy import so app starts even without Ollama installed)
# ---------------------------------------------------------------------------
def _get_ollama_client():
    """Returns an Ollama client instance, raises ImportError with guidance if not installed."""
    try:
        import ollama
        return ollama
    except ImportError:
        raise ImportError(
            "Ollama Python package not found.\n"
            "Install it with: pip install ollama\n"
            "And make sure Ollama is running: https://ollama.com/download"
        )


# ---------------------------------------------------------------------------
# Connection Check
# ---------------------------------------------------------------------------
def check_ollama_connection() -> dict[str, Any]:
    """
    Verifies that Ollama is running and the Gemma model is available.
    Returns a status dict indicating health of the AI backend.
    """
    try:
        ollama = _get_ollama_client()
        models = ollama.list()
        model_names = [m.model for m in models.models]

        has_primary = any(OLLAMA_MODEL in name for name in model_names)
        has_fallback = any(OLLAMA_MODEL_FALLBACK in name for name in model_names)

        if has_primary:
            active_model = OLLAMA_MODEL
            status = "ready"
            message = f"Gemma 4 E2B is loaded and ready."
        elif has_fallback:
            active_model = OLLAMA_MODEL_FALLBACK
            status = "fallback"
            message = f"Primary model not found. Using fallback: {OLLAMA_MODEL_FALLBACK}"
        else:
            active_model = None
            status = "no_model"
            message = (
                f"No Gemma model found. Run: ollama pull {OLLAMA_MODEL}\n"
                f"Or fallback: ollama pull {OLLAMA_MODEL_FALLBACK}"
            )

        return {
            "status": status,
            "active_model": active_model,
            "available_models": model_names,
            "message": message
        }
    except Exception as e:
        return {
            "status": "offline",
            "active_model": None,
            "available_models": [],
            "message": f"Ollama is not running. Start it first: ollama serve\nError: {str(e)}"
        }


def _pick_model() -> str:
    """Returns the best available model: primary > fallback > primary (attempt anyway)."""
    conn = check_ollama_connection()
    if conn["active_model"]:
        return conn["active_model"]
    return OLLAMA_MODEL


# ---------------------------------------------------------------------------
# System Prompt — The core of all Gemma intelligence
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT = """You are GemmaKhata, an AI bookkeeping assistant for Indian kirana (grocery) store owners.

Your ONLY job is to extract financial transactions from the shopkeeper's speech.

TRANSACTION TYPES:
- "credit"  → Shopkeeper GAVE goods/money to customer on credit (udhaar diya, udhaar liya, le gaya, baaki rakha, ledha, udhar)
- "payment" → Customer PAID the shopkeeper (diya, jama kiya, paise aaye, payment kiya, wapas kiya, received)

INPUT: Raw transcribed speech in Hindi, English, Hinglish, or Marathi.
OUTPUT: A valid JSON array. No markdown, no explanation, only raw JSON.

RULES:
1. Extract EVERY transaction mentioned. One sentence can contain multiple transactions.
2. If amount is clearly stated (500, ₹500, panch sau), use it.
3. If amount is NOT mentioned, set "amount" to null.
4. If customer name is NOT mentioned, set "customer_name" to null.
5. item_description: the item/goods mentioned (chawal, atta, dal, oil) or "" if none.
6. type must ONLY be "credit" or "payment".
7. Always output a JSON array even for a single transaction.
8. Do NOT invent amounts or names that aren't in the speech.

JSON FORMAT (strictly follow this schema):
[
  {
    "customer_name": "Ramesh",
    "type": "payment",
    "amount": 500.0,
    "item_description": ""
  },
  {
    "customer_name": "Suresh",
    "type": "credit",
    "amount": 200.0,
    "item_description": "Chawal"
  }
]

LANGUAGE EXAMPLES:
- "Ramesh ne 500 diye" → payment 500 from Ramesh
- "Suresh ko 200 ka chawal udhaar diya" → credit 200 to Suresh, item: Chawal
- "Anita ka 1250 ka hisaab baaki hai" → credit 1250 to Anita
- "Mukesh ne UPI se 750 jama kiya" → payment 750 from Mukesh
- "give rice worth 300 to Priya on credit" → credit 300 to Priya, item: Rice
- "Collected 500 from Ramesh" → payment 500 from Ramesh

Now extract transactions from the following input:"""


# ---------------------------------------------------------------------------
# Core Extraction Function
# ---------------------------------------------------------------------------
def extract_transactions(transcribed_text: str, model: str | None = None) -> dict[str, Any]:
    """
    Sends transcribed voice text to Gemma 4 E2B and extracts structured transactions.

    Args:
        transcribed_text: Raw text output from faster-whisper / speech engine.
        model: Override the model name (optional, auto-picks best available by default).

    Returns:
        {
            "success": bool,
            "transactions": [                  # List of extracted transaction dicts
                {
                    "customer_name": str|None,
                    "type": "credit"|"payment",
                    "amount": float|None,
                    "item_description": str,
                    "needs_confirmation": bool, # True if name or amount is missing
                    "missing_fields": [str]     # List of missing field names
                }
            ],
            "raw_text": str,                   # Original input
            "raw_gemma_response": str,         # What Gemma actually returned
            "model_used": str,
            "error": str|None                  # Error message if extraction failed
        }
    """
    if not transcribed_text or not transcribed_text.strip():
        return _error_response("Empty transcribed text provided.", transcribed_text or "")

    target_model = model or _pick_model()
    prompt_text = transcribed_text.strip()

    log.info(f"Sending to Gemma ({target_model}): '{prompt_text[:100]}...'")

    try:
        ollama = _get_ollama_client()

        response = ollama.chat(
            model=target_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt_text}
            ],
            options={
                "temperature": 0.1,     # Very low temp for consistent structured output
                "top_p": 0.9,
                "num_predict": 1024,
            }
        )

        raw_response = response.message.content.strip()
        log.info(f"Gemma raw response: {raw_response[:300]}")

        transactions = _parse_and_validate(raw_response, prompt_text)

        return {
            "success": True,
            "transactions": transactions,
            "raw_text": prompt_text,
            "raw_gemma_response": raw_response,
            "model_used": target_model,
            "error": None
        }

    except ImportError as e:
        return _error_response(str(e), transcribed_text)
    except Exception as e:
        log.error(f"Gemma extraction failed: {e}")
        return _error_response(f"Gemma AI error: {str(e)}", transcribed_text)


# ---------------------------------------------------------------------------
# JSON Parsing & Validation
# ---------------------------------------------------------------------------
def _parse_and_validate(raw_response: str, original_text: str) -> list[dict[str, Any]]:
    """
    Parses Gemma's JSON output and validates each transaction.
    Handles edge cases: markdown code fences, single object vs array, etc.
    """
    # Strip markdown fences if present (```json ... ``` or ``` ... ```)
    cleaned = re.sub(r"```(?:json)?", "", raw_response, flags=re.IGNORECASE).strip().rstrip("`").strip()

    # Try to isolate the JSON array from any surrounding text
    array_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if array_match:
        cleaned = array_match.group(0)
    else:
        # Maybe it's a single object, try wrapping it
        obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if obj_match:
            cleaned = "[" + obj_match.group(0) + "]"

    try:
        raw_list = json.loads(cleaned)
    except json.JSONDecodeError as e:
        log.warning(f"JSON parse failed: {e}. Attempting fallback regex extraction.")
        return _regex_fallback_extraction(original_text)

    if not isinstance(raw_list, list):
        raw_list = [raw_list]

    validated = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        validated_tx = _validate_single_transaction(item)
        if validated_tx:
            validated.append(validated_tx)

    return validated


def _validate_single_transaction(tx: dict) -> dict[str, Any] | None:
    """
    Validates and normalizes a single extracted transaction dict.
    Marks fields that are missing so the UI can prompt the user.
    """
    missing_fields = []

    # --- customer_name ---
    customer_name = tx.get("customer_name") or tx.get("name") or tx.get("customer")
    if customer_name:
        customer_name = str(customer_name).strip().title()  # Proper case: "ramesh" → "Ramesh"
        if not customer_name:
            customer_name = None
    if not customer_name:
        missing_fields.append("customer_name")

    # --- type ---
    raw_type = str(tx.get("type", "")).strip().lower()
    if raw_type in ("credit", "udhaar", "udhar", "gave", "debit"):
        tx_type = "credit"
    elif raw_type in ("payment", "jama", "received", "got", "paid"):
        tx_type = "payment"
    else:
        tx_type = "credit"  # Default to credit if unclear
        missing_fields.append("type")

    # --- amount ---
    raw_amount = tx.get("amount")
    amount = None
    if raw_amount is not None:
        try:
            amount = round(float(raw_amount), 2)
            if amount <= 0:
                amount = None
                missing_fields.append("amount")
        except (ValueError, TypeError):
            missing_fields.append("amount")
    else:
        missing_fields.append("amount")

    # --- item_description ---
    item_description = str(tx.get("item_description", "") or tx.get("item", "") or "").strip()

    needs_confirmation = len(missing_fields) > 0

    return {
        "customer_name": customer_name,
        "type": tx_type,
        "amount": amount,
        "item_description": item_description,
        "needs_confirmation": needs_confirmation,
        "missing_fields": missing_fields
    }


# ---------------------------------------------------------------------------
# Regex Fallback — If Gemma produces non-JSON for simple cases
# ---------------------------------------------------------------------------
def _regex_fallback_extraction(text: str) -> list[dict[str, Any]]:
    """
    Last-resort regex-based extractor for simple patterns like:
    "Ramesh 500 payment" or "Suresh 200 credit chawal"
    Used only when Gemma's JSON output is unparseable.
    """
    log.info("Using regex fallback extractor.")
    transactions = []

    pattern = re.compile(
        r"([A-Za-z][a-zA-Z\s]{1,20}?)\s+"
        r"(?:₹|Rs\.?|INR\s?)?"
        r"(\d+(?:\.\d{1,2})?)"
        r"\s+"
        r"(credit|payment|udhaar|jama|diya|diye|received|paid)",
        re.IGNORECASE
    )

    for match in pattern.finditer(text):
        name = match.group(1).strip().title()
        amount = float(match.group(2))
        raw_type = match.group(3).lower()
        tx_type = "credit" if raw_type in ("credit", "udhaar", "diya") else "payment"

        transactions.append({
            "customer_name": name,
            "type": tx_type,
            "amount": amount,
            "item_description": "",
            "needs_confirmation": False,
            "missing_fields": []
        })

    if not transactions:
        # Couldn't extract anything — return placeholder for manual entry
        transactions.append({
            "customer_name": None,
            "type": "credit",
            "amount": None,
            "item_description": "",
            "needs_confirmation": True,
            "missing_fields": ["customer_name", "amount", "type"]
        })

    return transactions


# ---------------------------------------------------------------------------
# Ledger Summary (Screen 3 — Plain-Language Insights from Gemma)
# ---------------------------------------------------------------------------
def get_ledger_summary(insights: dict[str, Any], model: str | None = None) -> str:
    """
    Uses Gemma to generate a friendly, plain-language summary of the shopkeeper's
    financial snapshot. Displayed on Screen 3 (Quick Insights).

    Args:
        insights: The dict returned by ledger.get_ledger_insights()
        model: Optional model override.

    Returns:
        A short, friendly Hindi/English summary string.
    """
    target_model = model or _pick_model()

    summary_prompt = f"""You are a helpful bookkeeping assistant for a kirana store owner in India.
Based on this financial data, write a short (2-3 sentences max) friendly summary in simple English
that the shopkeeper will understand. You may mix in a Hindi word or two where natural (like 'udhaar', 'jama', 'baaki').

Financial Data:
- Total Udhaar (Credit) Given: Rs.{insights.get('total_credit', 0):,.2f}
- Total Payments Collected: Rs.{insights.get('total_payment', 0):,.2f}
- Net Outstanding (Baaki): Rs.{insights.get('net_outstanding', 0):,.2f}
- Today's Credit: Rs.{insights.get('today_credit', 0):,.2f}
- Today's Payments: Rs.{insights.get('today_payment', 0):,.2f}
- Total Customers: {insights.get('total_customers', 0)}
- Biggest Debtor: {insights['top_debtors'][0]['name'] + ' (Rs.' + str(insights['top_debtors'][0]['balance']) + ')' if insights.get('top_debtors') else 'None'}

Write a friendly, encouraging 2-3 sentence summary. No bullet points. Plain sentences only."""

    try:
        ollama = _get_ollama_client()
        response = ollama.chat(
            model=target_model,
            messages=[{"role": "user", "content": summary_prompt}],
            options={"temperature": 0.7, "num_predict": 200}
        )
        return response.message.content.strip()
    except Exception as e:
        log.warning(f"Summary generation failed: {e}")
        return insights.get("summary_text", "Summary unavailable. Please check Ollama connection.")


# ---------------------------------------------------------------------------
# Error Response Helper
# ---------------------------------------------------------------------------
def _error_response(message: str, raw_text: str) -> dict[str, Any]:
    return {
        "success": False,
        "transactions": [],
        "raw_text": raw_text,
        "raw_gemma_response": "",
        "model_used": OLLAMA_MODEL,
        "error": message
    }


# ---------------------------------------------------------------------------
# Quick Demo / Manual Test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("GemmaKhata — Gemma AI Transaction Extractor")
    print("=" * 60)

    # 1. Check connection
    status = check_ollama_connection()
    print(f"\n[Connection Check]")
    print(f"  Status : {status['status']}")
    print(f"  Model  : {status['active_model']}")
    print(f"  Message: {status['message']}")

    if status["status"] in ("offline", "no_model"):
        print("\n  Ollama is not running or Gemma is not downloaded.")
        print("  Run these commands first:")
        print("  1. Install Ollama: https://ollama.com/download")
        print(f"  2. ollama pull {OLLAMA_MODEL}")
        print("  3. ollama serve")
        print("\n  Then run this file again to test.")
        exit(0)

    # 2. Test extraction with problem statement examples
    test_inputs = [
        "Ramesh ne 500 rupaye diye aur Suresh ko 200 rupaye ka chawal udhaar diya.",
        "Anita Sharma ne 1250 ka cooking oil aur masala udhaar liya.",
        "Mukesh Kumar ne UPI se 750 jama kiye.",
        "Give rice worth 300 to Priya on credit and collect 800 from Rajesh.",
    ]

    for text in test_inputs:
        print(f"\n[Input] {text}")
        result = extract_transactions(text)
        if result["success"]:
            for i, tx in enumerate(result["transactions"], 1):
                status_icon = "CONFIRM NEEDED" if tx["needs_confirmation"] else "OK"
                print(f"  [{status_icon}] Transaction {i}:")
                print(f"     Customer : {tx['customer_name'] or 'MISSING'}")
                print(f"     Type     : {tx['type']}")
                print(f"     Amount   : {'Rs.' + str(tx['amount']) if tx['amount'] else 'MISSING'}")
                print(f"     Item     : {tx['item_description'] or '-'}")
                if tx["missing_fields"]:
                    print(f"     Missing  : {', '.join(tx['missing_fields'])}")
        else:
            print(f"  Error: {result['error']}")

    print("\n" + "=" * 60)
