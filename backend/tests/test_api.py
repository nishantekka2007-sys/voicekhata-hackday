import os
from pathlib import Path


def setup_module():
    os.environ["VOICEKHATA_DB_PATH"] = str(Path(__file__).parent / "test-voicekhata.db")


def teardown_module():
    path = Path(__file__).parent / "test-voicekhata.db"
    if path.exists():
        path.unlink()


def test_health_and_auth_config():
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        config = client.get("/api/auth/config").json()
        assert "google_login_enabled" in config


def test_ledger_requires_login():
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as client:
        assert client.get("/api/transactions").status_code == 401


def test_google_login_fails_closed_without_client_id(monkeypatch):
    from fastapi.testclient import TestClient
    import backend.main as main
    monkeypatch.setattr(main, "GOOGLE_CLIENT_ID", "")
    with TestClient(main.app) as client:
        response = client.post("/api/auth/google", json={"credential": "a" * 40})
        assert response.status_code in (401, 503)


def test_full_stack_frontend_is_served_by_api():
    """One FastAPI process serves both the real website and the authenticated ledger API."""
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as client:
        website = client.get("/")
        assert website.status_code == 200
        assert "VoiceKhata" in website.text
        assert 'src="cloud.js"' in website.text
        assert client.get("/cloud.js").status_code == 200
        assert client.get("/config.js").status_code == 200
        assert client.get("/api/transactions").status_code == 401
