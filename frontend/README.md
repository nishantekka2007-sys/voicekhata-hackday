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

Return structured fields: `customer`, `kind`, `amount`, `note`. Supported kinds are `credit_sale`, `payment_received`, and `cash_expense`. This route should call Gemma 4 but must not save the transaction.

### `POST /api/transactions`

Request: `{"customer":"Ramesh Kumar","kind":"credit_sale","amount":500,"note":"2 kg rice"}`

This route saves a transaction only after the frontend's explicit confirmation. Return the saved transaction including its ID and timestamp.

### `POST /api/voice/transcribe`

Multipart form-data with `file` (audio file) and optional `language`. Return `{"text":"recognized words here"}`. The backend can use faster-whisper for transcription.

## Financial rules

- Credit sales increase the amount due.
- Payments received reduce the amount due.
- Shop expenses do not change a customer's balance.
- Validate all amounts and transaction types on the backend too.
- Never trust AI to calculate running balances; use deterministic Python/SQL logic.
- Do not save the AI-extracted draft before the user confirms it.

## Current limitations

- Sample data is included for UI development and is not a real shop ledger.
- The frontend's lightweight fallback parser is only for preview and may misread names, amounts, or transaction types. Always verify the review form.
- Voice transcription requires a running backend endpoint and microphone permission.
- Chart values are sample visualization data until a summary endpoint is agreed upon.
