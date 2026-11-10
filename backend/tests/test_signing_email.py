"""Emailing the signing link: personal, optional, never blocking the send, recorded on the timeline."""
import pytest

from app.email import EmailError
from app.main import create_app
from tests import db
from tests.staff import StaffClient
from tests.test_files import file_body, prepared_agreement, token_from

MESSAGE = "Hi Jordan,\nHere's the agreement we discussed. <b>Thanks</b>"


class FakeSender:
    def __init__(self):
        self.sent, self.fail = [], False

    def send(self, email):
        if email.subject == "Confirm your email for Astra Sign":
            return  # sign-up confirmations are tested in test_login_protection; here only this file's emails count
        if self.fail:
            raise EmailError("provider down")
        self.sent.append(email)


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def client(tmp_path, outbox):
    with StaffClient(create_app(tmp_path, email_sender=outbox), company="Riverside Builders", name="Ana Lopez",
                     email="ana@riverside.example") as client:
        yield client


def draft(client, **overrides):
    response = client.post("/api/files", json=file_body(prepared_agreement(client)["id"], **overrides))
    assert response.status_code == 201, response.text
    return response.json()


def events(client, file_id):
    return client.get(f"/api/files/{file_id}/events").json()


# --- sending ------------------------------------------------------------------------------------------

def test_sending_emails_the_signer_a_personal_link(client, outbox):
    item = draft(client, message=MESSAGE)
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 200 and response.json()["email"] == "sending"
    token = token_from(response.json()["signing_path"])
    assert len(outbox.sent) == 1
    email = outbox.sent[0]
    assert email.to == "jordan@example.com" and email.reply_to == "ana@riverside.example"
    assert email.from_name == "Ana Lopez via Astra Sign"
    assert f"http://testserver/sign#{token}" in email.text
    assert "Riverside Builders" in email.html and "&lt;b&gt;Thanks&lt;/b&gt;" in email.html
    sent = [e for e in events(client, item["id"]) if e["type"] == "email_sent"]
    assert len(sent) == 1 and sent[0]["detail"] == "jordan@example.com"


def test_staff_can_choose_not_to_email(client, outbox):
    item = draft(client)
    response = client.post(f"/api/files/{item['id']}/send", json={"email": False})
    assert response.status_code == 200 and response.json()["email"] == "off"
    assert outbox.sent == []
    assert not any(e["type"].startswith("email_") for e in events(client, item["id"]))


def test_without_email_configured_the_file_is_still_sent(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:  # tests clear all email settings
        item = draft(client)
        response = client.post(f"/api/files/{item['id']}/send")
        assert response.status_code == 200
        assert response.json()["email"] == "not_configured"
        assert response.json()["file"]["status"] == "sent"


def test_a_delivery_failure_is_recorded_and_the_file_stays_sent(client, outbox):
    outbox.fail = True
    item = draft(client)
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 200 and response.json()["file"]["status"] == "sent"
    failed = [e for e in events(client, item["id"]) if e["type"] == "email_failed"]
    assert len(failed) == 1 and failed[0]["detail"] == "jordan@example.com"


def test_reissuing_emails_the_new_link(client, outbox):
    item = draft(client)
    old = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    response = client.post(f"/api/files/{item['id']}/link")
    assert response.json()["email"] == "sending"
    new = token_from(response.json()["signing_path"])
    assert len(outbox.sent) == 2 and f"/sign#{new}" in outbox.sent[1].text and old not in outbox.sent[1].text
    assert client.get("/api/signing", headers={"X-Signing-Token": old}).status_code == 404


def test_reissuing_without_email_sends_nothing(client, outbox):
    item = draft(client)
    client.post(f"/api/files/{item['id']}/send", json={"email": False})
    assert client.post(f"/api/files/{item['id']}/link", json={"email": False}).json()["email"] == "off"
    assert outbox.sent == []


@pytest.mark.parametrize("body", [{"email": "yes"}, {"email": True, "extra": 1}])
def test_invalid_send_options_are_rejected(client, body):
    item = draft(client)
    assert client.post(f"/api/files/{item['id']}/send", json=body).status_code == 422
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "draft"


# --- the personal message ------------------------------------------------------------------------------

def test_the_message_is_stored_trimmed_and_shown_on_the_file(client):
    item = draft(client, message="  Hi Jordan, here you go.  ")
    assert item["message"] == "Hi Jordan, here you go."
    assert client.get(f"/api/files/{item['id']}").json()["message"] == "Hi Jordan, here you go."
    assert draft(client)["message"] is None


def test_the_message_can_be_edited_and_cleared_while_draft(client):
    item = draft(client, message="First")
    edited = client.patch(f"/api/files/{item['id']}", json={"version": 0, "message": "Second"}).json()
    assert edited["message"] == "Second"
    cleared = client.patch(f"/api/files/{item['id']}", json={"version": 1, "message": "   "}).json()
    assert cleared["message"] is None


@pytest.mark.parametrize("message", ["x" * 2001, "bad\x00message"])
def test_invalid_messages_are_rejected(client, message):
    agreement = prepared_agreement(client)
    assert client.post("/api/files", json=file_body(agreement["id"], message=message)).status_code == 422


def test_another_company_cannot_send_or_read_your_message(tmp_path, outbox):
    app = create_app(tmp_path, email_sender=outbox)
    with StaffClient(app, company="Alpha", email="a@alpha.example") as alpha, StaffClient(app, company="Beta", email="b@beta.example") as beta:
        item = draft(alpha, message="Private note")
        assert beta.get(f"/api/files/{item['id']}").status_code == 404
        assert beta.post(f"/api/files/{item['id']}/send").status_code == 404
        assert outbox.sent == []
        assert db.value("SELECT message FROM files WHERE id = %s", (item["id"],)) == "Private note"


def test_a_file_deleted_while_its_email_is_sending_leaves_no_event(tmp_path):
    class DeletingSender(FakeSender):
        def send(self, email):  # staff delete the file while the provider is still answering
            db.execute("DELETE FROM files")
            db.execute("DELETE FROM file_events")
            super().send(email)

    with StaffClient(create_app(tmp_path, email_sender=DeletingSender())) as client:
        item = draft(client)
        assert client.post(f"/api/files/{item['id']}/send").status_code == 200
        assert db.value("SELECT COUNT(*) FROM file_events WHERE file_id = %s", (item["id"],)) == 0


# --- daily limit: an account can't use our domain to mass-mail --------------------------------------------

@pytest.fixture
def small_limit(monkeypatch):
    import app.files
    monkeypatch.setattr(app.files, "SIGNING_EMAILS_PER_DAY", 2)


def test_after_the_daily_limit_files_are_still_sent_but_not_emailed(client, outbox, small_limit):
    results = [client.post(f"/api/files/{draft(client)['id']}/send").json() for _ in range(3)]
    assert [r["email"] for r in results] == ["sending", "sending", "limit_reached"]
    assert [r["file"]["status"] for r in results] == ["sent"] * 3
    assert len(outbox.sent) == 2
    item = results[0]["file"]
    assert client.post(f"/api/files/{item['id']}/link").json()["email"] == "limit_reached"  # reissues count too
    assert len(outbox.sent) == 2


def test_unemailed_sends_do_not_count_toward_the_limit(client, outbox, small_limit):
    for _ in range(3):
        client.post(f"/api/files/{draft(client)['id']}/send", json={"email": False})
    assert client.post(f"/api/files/{draft(client)['id']}/send").json()["email"] == "sending"


def test_the_limit_is_per_company_and_per_rolling_day(tmp_path, outbox, small_limit):
    app = create_app(tmp_path, email_sender=outbox)
    with StaffClient(app, company="Alpha", email="a@alpha.example") as alpha, StaffClient(app, company="Beta", email="b@beta.example") as beta:
        for _ in range(2):
            alpha.post(f"/api/files/{draft(alpha)['id']}/send")
        assert alpha.post(f"/api/files/{draft(alpha)['id']}/send").json()["email"] == "limit_reached"
        assert beta.post(f"/api/files/{draft(beta)['id']}/send").json()["email"] == "sending"  # another company is unaffected
        db.execute("UPDATE signing_emails SET at = '2000-01-01T00:00:00+00:00'")  # a day later
        assert alpha.post(f"/api/files/{draft(alpha)['id']}/send").json()["email"] == "sending"
