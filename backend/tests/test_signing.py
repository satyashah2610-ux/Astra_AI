import hashlib
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests import db
from app.signing import CONSENT_TEXT
from tests.signature_images import data_url, png_bytes
from tests.test_agreements import pdf_bytes
from tests.test_files import create_file, prepared_agreement, token_from

BROWSER = "Mozilla/5.0 (Test Browser)"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path), headers={"User-Agent": BROWSER}) as client:
        yield client


def sent_file(client, content=None):
    """Create and send a file; returns (file, token)."""
    item = create_file(client, prepared_agreement(client, content)["id"]).json()
    response = client.post(f"/api/files/{item['id']}/send").json()
    return response["file"], token_from(response["signing_path"])


def auth(token):
    return {"X-Signing-Token": token}


def submission(**overrides):
    return {"name": "Jordan Smith", "method": "drawn", "image": data_url(), "consent": True, **overrides}


def sign(client, token, **overrides):
    return client.post("/api/signing/sign", headers=auth(token), json=submission(**overrides))


def events(client, file_id):
    return [event["type"] for event in client.get(f"/api/files/{file_id}/events").json()]


# --- access ----------------------------------------------------------------------

@pytest.mark.parametrize("headers", [{}, {"X-Signing-Token": ""}, {"X-Signing-Token": "made-up-token"}])
def test_missing_or_unknown_token_is_404_everywhere(client, headers):
    sent_file(client)
    for method, path in [("GET", "/api/signing"), ("POST", "/api/signing/view"), ("GET", "/api/signing/pdf"), ("POST", "/api/signing/sign")]:
        response = client.request(method, path, headers=headers, json=submission() if path.endswith("sign") else None)
        assert response.status_code == 404, path
        assert "invalid or has been replaced" in response.json()["detail"]


def test_reissued_link_revokes_the_old_one(client):
    item, old = sent_file(client)
    new = token_from(client.post(f"/api/files/{item['id']}/link").json()["signing_path"])
    assert client.get("/api/signing", headers=auth(old)).status_code == 404
    assert client.get("/api/signing", headers=auth(new)).status_code == 200


def test_signer_view_shows_document_without_internal_details(client):
    item, token = sent_file(client)
    response = client.get("/api/signing", headers=auth(token))
    assert response.status_code == 200
    view = response.json()
    assert view["document_name"] == item["document_name"]
    assert view["signer_name"] == "Jordan Smith"
    assert view["page_count"] == 2
    assert view["status"] == "sent"
    assert view["signed_at"] is None
    assert view["consent_text"] == CONSENT_TEXT
    assert len(view["marks"]) == 1 and view["marks"][0]["page"] == 1
    assert "jordan@example.com" not in response.text
    assert item["title"] not in response.text
    assert not {"id", "token_hash", "signer_email", "title", "agreement_id"} & view.keys()


def test_reading_the_view_does_not_mark_it_viewed(client):
    item, token = sent_file(client)
    client.get("/api/signing", headers=auth(token))
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "sent"


def test_signer_pdf_is_the_frozen_snapshot(client):
    content = pdf_bytes(pages=2)
    item, token = sent_file(client, content)
    response = client.get("/api/signing/pdf", headers=auth(token))
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == content


# --- viewed --------------------------------------------------------------------------

def test_view_moves_sent_to_viewed_once(client):
    item, token = sent_file(client)
    first = client.post("/api/signing/view", headers=auth(token))
    assert first.status_code == 200 and first.json()["status"] == "viewed"
    viewed_at = client.get(f"/api/files/{item['id']}").json()["viewed_at"]
    assert viewed_at is not None
    assert client.post("/api/signing/view", headers=auth(token)).json()["status"] == "viewed"
    assert client.get(f"/api/files/{item['id']}").json()["viewed_at"] == viewed_at
    assert events(client, item["id"]).count("viewed") == 1


# --- sign ------------------------------------------------------------------------------

def test_signing_records_signature_and_evidence(client, tmp_path):
    item, token = sent_file(client)
    client.post("/api/signing/view", headers=auth(token))
    image = png_bytes()
    response = sign(client, token, image=data_url(image), method="typed", name="  Jordan A. Smith ")
    assert response.status_code == 200
    assert response.json()["status"] == "signed"
    assert response.json()["signed_at"] is not None
    staff_view = client.get(f"/api/files/{item['id']}").json()
    assert staff_view["status"] == "signed"
    assert staff_view["signed_at"] == response.json()["signed_at"]
    assert (tmp_path / "signatures" / f"{item['id']}.png").read_bytes() == image
    row = dict(db.row("SELECT * FROM signatures WHERE file_id = %s", (item["id"],)))
    assert row["method"] == "typed"
    assert row["name"] == "Jordan A. Smith"
    assert row["image_sha256"] == hashlib.sha256(image).hexdigest()
    assert row["consent_text"] == CONSENT_TEXT
    assert row["user_agent"] == BROWSER
    assert row["ip"]
    assert row["signed_at"] == staff_view["signed_at"]


def test_signing_directly_from_sent_is_allowed(client):
    item, token = sent_file(client)
    assert sign(client, token).status_code == 200
    assert events(client, item["id"]) == ["created", "sent", "signed"]


def test_signed_file_cannot_be_signed_again(client):
    item, token = sent_file(client)
    assert sign(client, token).status_code == 200
    second = sign(client, token, name="Someone Else")
    assert second.status_code == 409
    assert client.get("/api/signing", headers=auth(token)).json()["status"] == "signed"
    assert events(client, item["id"]).count("signed") == 1


def test_signed_link_still_shows_the_signed_state(client):
    _, token = sent_file(client)
    sign(client, token)
    assert client.get("/api/signing", headers=auth(token)).status_code == 200
    assert client.post("/api/signing/view", headers=auth(token)).json()["status"] == "signed"


def test_simultaneous_signs_produce_exactly_one_signature(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        item, token = sent_file(client)
        with ThreadPoolExecutor(max_workers=4) as pool:
            codes = list(pool.map(lambda _: sign(client, token).status_code, range(4)))
        assert sorted(codes) == [200, 409, 409, 409]
        assert events(client, item["id"]).count("signed") == 1


@pytest.mark.parametrize("changes", [
    {"consent": False}, {"image": data_url(b"not a png")}, {"image": data_url(png_bytes(size=(4, 4)))},
    {"method": "uploaded"}, {"name": ""},
])
def test_invalid_submissions_change_nothing(client, tmp_path, changes):
    item, token = sent_file(client)
    assert sign(client, token, **changes).status_code == 422
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "sent"
    assert not (tmp_path / "signatures" / f"{item['id']}.png").exists()


# --- staff timeline and lifecycle -------------------------------------------------------

def test_events_timeline_records_the_full_lifecycle(client):
    item, token = sent_file(client)
    client.post(f"/api/files/{item['id']}/link")
    token = token_from(client.post(f"/api/files/{item['id']}/link").json()["signing_path"])
    client.post("/api/signing/view", headers=auth(token))
    sign(client, token)
    timeline = client.get(f"/api/files/{item['id']}/events").json()
    assert [event["type"] for event in timeline] == ["created", "sent", "link_reissued", "link_reissued", "viewed", "signed"]
    assert all(event["at"] for event in timeline)
    signer_events = [event for event in timeline if event["type"] in {"viewed", "signed"}]
    assert all(event["user_agent"] == BROWSER and event["ip"] for event in signer_events)


def test_events_for_unknown_file_is_404(client):
    assert client.get("/api/files/missing/events").status_code == 404


def test_deleting_an_unsigned_file_removes_its_events(client, tmp_path):
    item, token = sent_file(client)
    client.post("/api/signing/view", headers=auth(token))
    assert client.delete(f"/api/files/{item['id']}").status_code == 204
    assert db.value("SELECT COUNT(*) FROM file_events WHERE file_id = %s", (item["id"],)) == 0
    assert client.get("/api/signing", headers=auth(token)).status_code == 404


def test_signed_file_survives_restart(tmp_path):
    with TestClient(create_app(tmp_path)) as first:
        item, token = sent_file(first)
        sign(first, token)
    with TestClient(create_app(tmp_path)) as restarted:
        assert restarted.get("/api/signing", headers=auth(token)).json()["status"] == "signed"
        assert events(restarted, item["id"]) == ["created", "sent", "signed"]
        assert (tmp_path / "signatures" / f"{item['id']}.png").is_file()
