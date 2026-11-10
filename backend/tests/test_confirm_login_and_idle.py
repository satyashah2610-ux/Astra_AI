"""Confirming the email logs the user straight in (once); a session unused for 10 minutes ends."""
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.email import EmailError
from app.main import create_app
from tests import db
from tests.staff import PASSWORD, StaffClient

EMAIL = "ana@riverside.example"


class FakeSender:
    def __init__(self):
        self.sent = []

    def send(self, email):
        self.sent.append(email)


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def client(tmp_path, outbox):
    with TestClient(create_app(tmp_path, email_sender=outbox)) as client:
        yield client


def signed_up(client, outbox):
    assert client.post("/api/auth/signup", json={"company": "Riverside", "name": "Ana Lopez", "email": EMAIL,
                                                 "password": PASSWORD}).status_code == 201
    return re.search(r"/confirm-email#([A-Za-z0-9_-]{43,})", outbox.sent[-1].text).group(1)


def check(client, token):
    return client.post("/api/auth/confirm/check", json={"token": token})


def ago(**delta):
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()


# --- confirming logs in, once ------------------------------------------------------------------------

def test_confirming_with_the_password_logs_straight_in(client, outbox):
    token = signed_up(client, outbox)
    response = client.post("/api/auth/confirm", json={"token": token, "password": PASSWORD})
    assert response.status_code == 200 and response.json() == {"message": "Email confirmed."}
    assert "astra_session" in response.headers.get("set-cookie", "")
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["email"] == EMAIL


def test_a_wrong_password_on_the_confirm_page_does_not_log_in(client, outbox):
    token = signed_up(client, outbox)
    assert client.post("/api/auth/confirm", json={"token": token, "password": "not the password!!"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_the_page_can_ask_whether_a_link_is_still_usable(client, outbox):
    token = signed_up(client, outbox)
    assert check(client, token).json() == {"valid": True}
    assert check(client, token).json() == {"valid": True}  # asking doesn't use it up
    client.post("/api/auth/confirm", json={"token": token, "password": PASSWORD})
    assert check(client, token).json() == {"valid": False}  # used: the page sends the user to log in
    assert check(client, "made-up-token-made-up-token-made-up-token-123").json() == {"valid": False}
    assert check(client, "short").status_code == 422


def test_an_expired_link_is_not_usable(client, outbox):
    token = signed_up(client, outbox)
    db.execute("UPDATE email_confirmations SET expires_at = %s", (ago(minutes=1),))
    assert check(client, token).json() == {"valid": False}


def test_a_used_link_never_logs_in_again(client, outbox):
    token = signed_up(client, outbox)
    client.post("/api/auth/confirm", json={"token": token, "password": PASSWORD})
    client.post("/api/auth/logout")
    again = client.post("/api/auth/confirm", json={"token": token, "password": PASSWORD})
    assert again.status_code == 400 and "set-cookie" not in again.headers
    assert client.get("/api/auth/me").status_code == 401


# --- 10 minutes without activity ---------------------------------------------------------------------

@pytest.fixture
def staff(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


def test_the_server_never_ends_a_session_the_browser_still_counts_as_active(staff):
    """The browser logs out at exactly 10 minutes; it reports activity about once a minute and the server saves it
    every 30 seconds, so the server waits 12 minutes, for sessions the browser didn't close (e.g. a sleeping laptop)."""
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=11),))
    assert staff.get("/api/auth/me").status_code == 200


def test_a_session_unused_for_12_minutes_ends(staff):
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=12, seconds=5),))
    assert staff.get("/api/auth/me").status_code == 401
    assert db.value("SELECT COUNT(*) FROM sessions") == 0  # ended, not just refused
    assert staff.get("/api/files").status_code == 401


def test_using_the_app_keeps_the_session_alive(staff):
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=9),))
    assert staff.get("/api/files").status_code == 200
    seen = datetime.fromisoformat(db.value("SELECT last_seen_at FROM sessions"))
    assert datetime.now(timezone.utc) - seen < timedelta(seconds=30)  # the clock restarts
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=9),))
    assert staff.get("/api/auth/me").status_code == 200  # 9 + 9 minutes, but never 10 without activity


def test_activity_is_written_at_most_every_30_seconds(staff):
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(seconds=10),))
    before = db.value("SELECT last_seen_at FROM sessions")
    staff.get("/api/auth/me")
    assert db.value("SELECT last_seen_at FROM sessions") == before  # no write on every request


def test_logging_in_tidies_the_users_abandoned_sessions(staff):
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=30),))  # a browser that never came back
    assert staff.post("/api/auth/login", json={"email": "staff@example.com", "password": PASSWORD}).status_code == 200
    assert db.value("SELECT COUNT(*) FROM sessions") == 1  # only the new one


def test_a_new_login_starts_fresh(staff):
    db.execute("UPDATE sessions SET last_seen_at = %s", (ago(minutes=30),))
    assert staff.get("/api/auth/me").status_code == 401
    assert staff.post("/api/auth/login", json={"email": "staff@example.com", "password": PASSWORD}).status_code == 200
    assert staff.get("/api/auth/me").status_code == 200


def test_logging_in_again_after_confirming_works(client, outbox):
    """The browser-test helper confirms, then logs in: both must work."""
    token = signed_up(client, outbox)
    assert client.post("/api/auth/confirm", json={"token": token, "password": PASSWORD}).status_code == 200
    login = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert login.status_code == 200, login.text
