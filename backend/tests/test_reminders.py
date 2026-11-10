"""Daily reminders until the client signs, and an email to staff when they do."""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.email import EmailError, reminder_email, signed_notice_email
from app.main import create_app
from app.reminders import reminder_interval, send_due_reminders
from tests import db
from tests.staff import StaffClient
from tests.test_files import file_body, prepared_agreement, token_from
from tests.test_signing import auth, submission

NOTICE_SUBJECT = "Jordan Smith signed"


class FakeSender:
    def __init__(self):
        self.sent, self.fail = [], False

    def send(self, email):
        if email.subject == "Confirm your email for Astra Sign":
            return
        if self.fail:
            raise EmailError("provider down")
        self.sent.append(email)

    def reminders(self):
        return [e for e in self.sent if e.subject.startswith("Reminder:")]

    def notices(self):
        return [e for e in self.sent if e.subject.startswith(NOTICE_SUBJECT)]


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def app(tmp_path, outbox):
    return create_app(tmp_path, email_sender=outbox)


@pytest.fixture
def client(app):
    with StaffClient(app, company="Riverside Builders", name="Ana Lopez", email="ana@riverside.example") as client:
        yield client


def storage_of(app):
    return app.state.storage


def sent(client, email=True):
    item = client.post("/api/files", json=file_body(prepared_agreement(client)["id"])).json()
    response = client.post(f"/api/files/{item['id']}/send", json={"email": email}).json()
    return response["file"], token_from(response["signing_path"])


def make_due(file_id):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.execute("UPDATE files SET remind_at = %s WHERE id = %s", (past, file_id))


def link_in(email):
    return token_from("/sign#" + email.text.split("/sign#")[1].split()[0])


def run(app, outbox):
    return send_due_reminders(storage_of(app), outbox)


def event_types(client, file_id):
    return [e["type"] for e in client.get(f"/api/files/{file_id}/events").json()]


def can_open(client, token):
    return client.get("/api/signing", headers=auth(token)).status_code == 200


# --- scheduling ------------------------------------------------------------------------------------------

def test_an_emailed_send_schedules_a_reminder_after_the_interval(client):
    before = datetime.now(timezone.utc)
    item, _ = sent(client)
    due = datetime.fromisoformat(item["next_reminder_at"])
    assert timedelta(hours=23, minutes=59) < due - before < timedelta(hours=24, minutes=1)
    assert item["reminders_sent"] == 0


def test_no_reminders_when_staff_share_the_link_themselves(client, app, outbox):
    item, _ = sent(client, email=False)
    assert item["next_reminder_at"] is None
    db.execute("UPDATE files SET remind_at = NULL")  # nothing to make due
    assert run(app, outbox) == 0 and outbox.reminders() == []


def test_interval_comes_from_the_environment(monkeypatch):
    assert reminder_interval() == timedelta(hours=24)
    monkeypatch.setenv("ASTRA_REMINDER_MINUTES", "2")
    assert reminder_interval() == timedelta(minutes=2)
    for bad in ("0", "-5", "soon", "inf", "nan", "1e30"):
        monkeypatch.setenv("ASTRA_REMINDER_MINUTES", bad)
        assert reminder_interval() == timedelta(hours=24)


# --- sending reminders ---------------------------------------------------------------------------------

def test_a_due_reminder_emails_a_new_link_and_the_old_one_keeps_working(client, app, outbox):
    item, first = sent(client)
    make_due(item["id"])
    assert run(app, outbox) == 1
    [reminder] = outbox.reminders()
    assert reminder.to == "jordan@example.com" and reminder.reply_to == "ana@riverside.example"
    assert reminder.from_name == "Ana Lopez via Astra Sign"
    assert reminder.subject.startswith("Reminder: Ana Lopez sent you ")
    new = link_in(reminder)
    assert new != first and can_open(client, new) and can_open(client, first)
    assert new not in str(db.rows("SELECT * FROM signing_links"))  # only the hash is stored
    updated = client.get(f"/api/files/{item['id']}").json()
    assert updated["reminders_sent"] == 1
    assert datetime.fromisoformat(updated["next_reminder_at"]) > datetime.now(timezone.utc) + timedelta(hours=23)
    events = client.get(f"/api/files/{item['id']}/events").json()
    assert events[-1]["type"] == "reminder_sent" and events[-1]["detail"] == "jordan@example.com"
    assert run(app, outbox) == 0  # not due again yet


def test_the_client_can_sign_from_a_reminder_link(client, app, outbox):
    item, _ = sent(client)
    make_due(item["id"])
    run(app, outbox)
    response = client.post("/api/signing/sign", headers=auth(link_in(outbox.reminders()[0])), json=submission())
    assert response.status_code == 200
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is None


def test_viewed_files_are_reminded_signed_and_deleted_ones_are_not(client, app, outbox):
    viewed, viewed_token = sent(client)
    client.post("/api/signing/view", headers=auth(viewed_token))
    signed, signed_token = sent(client)
    client.post("/api/signing/sign", headers=auth(signed_token), json=submission())
    deleted, _ = sent(client)
    for item in (viewed, signed, deleted):
        make_due(item["id"])
    assert client.delete(f"/api/files/{deleted['id']}").status_code == 204
    assert run(app, outbox) == 1
    assert [e["type"] for e in client.get(f"/api/files/{viewed['id']}/events").json()][-1] == "reminder_sent"


def test_reissuing_revokes_reminder_links_and_restarts_the_schedule(client, app, outbox):
    item, _ = sent(client)
    make_due(item["id"])
    run(app, outbox)
    reminder_link = link_in(outbox.reminders()[0])
    reissued = client.post(f"/api/files/{item['id']}/link", json={"email": False}).json()
    assert not can_open(client, reminder_link)
    assert can_open(client, token_from(reissued["signing_path"]))
    assert reissued["file"]["next_reminder_at"] is None  # shared by hand this time: no reminders
    emailed = client.post(f"/api/files/{item['id']}/link").json()
    assert emailed["file"]["next_reminder_at"] is not None


def test_reminders_have_their_own_daily_limit_and_never_block_new_sends(client, app, outbox, monkeypatch):
    from app import email_limit
    monkeypatch.setattr(email_limit, "REMINDERS_PER_DAY", 1)
    monkeypatch.setattr(email_limit, "SIGNING_EMAILS_PER_DAY", 3)
    first, _ = sent(client)
    second, _ = sent(client)
    make_due(first["id"]); make_due(second["id"])
    assert run(app, outbox) == 1 and len(outbox.reminders()) == 1  # the reminder allowance is used up
    waiting = client.get(f"/api/files/{second['id']}").json()
    assert datetime.fromisoformat(waiting["next_reminder_at"]) > datetime.now(timezone.utc) + timedelta(minutes=50)  # tries again in an hour
    third = client.post("/api/files", json=file_body(prepared_agreement(client)["id"])).json()
    assert client.post(f"/api/files/{third['id']}/send").json()["email"] == "sending"  # reminders didn't use the send allowance


def test_a_failed_reminder_is_recorded_and_tried_again_next_time(client, app, outbox):
    item, _ = sent(client)
    outbox.fail = True
    make_due(item["id"])
    run(app, outbox)
    events = client.get(f"/api/files/{item['id']}/events").json()
    assert events[-1]["type"] == "reminder_failed" and events[-1]["detail"] == "jordan@example.com"
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is not None


def test_two_runs_at_once_send_one_reminder(client, app, outbox):
    item, _ = sent(client)
    make_due(item["id"])
    with ThreadPoolExecutor(max_workers=4) as pool:
        counts = list(pool.map(lambda _: run(app, outbox), range(4)))
    assert sum(counts) == 1 and len(outbox.reminders()) == 1


def test_the_app_sends_due_reminders_on_its_own(tmp_path, outbox, monkeypatch):
    monkeypatch.setenv("ASTRA_REMINDER_MINUTES", "0.05")  # 3 seconds: the loop checks every second
    with StaffClient(create_app(tmp_path, email_sender=outbox)) as client:
        item, _ = sent(client)
        deadline = time.monotonic() + 10
        while not outbox.reminders() and time.monotonic() < deadline:
            time.sleep(0.2)
        assert outbox.reminders(), "no reminder within 10 seconds"
        assert "reminder_sent" in event_types(client, item["id"])


# --- telling the company it was signed ---------------------------------------------------------------

def test_signing_emails_the_staff_member_who_sent_it(client, outbox):
    item, token = sent(client)
    assert client.post("/api/signing/sign", headers=auth(token), json=submission()).status_code == 200
    [notice] = outbox.notices()
    assert notice.to == "ana@riverside.example"
    assert "Smith kitchen remodel" in notice.text and "http://testserver/" in notice.text
    events = client.get(f"/api/files/{item['id']}/events").json()
    assert events[-1]["type"] == "signed_notice_sent" and events[-1]["detail"] == "ana@riverside.example"


def test_a_failed_signed_notice_is_recorded(client, outbox):
    item, token = sent(client)
    outbox.fail = True
    assert client.post("/api/signing/sign", headers=auth(token), json=submission()).status_code == 200
    assert event_types(client, item["id"])[-1] == "signed_notice_failed"


def test_without_email_configured_signing_still_works(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        item = client.post("/api/files", json=file_body(prepared_agreement(client)["id"])).json()
        token = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
        assert client.post("/api/signing/sign", headers=auth(token), json=submission()).status_code == 200
        assert not any(t.startswith("signed_notice") for t in event_types(client, item["id"]))


# --- the emails ------------------------------------------------------------------------------------------

def test_reminder_and_notice_emails_escape_names():
    reminder = reminder_email(to="c@x.co", signer_name="<Jo>", sender_name="Ana <b>", sender_email="a@x.co",
                              company="R&D", document_name="NDA <1>", link="https://app/sign#t")
    assert "&lt;Jo&gt;" in reminder.html and "<b>" not in reminder.html and "R&amp;D" in reminder.html
    assert reminder.subject.startswith("Reminder:") and "\n" not in reminder.subject
    notice = signed_notice_email(to="a@x.co", staff_name="Ana", signer_name="<Jo>", document_name="NDA\n<1>",
                                 file_title="Kitchen <x>", link="https://app/")
    assert "&lt;Jo&gt;" in notice.html and "Kitchen &lt;x&gt;" in notice.html and "\n" not in notice.subject


def test_a_stopping_app_sends_no_more_reminders(client, app, outbox):
    import threading
    item, _ = sent(client)
    make_due(item["id"])
    stop = threading.Event()
    stop.set()
    assert send_due_reminders(storage_of(app), outbox, stop) == 0 and outbox.reminders() == []


def test_the_reminder_doesnt_promise_that_older_links_work():
    """A reissue revokes earlier links, so the reminder can't say they still work."""
    reminder = reminder_email(to="c@x.co", signer_name="Jo", sender_name="Ana", sender_email="a@x.co",
                              company="R", document_name="NDA", link="https://app/sign#t")
    assert "earlier" not in reminder.text and "earlier" not in reminder.html
