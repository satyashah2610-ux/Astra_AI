"""The email module: Resend requests, the file outbox, configuration, and the reset email itself."""
import json

import pytest

from app.email import Email, EmailError, OutboxSender, ResendSender, reset_email, sender_from_env


class FakeResponse:
    def __init__(self, status=200, body=b'{"id": "abc"}'):
        self.status, self.body = status, body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


def test_resend_request_has_the_right_endpoint_auth_and_body():
    captured = {}

    def opener(request, timeout):
        captured.update(url=request.full_url, method=request.get_method(), headers=dict(request.header_items()),
                        body=json.loads(request.data), timeout=timeout)
        return FakeResponse()

    sender = ResendSender("re_test_key", "Astra Sign <sign@mail.example.com>", opener=opener)
    sender.send(Email(to="ana@example.com", subject="Hello", html="<p>Hi</p>", text="Hi", reply_to="owner@example.com"))
    assert captured["url"] == "https://api.resend.com/emails" and captured["method"] == "POST"
    assert captured["headers"]["Authorization"] == "Bearer re_test_key"
    assert captured["body"] == {"from": "Astra Sign <sign@mail.example.com>", "to": ["ana@example.com"], "subject": "Hello",
                                "html": "<p>Hi</p>", "text": "Hi", "reply_to": "owner@example.com"}
    assert captured["timeout"] <= 15


def test_resend_failures_raise_without_leaking_the_key():
    import urllib.error

    def opener(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)

    with pytest.raises(EmailError) as error:
        ResendSender("re_secret_key", "Astra <a@b.com>", opener=opener).send(Email(to="x@y.com", subject="s", html="h", text="t"))
    assert "re_secret_key" not in str(error.value)


def test_outbox_writes_one_json_file_per_email(tmp_path):
    sender = OutboxSender(tmp_path / "outbox")
    sender.send(Email(to="ana@example.com", subject="One", html="<p>1</p>", text="1"))
    sender.send(Email(to="ana@example.com", subject="Two", html="<p>2</p>", text="2"))
    files = sorted((tmp_path / "outbox").glob("*.json"))
    assert [json.loads(f.read_text(encoding="utf-8"))["subject"] for f in files] == ["One", "Two"]


def test_sender_comes_from_the_environment(tmp_path, monkeypatch):
    for name in ("ASTRA_EMAIL_OUTBOX", "RESEND_API_KEY", "ASTRA_EMAIL_FROM"):
        monkeypatch.delenv(name, raising=False)
    assert sender_from_env() is None  # not configured: nothing is sent
    monkeypatch.setenv("RESEND_API_KEY", "re_x")
    assert sender_from_env() is None  # a key without a from-address isn't enough
    monkeypatch.setenv("ASTRA_EMAIL_FROM", "Astra <sign@mail.example.com>")
    assert isinstance(sender_from_env(), ResendSender)
    monkeypatch.setenv("ASTRA_EMAIL_OUTBOX", str(tmp_path))
    assert isinstance(sender_from_env(), OutboxSender)  # local development and browser tests


def test_reset_email_contains_the_link_and_escapes_the_name():
    email = reset_email("ana@example.com", "Ana <script>", "https://app.example.com/reset-password#tok")
    assert email.to == "ana@example.com" and "password" in email.subject.lower()
    assert "https://app.example.com/reset-password#tok" in email.html and "https://app.example.com/reset-password#tok" in email.text
    assert "<script>" not in email.html and "&lt;script&gt;" in email.html
    assert "1 hour" in email.text
