import pytest

from app.auth import hash_password, hash_session_token, new_session_token, verify_password


def test_a_password_verifies_against_its_own_hash_only():
    stored = hash_password("correct horse battery staple")
    assert stored.startswith("scrypt$")
    assert "correct horse" not in stored
    assert verify_password("correct horse battery staple", stored)
    assert not verify_password("correct horse battery stapler", stored)
    assert not verify_password("", stored)


def test_each_hash_uses_a_new_salt():
    assert hash_password("same password here") != hash_password("same password here")


@pytest.mark.parametrize("stored", ["", "plain", "scrypt$1$2", "scrypt$16384$8$1$not-base64!$x", "bcrypt$whatever", None])
def test_damaged_or_foreign_hashes_never_verify(stored):
    assert not verify_password("anything at all", stored)


def test_session_tokens_are_long_random_and_stored_only_as_hashes():
    tokens = {new_session_token() for _ in range(100)}
    assert len(tokens) == 100 and all(len(token) >= 43 for token in tokens)
    token = next(iter(tokens))
    assert hash_session_token(token) == hash_session_token(token) != token
    assert len(hash_session_token(token)) == 64


def test_a_failure_inside_the_password_check_is_not_a_wrong_password(tmp_path, monkeypatch):
    """Out of memory (or any error) while checking must not answer 401 "wrong password", nor count toward the lock."""
    from fastapi.testclient import TestClient
    from app import auth
    from app.main import create_app
    from tests import db
    from tests.staff import PASSWORD, sign_in
    with TestClient(create_app(tmp_path), raise_server_exceptions=False) as client:
        sign_in(client, email="ana@riverside.example")

        def broken(*args, **kwargs):
            raise ValueError("[digital envelope routines] memory limit exceeded")
        monkeypatch.setattr(auth, "_scrypt", broken)
        response = client.post("/api/auth/login", json={"email": "ana@riverside.example", "password": PASSWORD})
        assert response.status_code == 503 and "Try again" in response.json()["detail"]
        assert db.value("SELECT COUNT(*) FROM login_failures") == 0  # not held against the user
