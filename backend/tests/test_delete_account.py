"""Deleting an account: the whole company and everything it stored, only after typing the confirmation phrase."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests import db
from tests.staff import PASSWORD, StaffClient
from tests.test_files import create_file, prepared_agreement
from tests.test_signing import auth, sent_file, sign

PHRASE = "I want to delete account"


def delete_account(client, confirm=PHRASE):
    return client.request("DELETE", "/api/auth/account", json={"confirm": confirm})


def counts(organization_id):
    """Rows this company owns, in every table that holds company data."""
    files = "SELECT id FROM files WHERE organization_id = %s"
    return {
        "organizations": db.value("SELECT COUNT(*) FROM organizations WHERE id = %s", (organization_id,)),
        "users": db.value("SELECT COUNT(*) FROM users WHERE organization_id = %s", (organization_id,)),
        "sessions": db.value("SELECT COUNT(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.organization_id = %s", (organization_id,)),
        "agreements": db.value("SELECT COUNT(*) FROM agreements WHERE organization_id = %s", (organization_id,)),
        "files": db.value("SELECT COUNT(*) FROM files WHERE organization_id = %s", (organization_id,)),
        "signing_emails": db.value("SELECT COUNT(*) FROM signing_emails WHERE organization_id = %s", (organization_id,)),
        **{table: db.value(f"SELECT COUNT(*) FROM {table} WHERE file_id IN ({files})", (organization_id,))
           for table in ("file_events", "signatures", "signer_items")},
    }


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path)


@pytest.mark.parametrize("confirm", ["", "i want to delete account", "I want to delete", "delete", " I want to delete account",
                                     "I want to delete account ", "I want to delete account.", "I want to delete acount"])
def test_a_wrong_phrase_deletes_nothing(app, confirm):
    with StaffClient(app) as client:
        prepared_agreement(client)
        assert delete_account(client, confirm).status_code == 422
        assert client.request("DELETE", "/api/auth/account", json={}).status_code == 422
        assert client.get("/api/auth/me").status_code == 200
        assert len(client.get("/api/agreements").json()) == 1


def test_needs_a_login(app):
    with TestClient(app) as anonymous:
        assert delete_account(anonymous).status_code == 401


def test_deletes_the_whole_company_and_its_stored_files(app, tmp_path):
    with StaffClient(app, company="Gone Co", email="gone@example.com") as gone, \
         StaffClient(app, company="Kept Co", email="kept@example.com") as kept:
        organization_id = gone.account["organization"]["id"]
        signed, token = sent_file(gone)
        gone.post("/api/signing/view", headers=auth(token))
        assert sign(gone, token).status_code == 200
        assert gone.get(f"/api/files/{signed['id']}/signed.pdf").status_code == 200  # signed PDF built and stored
        draft = create_file(gone, prepared_agreement(gone)["id"]).json()
        kept_file, kept_token = sent_file(kept)
        before = counts(organization_id)
        assert all(before[table] > 0 for table in ("organizations", "users", "sessions", "agreements", "files", "file_events", "signatures", "signer_items"))
        stored = [path for path in tmp_path.rglob("*") if path.is_file() and (signed["id"] in path.name or draft["agreement_id"] in path.name or signed["agreement_id"] in path.name)]
        assert len(stored) >= 4  # templates, the sent document, the signature image, the signed PDF

        response = delete_account(gone)
        assert response.status_code == 204
        assert 'astra_session=""' in response.headers.get("set-cookie", "")  # the browser forgets the session
        assert all(value == 0 for value in counts(organization_id).values()), counts(organization_id)
        assert not [path for path in stored if path.exists()]
        assert gone.get("/api/auth/me").status_code == 401
        assert gone.post("/api/auth/login", json={"email": "gone@example.com", "password": PASSWORD}).status_code == 401
        assert gone.get("/api/signing", headers=auth(token)).status_code == 404

        # Another company is untouched.
        assert kept.get("/api/auth/me").status_code == 200
        assert kept.get(f"/api/files/{kept_file['id']}").status_code == 200
        assert kept.get("/api/signing", headers=auth(kept_token)).status_code == 200

    with TestClient(create_app(tmp_path)) as again:  # the email is free to sign up again
        assert again.post("/api/auth/signup", json={"company": "Gone Co", "name": "Sam", "email": "gone@example.com", "password": PASSWORD}).status_code == 201


def test_ends_the_session_on_every_device(app):
    with StaffClient(app, email="two@example.com") as first, StaffClient(app, email="two@example.com") as second:
        assert delete_account(first).status_code == 204
        assert second.get("/api/auth/me").status_code == 401


# --- code review regressions ----------------------------------------------------------------------

def test_also_removes_reset_requests_and_unfinished_signed_pdfs(app, tmp_path):
    with StaffClient(app, email="gone@example.com") as client:
        item, _ = sent_file(client)
        client.post("/api/auth/forgot", json={"email": "gone@example.com"})
        assert db.value("SELECT COUNT(*) FROM password_reset_requests WHERE email = 'gone@example.com'") == 1
        leftover = tmp_path / "signed" / f"{item['id']}.x1y2.partial"  # left by an interrupted signed-PDF build
        leftover.parent.mkdir(parents=True, exist_ok=True)
        leftover.write_bytes(b"%PDF-partial")
        assert delete_account(client).status_code == 204
        assert db.value("SELECT COUNT(*) FROM password_reset_requests WHERE email = 'gone@example.com'") == 0
        assert not leftover.exists()


def test_removing_a_signed_pdf_waits_for_a_build_in_progress(tmp_path):
    """A signed PDF being built while the account is deleted must not be left behind."""
    import threading
    from app.signed_documents import _build_locks, remove_signed_pdf
    from app.storage import Storage

    storage = Storage(tmp_path, "unused")
    storage.signed.mkdir(parents=True, exist_ok=True)
    lock = _build_locks.setdefault("f-race", threading.Lock())
    lock.acquire()  # a build is running
    remover = threading.Thread(target=remove_signed_pdf, args=(storage, "f-race"))
    remover.start()
    remover.join(0.3)
    assert remover.is_alive()  # waits for the build
    storage.signed_pdf("f-race").write_bytes(b"%PDF-built")  # the build finishes and stores its PDF
    lock.release()
    remover.join(5)
    assert not storage.signed_pdf("f-race").exists()
