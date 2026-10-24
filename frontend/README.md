# VoiceKhata Frontend

Responsive HTML/CSS/JavaScript frontend for the VoiceKhata MVP. The UI uses Chart.js for the dashboard chart and is designed to connect to the team's FastAPI backend.

## Run locally

Because the frontend uses microphone access and browser modules may behave differently from a direct file URL, serve this folder over HTTP:

```bash
cd frontend
python3 -m http.server 5500
```

Open http://localhost:5500. The frontend uses sample data until it can reach the backend.

## Configure the backend URL

By default, the frontend calls `http://127.0.0.1:8000/api`. Change `API_BASE` near the top of `app.js` or set `window.VOICEKHATA_API_BASE` before loading the app to match the backend team's host and route prefix.

The FastAPI server must allow the frontend origin (for example, `http://localhost:5500`) through CORS.

## Proposed API contract

These routes are the frontend's expected contract. Coordinate with the backend owners before they finalize route names or schemas.

### `GET /api/transactions`

Return either an array or an object with a `transactions` array. Each item should include:

```json
{
  "id": 1,
  "customer": "Ramesh Kumar",
  "kind": "credit_sale",
  "amount": 500,
  "note": "2 kg rice",
  "created_at": "2026-10-24T10:00:00Z"
}
```

### `POST /api/transactions/parse`

Request: `{"text":"Ramesh took 2 kg rice worth 500 rupees on credit","language":"auto"}`

Return structured fields: `customer`, `kind`, `amount`, `note`. Supported kinds are `credit_sale`, `payment_received`, and `cash_expense`. The frontend sends `language` plus `input_language` (which may be `mixed`). Support English, Hindi, Bengali, and Hindi-English mixed speech/text. This route should call Gemma 4 but must not save the transaction. If extraction is unclear, return a validation error rather than guessing or saving.

### `POST /api/transactions`

Request: `{"customer":"Ramesh Kumar","kind":"credit_sale","amount":500,"note":"2 kg rice"}`

This route saves a transaction only after the frontend's explicit confirmation. Return the saved transaction including its ID and timestamp.

### `POST /api/voice/transcribe`

Multipart form-data with `file` (audio file) and optional `language`. Return `{"text":"recognized words here","language":"hi"}` (language is optional). The backend can use faster-whisper for transcription. Accept `auto`, `en`, `hi`, and `bn`; `mixed` is sent as `auto` so Hinglish can be detected instead of forcing one language.

## Financial rules

- Credit sales increase the amount due.
- Payments received reduce the amount due.
- Shop expenses do not change a customer's balance.
- Validate all amounts and transaction types on the backend too.
- Never trust AI to calculate running balances; use deterministic Python/SQL logic.
- Do not save the AI-extracted draft before the user confirms it.

## Current limitations

- Sample data is included for UI development and is not a real shop ledger.
- The frontend does not silently fall back to a simplistic parser when the AI parse endpoint fails; it shows an error and saves nothing. Always verify the review form.
- Voice transcription requires a running backend endpoint and microphone permission.
- Chart values are sample visualization data until a summary endpoint is agreed upon.
