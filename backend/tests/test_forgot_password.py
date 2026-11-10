"""Forgot password: emailed one-time links, no account enumeration, limits, and signing out other sessions."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE, hash_session_token
from app.email import EmailError
from app.main import create_app
from tests import db
from tests.staff import PASSWORD, sign_in

GENERIC = "If an account exists for that email, we’ve sent a link to reset the password."
NEW_PASSWORD = "a brand new passphrase"


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
    with TestClient(create_app(tmp_path, email_sender=outbox)) as client:
        sign_in(client, email="ana@riverside.example", name="Ana Lopez")
        client.post("/api/auth/logout")
        yield client


def forgot(client, email="ana@riverside.example", **headers):
    return client.post("/api/auth/forgot", json={"email": email}, headers=headers)


def token_in(email):
    match = re.search(r"/reset-password#([A-Za-z0-9_-]{43,})", email.text)
    assert match, email.text
    return match.group(1)


def reset(client, token, password=NEW_PASSWORD):
    return client.post("/api/auth/reset", json={"token": token, "password": password})


def login(client, password):
    return client.post("/api/auth/login", json={"email": "ana@riverside.example", "password": password})


# --- requesting a link -----------------------------------------------------------------------------

def test_a_known_email_gets_one_link_and_only_its_hash_is_stored(client, outbox):
    response = forgot(client)
    assert response.status_code == 202 and response.json() == {"message": GENERIC}
    assert len(outbox.sent) == 1 and outbox.sent[0].to == "ana@riverside.example"
    assert "Ana Lopez" in outbox.sent[0].html
    token = token_in(outbox.sent[0])
    assert db.value("SELECT token_hash FROM password_resets") == hash_session_token(token)
    assert token not in str(db.rows("SELECT * FROM password_resets"))


def test_an_unknown_email_gets_the_same_answer_and_no_email(client, outbox):
    response = forgot(client, email="nobody@riverside.example")
    assert response.status_code == 202 and response.json() == {"message": GENERIC}
    assert outbox.sent == []


def test_email_case_does_not_matter(client, outbox):
    forgot(client, email="ANA@Riverside.Example")
    assert len(outbox.sent) == 1


def test_a_sending_failure_does_not_change_the_answer(client, outbox):
    outbox.fail = True
    response = forgot(client)
    assert response.status_code == 202 and response.json() == {"message": GENERIC}


def test_the_link_uses_the_configured_app_address(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRA_APP_URL", "https://app.signwithastra.com/")
    sender = FakeSender()
    with TestClient(create_app(tmp_path, email_sender=sender)) as client:
        sign_in(client, email="ana@riverside.example")
        forgot(client)
    assert "https://app.signwithastra.com/reset-password#" in sender.sent[0].text


def test_without_configuration_the_link_uses_the_allowed_host(client, outbox):
    forgot(client)
    assert "http://testserver/reset-password#" in outbox.sent[0].text


@pytest.mark.parametrize("body", [{"email": "not-an-email"}, {"email": "a@b.co", "extra": 1}, {}])
def test_invalid_requests_are_rejected(client, body):
    assert client.post("/api/auth/forgot", json=body).status_code == 422


# --- limits ------------------------------------------------------------------------------------------

def test_at_most_three_emails_per_account_per_hour(client, outbox):
    answers = [forgot(client).json() for _ in range(5)]
    assert answers == [{"message": GENERIC}] * 5
    assert len(outbox.sent) == 3


def test_at_most_ten_requests_per_address_per_hour(client, outbox):
    for n in range(10):
        forgot(client, email=f"someone{n}@riverside.example")
    forgot(client)  # the 11th request from this address: the real account gets nothing
    assert outbox.sent == []


def test_old_requests_no_longer_count(client, outbox):
    for _ in range(3):
        forgot(client)
    db.execute("UPDATE password_reset_requests SET at = %s", ((datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),))
    forgot(client)
    assert len(outbox.sent) == 4


# --- using a link ------------------------------------------------------------------------------------

def test_reset_sets_the_new_password_and_signs_out_every_session(tmp_path, outbox):
    with TestClient(create_app(tmp_path, email_sender=outbox)) as other_device, \
         TestClient(create_app(tmp_path, email_sender=outbox)) as this_device:
        sign_in(other_device, email="ana@riverside.example", name="Ana Lopez")
        assert other_device.get("/api/auth/me").status_code == 200
        forgot(this_device)
        response = reset(this_device, token_in(outbox.sent[-1]))
        assert response.status_code == 200
        assert response.json() == {"message": "Your password has been reset. Log in with your new password."}
        assert SESSION_COOKIE not in response.cookies
        assert this_device.get("/api/auth/me").status_code == 401  # they log in again with the new password
        assert other_device.get("/api/auth/me").status_code == 401  # signed out everywhere
        assert login(this_device, PASSWORD).status_code == 401
        assert login(this_device, NEW_PASSWORD).status_code == 200


def test_a_link_works_once_and_using_it_cancels_the_others(client, outbox):
    forgot(client)
    forgot(client)
    first, second = token_in(outbox.sent[0]), token_in(outbox.sent[1])
    assert reset(client, second).status_code == 200
    for token in (second, first):
        response = reset(client, token, password="yet another passphrase")
        assert response.status_code == 400
        assert "invalid or has expired" in response.json()["detail"]


def test_an_expired_link_is_refused(client, outbox):
    forgot(client)
    db.execute("UPDATE password_resets SET expires_at = %s", ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),))
    assert reset(client, token_in(outbox.sent[0])).status_code == 400
    assert login(client, PASSWORD).status_code == 200


def test_a_made_up_link_is_refused(client):
    assert reset(client, "x" * 43).status_code == 400


def test_the_new_password_must_follow_the_rules(client, outbox):
    forgot(client)
    assert reset(client, token_in(outbox.sent[0]), password="short").status_code == 422
    assert reset(client, token_in(outbox.sent[0])).status_code == 200  # the link still works after a rejected password


def test_both_endpoints_work_without_a_login_and_only_accept_small_requests(client):
    assert client.get("/api/auth/me").status_code == 401
    assert forgot(client).status_code == 202
    assert client.post("/api/auth/forgot", json={"email": "a@b.co", "pad": "x" * (2 * 1024 * 1024)}).status_code == 413


# --- code review regressions ----------------------------------------------------------------------

def test_links_use_https_when_served_behind_an_https_proxy(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRA_SECURE_COOKIES", "1")  # the setting used when TLS ends at the proxy
    sender = FakeSender()
    with TestClient(create_app(tmp_path, email_sender=sender)) as client:
        sign_in(client, email="ana@riverside.example")
        forgot(client)
    assert "https://testserver/reset-password#" in sender.sent[0].text


def test_old_request_records_and_finished_links_are_cleaned_up(client, outbox):
    forgot(client)
    long_ago = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    db.execute("UPDATE password_reset_requests SET at = %s", (long_ago,))
    db.execute("UPDATE password_resets SET expires_at = %s", (long_ago,))
    forgot(client)
    assert db.value("SELECT COUNT(*) FROM password_reset_requests") == 1  # only the new request
    assert db.value("SELECT COUNT(*) FROM password_resets") == 1  # the expired link is gone


# --- security review: reset links can't be pointed at another site -------------------------------

@pytest.mark.parametrize("host", ["testserver:x@evil.example", "localhost:@evil.example"])
def test_a_forged_host_header_cannot_redirect_the_reset_link(client, outbox, host):
    response = client.post("/api/auth/forgot", json={"email": "ana@riverside.example"}, headers={"Host": host})
    assert response.status_code == 400
    assert outbox.sent == []


def test_the_link_is_built_only_from_the_checked_host_and_port(client, outbox):
    forgot(client, Host="testserver:8000")
    parts = urlsplit(re.search(r"https?://\S+", outbox.sent[0].text).group(0))
    assert (parts.hostname, parts.port, parts.username) == ("testserver", 8000, None)
