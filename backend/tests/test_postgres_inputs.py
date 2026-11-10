"""Inputs PostgreSQL treats differently from SQLite: NUL characters and database-level name clashes."""
import pytest
from fastapi.testclient import TestClient

import app.main
from app.main import create_app
from tests.test_agreements import mark, pdf_bytes, save, upload
from tests.test_files import create_file, file_body, prepared_agreement, token_from


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


@pytest.mark.parametrize("path", ["/api/files/%00", "/api/agreements/%00", "/api/agreements/a%00b/pdf", "/api/files/x%00/signed.pdf"])
def test_nul_in_an_identifier_is_not_found_not_a_server_error(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("field", ["title", "client_name", "signer_name", "signer_email", "agreement_id"])
def test_nul_in_file_fields_is_rejected_cleanly(client, field):
    agreement = prepared_agreement(client)
    body = file_body(agreement["id"])
    body[field] = body[field][:3] + "\x00" + body[field][3:]
    assert client.post("/api/files", json=body).status_code == 422
    assert client.get("/api/files").json() == []


def test_nul_in_template_text_is_rejected_cleanly(client):
    agreement = upload(client).json()
    assert save(client, agreement["id"], [mark(type="comment", text="Tick\x00 here")]).status_code == 422


def test_nul_in_signing_input_is_rejected_cleanly(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    token = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    from tests.signature_images import data_url
    body = {"name": "Jordan\x00 Smith", "method": "drawn", "image": data_url(), "consent": True}
    assert client.post("/api/signing/sign", headers={"X-Signing-Token": token}, json=body).status_code == 422
    body = {"name": "Jordan Smith", "method": "drawn", "image": data_url(), "consent": True,
            "items": [{"id": "t", "type": "text", "page": 1, "x": .1, "y": .1, "width": .2, "height": .02, "text": "A\x00B"}]}
    assert client.post("/api/signing/sign", headers={"X-Signing-Token": token}, json=body).status_code == 422


def test_nul_in_an_uploaded_file_name_is_removed(client):
    # Build the upload by hand: the test client would percent-encode a NUL, but a raw request can carry one.
    boundary = "astra-boundary"
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="Con\x00tract.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n").encode("latin-1")
    body = head + pdf_bytes() + f"\r\n--{boundary}--\r\n".encode()
    response = client.post("/api/agreements", content=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert response.status_code == 201
    assert response.json()["name"] == "Contract"
    assert response.json()["filename"] == "Contract.pdf"


def test_a_name_the_database_considers_taken_gives_a_clear_conflict_not_a_crash(client, monkeypatch):
    upload(client, name="Agreement.pdf")
    # Python and PostgreSQL can disagree about case for unusual characters; simulate PostgreSQL seeing a clash.
    monkeypatch.setattr(app.main, "unique_name", lambda base, used: "AGREEMENT")
    response = upload(client, content=pdf_bytes(), name="Other.pdf")
    assert response.status_code == 409
    assert "rename" in response.json()["detail"].lower()
    assert [a["name"] for a in client.get("/api/agreements").json()] == ["Agreement"]
