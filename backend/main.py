

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from gemma_service import extract_transaction_intent

import databse
from schemas import (
    CustomerCreate,
    CustomerResponse,
    TransactionCreate,
    TransactionResponse,
    BalanceResponse,
)
from gemma_service import extract_transaction_intent


app = FastAPI(
    title="Voice Khata API",
    description="Backend for an Indian voice-based digital ledger",
    version="1.0.0",
)


# Request model for AI transaction parsing
class VoiceTransactionRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


# Home
@app.get("/")
def home():
    return {
        "message": "Voice Khata backend is running!",
        "status": "ok",
    }


# Health check
@app.get("/health")
def health():
    return {"status": "healthy"}


# Create a customer
@app.post(
    "/customers",
    response_model=CustomerResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_customer(data: CustomerCreate):
    try:
        return databse.create_customer(data.name, data.phone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# List all customers
@app.get("/customers", response_model=list[CustomerResponse])
def list_customers():
    return databse.list_customers()


# Get one customer
@app.get("/customers/{customer_id}", response_model=CustomerResponse)
def get_customer(customer_id: int):
    customer = databse.get_customer(customer_id)

    if customer is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found",
        )

    return customer


# Check customer balance
@app.get(
    "/customers/{customer_id}/balance",
    response_model=BalanceResponse,
)
def get_customer_balance(customer_id: int):
    balance = databse.get_balance(customer_id)

    if balance is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found",
        )

    return {
        "customer_id": customer_id,
        "balance_paise": balance,
    }


# Add a credit or payment directly
@app.post(
    "/transactions",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transaction(data: TransactionCreate):
    try:
        return databse.create_transaction(
            customer_id=data.customer_id,
            transaction_type=data.type,
            amount_paise=data.amount_paise,
            note=data.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# View a customer's transaction history
@app.get(
    "/customers/{customer_id}/transactions",
    response_model=list[TransactionResponse],
)
def list_customer_transactions(customer_id: int):
    if databse.get_customer(customer_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Customer not found",
        )

    return databse.get_transactions(customer_id)


# AI: Extract transaction details from text
# This endpoint DOES NOT save a transaction.
@app.post("/voice/parse")
def parse_voice_transaction(request: VoiceTransactionRequest):
    try:
        result = extract_transaction_intent(request.text)
        return result.model_dump()

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except Exception:
        # Avoid exposing API keys or internal error details.
        raise HTTPException(
            status_code=502,
            detail="AI service failed to process the transaction.",
        )
