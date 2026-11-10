"""Login protection: failed-login limits and confirming a new account's email address."""
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.email import EmailError
from app.main import create_app
from tests import db
from tests.staff import PASSWORD

EMAIL = "ana@riverside.example"
LOCKED = "Too many failed attempts. Wait 15 minutes, or reset your password."
CHECK_EMAIL = "Account created. Check your email for a link to confirm your address, then log in."
NOT_CONFIRMED = "Confirm your email address first: use the link we sent you, or send a new one."
CONFIRMED = "Email confirmed. Log in to continue."
RESEND_ANSWER = "If that account still needs confirming, we’ve sent a new link."


class FakeSender:
    def __init__(self):
        self.sent, self.fail = [], False

    def send(self, email):
        if self.fail:
            raise EmailError("provider down")
        self.sent.append(email)


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def client(tmp_path, outbox):
    with TestClient(create_app(tmp_path, email_sender=outbox)) as client:
        yield client


def signup(client, email=EMAIL):
    return client.post("/api/auth/signup", json={"company": "Riverside", "name": "Ana Lopez", "email": email, "password": PASSWORD})


def login(client, password=PASSWORD, email=EMAIL, **headers):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=headers)


def confirm_token(email):
    match = re.search(r"/confirm-email#([A-Za-z0-9_-]{43,})", email.text)
    assert match, email.text
    return match.group(1)


def confirm(client, token):
    return client.post("/api/auth/confirm", json={"token": token})


def confirmed_account(client, outbox, email=EMAIL):
    assert signup(client, email).status_code == 201
    assert confirm(client, confirm_token(outbox.sent[-1])).status_code == 200


def ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


# --- failed-login limits ------------------------------------------------------------------------------

def test_five_failures_lock_that_email_even_for_the_right_password(client, outbox):
    confirmed_account(client, outbox)
    confirmed_account(client, outbox, "other@riverside.example")
    for _ in range(5):
        assert login(client, "wrong password!!").status_code == 401
    response = login(client)
    assert response.status_code == 429 and response.json()["detail"] == LOCKED
    assert login(client, email="other@riverside.example").status_code == 200  # another account is unaffected


def test_unknown_emails_lock_the_same_way(client):
    for _ in range(5):
        assert login(client, email="nobody@riverside.example").status_code == 401
    assert login(client, email="nobody@riverside.example").json()["detail"] == LOCKED  # no hint whether it exists


def test_successful_logins_do_not_count(client, outbox):
    confirmed_account(client, outbox)
    for _ in range(4):
        assert login(client, "wrong password!!").status_code == 401
    for _ in range(3):
        assert login(client).status_code == 200
    assert db.value("SELECT COUNT(*) FROM login_failures") == 4


def test_failures_older_than_15_minutes_expire(client, outbox):
    confirmed_account(client, outbox)
    for _ in range(5):
        login(client, "wrong password!!")
    db.execute("UPDATE login_failures SET at = %s", (ago(16),))
    assert login(client).status_code == 200


def test_twenty_failures_from_one_address_lock_that_address(client, outbox):
    confirmed_account(client, outbox)
    for n in range(20):
        assert login(client, email=f"guess{n}@riverside.example").status_code == 401
    assert login(client).status_code == 429  # even a real account, from this address
    assert db.value("SELECT COUNT(*) FROM login_failures WHERE email = %s", (EMAIL,)) == 0


def test_a_password_reset_clears_the_lock(client, outbox):
    confirmed_account(client, outbox)
    for _ in range(5):
        login(client, "wrong password!!")
    client.post("/api/auth/forgot", json={"email": EMAIL})
    token = re.search(r"/reset-password#([A-Za-z0-9_-]{43,})", outbox.sent[-1].text).group(1)
    assert client.post("/api/auth/reset", json={"token": token, "password": "a brand new passphrase"}).status_code == 200
    assert login(client, "a brand new passphrase").status_code == 200


# --- confirming the email address ---------------------------------------------------------------------

def test_signup_sends_one_confirmation_link_and_login_waits_for_it(client, outbox):
    response = signup(client)
    assert response.status_code == 201 and response.json() == {"message": CHECK_EMAIL}
    assert len(outbox.sent) == 1 and outbox.sent[0].to == EMAIL
    assert "Confirm your email" in outbox.sent[0].subject
    token = confirm_token(outbox.sent[0])
    assert token not in str(db.rows("SELECT * FROM email_confirmations"))  # only a hash is stored
    assert login(client, "wrong password!!").status_code == 401  # "unconfirmed" is only revealed with the right password
    unconfirmed = login(client)
    assert unconfirmed.status_code == 403 and unconfirmed.json()["detail"] == NOT_CONFIRMED
    assert "set-cookie" not in unconfirmed.headers
    assert confirm(client, token).json() == {"message": CONFIRMED}
    assert login(client).status_code == 200


def test_a_confirmation_link_works_once_and_expires(client, outbox):
    signup(client)
    token = confirm_token(outbox.sent[0])
    assert confirm(client, token).status_code == 200
    assert confirm(client, token).status_code == 400
    signup(client, "late@riverside.example")
    late = confirm_token(outbox.sent[-1])
    db.execute("UPDATE email_confirmations SET expires_at = %s WHERE used_at IS NULL", (ago(1),))
    assert confirm(client, late).status_code == 400
    assert confirm(client, "made-up-token-made-up-token-made-up-token-123").status_code == 400
    assert login(client, email="late@riverside.example").status_code == 403


def test_a_new_link_can_be_requested_without_revealing_accounts(client, outbox):
    signup(client)
    confirmed_account(client, outbox, "done@riverside.example")
    outbox.sent.clear()
    for email in (EMAIL, "nobody@riverside.example", "done@riverside.example"):
        response = client.post("/api/auth/resend-confirmation", json={"email": email})
        assert response.status_code == 202 and response.json() == {"message": RESEND_ANSWER}
    assert [email.to for email in outbox.sent] == [EMAIL]  # only the unconfirmed account gets one
    assert confirm(client, confirm_token(outbox.sent[0])).status_code == 200
    assert login(client).status_code == 200


def test_new_links_are_limited_per_hour(client, outbox):
    signup(client)  # the first link
    for _ in range(4):
        client.post("/api/auth/resend-confirmation", json={"email": EMAIL})
    assert len(outbox.sent) == 3  # at most 3 links per account per hour


def test_a_password_reset_also_confirms_the_email(client, outbox):
    signup(client)
    client.post("/api/auth/forgot", json={"email": EMAIL})
    token = re.search(r"/reset-password#([A-Za-z0-9_-]{43,})", outbox.sent[-1].text).group(1)
    client.post("/api/auth/reset", json={"token": token, "password": "a brand new passphrase"})
    assert login(client, "a brand new passphrase").status_code == 200


def test_without_email_configured_accounts_are_confirmed_at_once(tmp_path):
    with TestClient(create_app(tmp_path)) as client:  # tests clear all email settings
        assert signup(client).json() == {"message": "Account created. Log in to continue."}
        assert login(client).status_code == 200


def test_the_new_endpoints_take_only_small_requests_and_no_login(client):
    big = "x" * (2 * 1024 * 1024)
    assert client.post("/api/auth/confirm", json={"token": big}).status_code == 413
    assert client.post("/api/auth/resend-confirmation", json={"email": "a@b.co", "pad": big}).status_code == 413
    assert client.post("/api/auth/confirm", json={"token": "short"}).status_code == 422
