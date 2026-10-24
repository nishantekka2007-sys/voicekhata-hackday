import os
from pathlib import Path

from fastapi.testclient import TestClient


def setup_module():
    os.environ["VOICEKHATA_DB_PATH"] = str(Path(__file__).parent / "test-voicekhata.db")


def teardown_module():
    path = Path(__file__).parent / "test-voicekhata.db"
    if path.exists():
        path.unlink()


def test_health_and_auth_config():
    from backend.main import app
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        config = client.get("/api/auth/config").json()
        assert "google_login_enabled" in config


def test_ledger_requires_login():
    from backend.main import app
    with TestClient(app) as client:
        response = client.get("/api/transactions")
        assert response.status_code == 401
