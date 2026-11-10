import hashlib
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.staff import StaffClient
from app.tokens import hash_token
from tests import db
from tests.test_agreements import mark, pdf_bytes, save, upload


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


def prepared_agreement(client, content=None, marks=None):
    """An uploaded agreement with saved signature boxes, ready to be sent."""
    agreement = upload(client, content or pdf_bytes()).json()
    assert save(client, agreement["id"], marks if marks is not None else [mark()]).status_code == 200
    return agreement


def file_body(agreement_id, **overrides):
    return {"title": "Smith kitchen remodel", "client_name": "Smith Family", "signer_name": "Jordan Smith",
            "signer_email": "jordan@example.com", "agreement_id": agreement_id, **overrides}


def create_file(client, agreement_id, **overrides):
    return client.post("/api/files", json=file_body(agreement_id, **overrides))


def token_from(path):
    assert path.startswith("/sign#")
    return path.removeprefix("/sign#")


def stored_row(tmp_path, file_id):
    return dict(db.row("SELECT * FROM files WHERE id = %s", (file_id,)))


SECRET_KEYS = {"token", "token_hash", "signing_token"}


# --- create / read -----------------------------------------------------------

def test_create_list_and_get_draft_file(client):
    agreement = prepared_agreement(client)
    response = create_file(client, agreement["id"])
    assert response.status_code == 201
    item = response.json()
    assert item["status"] == "draft"
    assert item["title"] == "Smith kitchen remodel"
    assert item["signer_email"] == "jordan@example.com"
    assert item["agreement_id"] == agreement["id"]
    assert item["version"] == 0
    assert item["sent_at"] is None
    assert item["field_count"] == 0
    assert not SECRET_KEYS & item.keys()
    assert client.get("/api/files").json() == [item]
    assert client.get(f"/api/files/{item['id']}").json() == item


def test_files_are_listed_newest_first(client):
    agreement = prepared_agreement(client)
    first = create_file(client, agreement["id"], title="First").json()
    second = create_file(client, agreement["id"], title="Second").json()
    assert [f["id"] for f in client.get("/api/files").json()] == [second["id"], first["id"]]


def test_unknown_agreement_is_rejected_without_creating_a_file(client):
    response = create_file(client, "no-such-agreement")
    assert response.status_code == 422
    assert "agreement" in response.json()["detail"].lower()
    assert client.get("/api/files").json() == []


@pytest.mark.parametrize("changes", [{"title": ""}, {"signer_email": "nope"}, {"client_name": "x" * 201}])
def test_invalid_fields_are_rejected_without_creating_a_file(client, changes):
    agreement = prepared_agreement(client)
    assert create_file(client, agreement["id"], **changes).status_code == 422
    assert client.get("/api/files").json() == []


def test_unknown_file_is_404(client):
    assert client.get("/api/files/missing").status_code == 404
    assert client.patch("/api/files/missing", json={"version": 0, "title": "x"}).status_code == 404
    assert client.delete("/api/files/missing").status_code == 404
    assert client.post("/api/files/missing/send").status_code == 404
    assert client.post("/api/files/missing/link").status_code == 404
    assert client.get("/api/files/missing/pdf").status_code == 404


# --- edit drafts ---------------------------------------------------------------

def test_draft_can_be_edited_with_version_check(client):
    agreement = prepared_agreement(client)
    other = prepared_agreement(client)
    item = create_file(client, agreement["id"]).json()
    response = client.patch(f"/api/files/{item['id']}", json={"version": 0, "signer_name": "Alex Smith", "agreement_id": other["id"]})
    assert response.status_code == 200
    updated = response.json()
    assert updated["signer_name"] == "Alex Smith"
    assert updated["agreement_id"] == other["id"]
    assert updated["title"] == item["title"]
    assert updated["version"] == 1
    stale = client.patch(f"/api/files/{item['id']}", json={"version": 0, "title": "Old tab"})
    assert stale.status_code == 409
    assert client.get(f"/api/files/{item['id']}").json()["title"] == item["title"]


def test_edit_to_unknown_agreement_is_rejected(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    assert client.patch(f"/api/files/{item['id']}", json={"version": 0, "agreement_id": "missing"}).status_code == 422


def test_sent_file_cannot_be_edited(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    client.post(f"/api/files/{item['id']}/send")
    response = client.patch(f"/api/files/{item['id']}", json={"version": 1, "signer_email": "other@example.com"})
    assert response.status_code == 409
    assert client.get(f"/api/files/{item['id']}").json()["signer_email"] == "jordan@example.com"


# --- send ----------------------------------------------------------------------

def test_send_snapshots_document_and_returns_signing_link(client, tmp_path):
    content = pdf_bytes(pages=3)
    agreement = prepared_agreement(client, content, [mark(), mark(id="signature-2", page=3)])
    item = create_file(client, agreement["id"]).json()
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 200
    body = response.json()
    sent = body["file"]
    token = token_from(body["signing_path"])
    assert sent["status"] == "sent"
    assert sent["sent_at"] is not None
    assert sent["field_count"] == 2
    assert sent["page_count"] == 3
    assert sent["document_name"] == agreement["name"]
    assert sent["document_sha256"] == hashlib.sha256(content).hexdigest()
    assert not SECRET_KEYS & sent.keys()
    row = stored_row(tmp_path, item["id"])
    assert row["token_hash"] == hash_token(token)
    assert token not in str(row)
    assert client.get(f"/api/files/{item['id']}/pdf").content == content


def test_send_requires_signature_boxes(client):
    agreement = prepared_agreement(client, marks=[])
    item = create_file(client, agreement["id"]).json()
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 409
    assert "signature box" in response.json()["detail"].lower()
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "draft"


def test_draft_has_no_document_snapshot_yet(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    assert client.get(f"/api/files/{item['id']}/pdf").status_code == 404


def test_send_twice_is_rejected(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    assert client.post(f"/api/files/{item['id']}/send").status_code == 200
    assert client.post(f"/api/files/{item['id']}/send").status_code == 409


def test_simultaneous_sends_produce_exactly_one_link(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        item = create_file(client, prepared_agreement(client)["id"]).json()
        with ThreadPoolExecutor(max_workers=4) as pool:
            codes = list(pool.map(lambda _: client.post(f"/api/files/{item['id']}/send").status_code, range(4)))
    assert sorted(codes) == [200, 409, 409, 409]


def test_sent_document_is_independent_of_later_template_changes(client):
    content = pdf_bytes()
    agreement = prepared_agreement(client, content)
    item = create_file(client, agreement["id"]).json()
    client.post(f"/api/files/{item['id']}/send")
    assert save(client, agreement["id"], [], version=1).status_code == 200
    assert client.delete(f"/api/agreements/{agreement['id']}").status_code == 204
    after = client.get(f"/api/files/{item['id']}").json()
    assert after["field_count"] == 1
    assert after["document_name"] == agreement["name"]
    assert client.get(f"/api/files/{item['id']}/pdf").content == content


# --- reissue link ----------------------------------------------------------------

def test_reissue_link_revokes_the_old_token(client, tmp_path):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    old = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    response = client.post(f"/api/files/{item['id']}/link")
    assert response.status_code == 200
    new = token_from(response.json()["signing_path"])
    assert new != old
    assert response.json()["file"]["status"] == "sent"
    assert stored_row(tmp_path, item["id"])["token_hash"] == hash_token(new)


def test_draft_has_no_link_to_reissue(client):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    assert client.post(f"/api/files/{item['id']}/link").status_code == 409


# --- delete ------------------------------------------------------------------------

def test_agreement_used_by_a_draft_cannot_be_deleted(client):
    agreement = prepared_agreement(client)
    item = create_file(client, agreement["id"]).json()
    response = client.delete(f"/api/agreements/{agreement['id']}")
    assert response.status_code == 409
    assert "file" in response.json()["detail"].lower()
    assert client.get(f"/api/agreements/{agreement['id']}").status_code == 200
    assert client.delete(f"/api/files/{item['id']}").status_code == 204
    assert client.delete(f"/api/agreements/{agreement['id']}").status_code == 204


def test_deleting_a_sent_file_removes_snapshot_and_link(client, tmp_path):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    client.post(f"/api/files/{item['id']}/send")
    assert (tmp_path / "documents" / f"{item['id']}.pdf").is_file()
    assert client.delete(f"/api/files/{item['id']}").status_code == 204
    assert not (tmp_path / "documents" / f"{item['id']}.pdf").exists()
    assert client.get(f"/api/files/{item['id']}").status_code == 404


def test_signed_file_cannot_be_deleted(client, tmp_path):
    item = create_file(client, prepared_agreement(client)["id"]).json()
    client.post(f"/api/files/{item['id']}/send")
    db.execute("UPDATE files SET status = 'signed' WHERE id = %s", (item["id"],))
    assert client.delete(f"/api/files/{item['id']}").status_code == 409
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "signed"
    assert client.post(f"/api/files/{item['id']}/link").status_code == 409


# --- persistence --------------------------------------------------------------------

def test_files_and_snapshots_survive_restart(tmp_path):
    content = pdf_bytes()
    with StaffClient(create_app(tmp_path)) as first:
        item = create_file(first, prepared_agreement(first, content)["id"]).json()
        first.post(f"/api/files/{item['id']}/send")
    with StaffClient(create_app(tmp_path)) as restarted:
        reloaded = restarted.get(f"/api/files/{item['id']}").json()
        assert reloaded["status"] == "sent"
        assert reloaded["field_count"] == 1
        assert restarted.get(f"/api/files/{item['id']}/pdf").content == content
