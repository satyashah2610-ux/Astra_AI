"""Protections for a staff API with no login yet, running on the staff member's own computer."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.staff import StaffClient
from tests.signature_images import data_url
from tests.test_agreements import pdf_bytes, upload
from tests.test_files import create_file, prepared_agreement, token_from


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


# --- DNS rebinding: only requests addressed to an allowed host name are served ---------------

@pytest.mark.parametrize("host", ["evil.example", "evil.example:8000", "127.0.0.1.evil.example", ""])
def test_unknown_host_names_are_rejected(client, host):
    response = client.get("/api/agreements", headers={"Host": host})
    assert response.status_code == 400
    assert "host" in response.json()["detail"].lower()


def test_default_allowed_hosts_are_local_only(tmp_path, monkeypatch):
    monkeypatch.delenv("ASTRA_ALLOWED_HOSTS")
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1:8000") as local:
        assert local.get("/api/health").status_code == 200
        assert local.get("/api/health", headers={"Host": "localhost:5173"}).status_code == 200
        assert local.get("/api/health", headers={"Host": "testserver"}).status_code == 400


def test_allowed_hosts_can_be_configured_for_deployment(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOWED_HOSTS", "sign.example.com")
    with TestClient(create_app(tmp_path), base_url="https://sign.example.com") as hosted:
        assert hosted.get("/api/health").status_code == 200
        assert hosted.get("/api/health", headers={"Host": "127.0.0.1"}).status_code == 400


# --- Cross-site requests: another website cannot make the browser change anything --------------

CROSS_SITE = [{"Origin": "https://evil.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"},
              {"Origin": "http://testserver.evil.example"}]


@pytest.mark.parametrize("headers", CROSS_SITE)
def test_cross_site_upload_is_rejected(client, headers):
    response = client.post("/api/agreements", files={"file": ("A.pdf", pdf_bytes(), "application/pdf")}, headers=headers)
    assert response.status_code == 403
    assert client.get("/api/agreements").json() == []


@pytest.mark.parametrize("headers", CROSS_SITE)
def test_cross_site_send_and_link_reissue_are_rejected(client, headers):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    assert client.post(f"/api/files/{item['id']}/send", headers=headers).status_code == 403
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "draft"
    client.post(f"/api/files/{item['id']}/send")
    before = client.get(f"/api/files/{item['id']}").json()["version"]
    assert client.post(f"/api/files/{item['id']}/link", headers=headers).status_code == 403
    assert client.get(f"/api/files/{item['id']}").json()["version"] == before


@pytest.mark.parametrize("headers", CROSS_SITE)
def test_cross_site_delete_is_rejected(client, headers):
    agreement = upload(client).json()
    assert client.delete(f"/api/agreements/{agreement['id']}", headers=headers).status_code == 403
    assert client.get(f"/api/agreements/{agreement['id']}").status_code == 200


@pytest.mark.parametrize("headers", [{}, {"Origin": "http://testserver"}, {"Sec-Fetch-Site": "same-origin"},
                                     {"Sec-Fetch-Site": "none"}])
def test_same_site_and_non_browser_requests_are_allowed(client, headers):
    response = client.post("/api/agreements", files={"file": ("B.pdf", pdf_bytes(), "application/pdf")}, headers=headers)
    assert response.status_code == 201


def test_cross_site_reads_are_not_blocked_by_this_check(client):
    # Browsers already stop other sites from reading responses (no CORS headers are sent).
    assert client.get("/api/agreements", headers={"Origin": "https://evil.example"}).status_code == 200


# --- Request size: enforced while the body streams in, not only from Content-Length ------------

def chunked(total, size=64 * 1024):
    sent = 0
    while sent < total:
        piece = min(size, total - sent)
        sent += piece
        yield b"0" * piece


def test_oversize_upload_without_content_length_is_stopped(client, tmp_path):
    response = client.post("/api/agreements", content=chunked(23 * 1024 * 1024),
                           headers={"Content-Type": "multipart/form-data; boundary=x"})
    assert response.status_code == 413
    assert client.get("/api/agreements").json() == []
    assert list((tmp_path / "uploads").iterdir()) == []


def test_public_signing_endpoints_accept_only_small_requests(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    token = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    auth = {"X-Signing-Token": token}
    big = {"name": "Jordan", "method": "drawn", "image": "data:image/png;base64," + "A" * (1024 * 1024), "consent": True}
    assert client.post("/api/signing/sign", json=big, headers=auth).status_code == 413
    streamed = client.post("/api/signing/sign", content=chunked(2 * 1024 * 1024), headers={**auth, "Content-Type": "application/json"})
    assert streamed.status_code == 413
    ok = client.post("/api/signing/sign", json={"name": "Jordan", "method": "drawn", "image": data_url(), "consent": True}, headers=auth)
    assert ok.status_code == 200


# --- Response headers ----------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/api/health", "/api/agreements", "/api/sample-agreement.pdf", "/api/files/missing"])
def test_responses_cannot_be_framed_cached_or_sniffed(client, path):
    headers = client.get(path).headers
    assert headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Cache-Control"] == "no-store"
    assert headers["Referrer-Policy"] == "no-referrer"


def test_rejected_requests_also_carry_security_headers(client):
    response = client.get("/api/health", headers={"Host": "evil.example"})
    assert response.headers["X-Frame-Options"] == "DENY"


# --- Signing link format ---------------------------------------------------------------------------

def test_signing_secret_is_in_the_url_fragment_which_browsers_never_send(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    path = client.post(f"/api/files/{item['id']}/send").json()["signing_path"]
    page, _, secret = path.partition("#")
    assert page == "/sign"
    assert len(secret) >= 43
    reissued = client.post(f"/api/files/{item['id']}/link").json()["signing_path"]
    assert reissued.startswith("/sign#") and reissued != path
