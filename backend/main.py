from fastapi import FastAPI

app = FastAPI(
    title="Voice Khata API",
    description="Backend for an Indian voice-based digital ledger",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Voice Khata backend is running!",
        "status": "ok",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}