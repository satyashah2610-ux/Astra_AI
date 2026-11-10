"""The visitor's real address behind the host's proxies, used for login limits and the signing audit trail.

Each trusted proxy appends the address it received the request from to X-Forwarded-For, so with N trusted
proxies the visitor is the Nth entry from the right; anything further left was written by the visitor."""
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.events import client_ip
from app.main import create_app
from tests.staff import PASSWORD, StaffClient


def request(peer="10.0.0.9", forwarded=None):
    lines = forwarded if isinstance(forwarded, list) else [forwarded] if forwarded is not None else []
    headers = [(b"x-forwarded-for", line.encode()) for line in lines]
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_without_trusted_proxies_the_header_is_ignored(monkeypatch):
    monkeypatch.delenv("ASTRA_TRUSTED_PROXIES", raising=False)
    assert client_ip(request(forwarded="203.0.113.5")) == "10.0.0.9"  # a visitor can't pick their own address


@pytest.mark.parametrize("hops, forwarded, expected", [
    ("1", "203.0.113.5", "203.0.113.5"),
    ("1", "198.51.100.1, 203.0.113.5", "203.0.113.5"),  # the left entry was written by the visitor
    ("2", "198.51.100.1, 203.0.113.5, 10.1.0.1", "203.0.113.5"),
    ("1", " 2001:db8::1 ", "2001:db8::1"),
    ("1", "198.51.100.1, 203.0.113.5:51234", "203.0.113.5"),  # some proxies add the port
    ("1", "[2001:db8::1]:443", "2001:db8::1"),
    ("1", ["198.51.100.1", "203.0.113.5"], "203.0.113.5"),  # a proxy that adds its own header line: the last line is the proxy's
])
def test_trusted_proxies_give_the_visitors_address(monkeypatch, hops, forwarded, expected):
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", hops)
    assert client_ip(request(forwarded=forwarded)) == expected


@pytest.mark.parametrize("forwarded", [None, "", "not-an-address", "203.0.113.5"])
def test_a_missing_or_short_header_falls_back_to_the_connection(monkeypatch, forwarded):
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", "2")  # "203.0.113.5" is one entry: fewer than the proxies in front
    assert client_ip(request(forwarded=forwarded)) == "10.0.0.9"


@pytest.mark.parametrize("forwarded", ["198.51.100.1, garbage", "203.0.113.5,", "198.51.100.1, 999.1.1.1"])
def test_a_bad_entry_where_the_visitor_should_be_falls_back_to_the_connection(monkeypatch, forwarded):
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", "1")
    assert client_ip(request(forwarded=forwarded)) == "10.0.0.9"


def test_the_connection_address_is_written_the_same_way_as_header_addresses(monkeypatch):
    monkeypatch.delenv("ASTRA_TRUSTED_PROXIES", raising=False)
    assert client_ip(request(peer="2001:0db8:0000::0001")) == "2001:db8::1"  # one visitor, one counting bucket


def test_an_unset_setting_trusts_no_proxy(monkeypatch):
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", "")
    assert client_ip(request(forwarded="203.0.113.5")) == "10.0.0.9"


@pytest.mark.parametrize("value", ["abc", "-1", "1x", "²", "1.5", "10"])
def test_a_mistyped_setting_stops_the_app_from_starting(tmp_path, monkeypatch, value):
    """Silently trusting no proxy would bring back the lockout this setting exists to prevent."""
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", value)
    with pytest.raises(RuntimeError, match="ASTRA_TRUSTED_PROXIES"):
        create_app(tmp_path)


def test_behind_a_proxy_one_visitors_failures_dont_lock_out_everyone(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", "1")
    with TestClient(create_app(tmp_path)) as client:  # every request arrives from the same proxy
        client.post("/api/auth/signup", json={"company": "R", "name": "Ana", "email": "ana@r.example", "password": PASSWORD})
        for n in range(20):
            client.post("/api/auth/login", json={"email": f"guess{n}@r.example", "password": "wrong password!!"},
                        headers={"X-Forwarded-For": "198.51.100.66"})
        locked = client.post("/api/auth/login", json={"email": "ana@r.example", "password": PASSWORD},
                             headers={"X-Forwarded-For": "198.51.100.66"})
        assert locked.status_code == 429  # the guesser's own address is locked
        assert client.post("/api/auth/login", json={"email": "ana@r.example", "password": PASSWORD},
                           headers={"X-Forwarded-For": "203.0.113.5"}).status_code == 200  # everyone else isn't


def test_the_audit_trail_records_the_signers_real_address(tmp_path, monkeypatch):
    from tests.test_files import create_file, prepared_agreement, token_from
    monkeypatch.setenv("ASTRA_TRUSTED_PROXIES", "1")
    with StaffClient(create_app(tmp_path)) as client:
        item = create_file(client, prepared_agreement(client)["id"]).json()
        token = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
        client.post("/api/signing/view", headers={"X-Signing-Token": token, "X-Forwarded-For": "198.51.100.1, 203.0.113.5"})
        viewed = [e for e in client.get(f"/api/files/{item['id']}/events").json() if e["type"] == "viewed"]
        assert viewed[0]["ip"] == "203.0.113.5"
