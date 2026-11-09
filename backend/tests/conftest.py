import pytest


@pytest.fixture(autouse=True)
def allowed_test_host(monkeypatch):
    """FastAPI's TestClient sends Host: testserver; allow it alongside the real defaults."""
    monkeypatch.setenv("ASTRA_ALLOWED_HOSTS", "testserver,127.0.0.1,localhost")
