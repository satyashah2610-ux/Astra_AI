"""Sign-up, login, logout, sessions, and which endpoints need a login."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.main import create_app
from tests import db
from tests.staff import PASSWORD, StaffClient, sign_in
from tests.test_agreements import pdf_bytes


@pytest.fixture
def anonymous(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def signup(client, **overrides):
    body = {"company": "Riverside Builders", "name": "Ana Lopez", "email": "ana@riverside.example", "password": PASSWORD, **overrides}
    return client.post("/api/auth/signup", json=body)


# --- sign-up ------------------------------------------------------------------------------------------

def test_signup_creates_a_company_and_user_and_signs_them_in(anonymous):
    response = signup(anonymous)
    assert response.status_code == 201
    account = response.json()
    assert account["user"]["name"] == "Ana Lopez" and account["user"]["email"] == "ana@riverside.example"
    assert account["organization"]["name"] == "Riverside Builders"
    assert "password" not in str(account).lower()
    assert anonymous.get("/api/auth/me").json() == account
    stored = db.row("SELECT password_hash FROM users")["password_hash"]
    assert stored.startswith("scrypt$") and PASSWORD not in stored


def test_session_cookie_is_http_only_and_same_site(anonymous):
    response = signup(anonymous)
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower() and "Path=/" in cookie
    token = response.cookies[SESSION_COOKIE]
    assert token not in str(db.rows("SELECT * FROM sessions"))  # only a hash is stored


def test_email_is_unique_in_any_case(anonymous):
    assert signup(anonymous).status_code == 201
    response = signup(anonymous, email="ANA@Riverside.Example", company="Other Co")
    assert response.status_code == 409
    assert "already" in response.json()["detail"].lower()


@pytest.mark.parametrize("changes", [{"password": "short"}, {"email": "not-an-email"}, {"company": ""}, {"name": " "}, {"password": "x" * 201}, {"extra": 1}])
def test_invalid_signups_are_rejected(anonymous, changes):
    assert signup(anonymous, **changes).status_code == 422
    assert db.value("SELECT COUNT(*) FROM users") == 0


# --- login and logout -----------------------------------------------------------------------------

def test_login_with_the_right_password_in_any_email_case(anonymous):
    signup(anonymous)
    anonymous.post("/api/auth/logout")
    response = anonymous.post("/api/auth/login", json={"email": "Ana@Riverside.example", "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "ana@riverside.example"
    assert anonymous.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("email,password", [("ana@riverside.example", "wrong password!!"), ("nobody@riverside.example", PASSWORD)])
def test_wrong_email_or_password_get_the_same_answer(anonymous, email, password):
    signup(anonymous)
    anonymous.post("/api/auth/logout")
    response = anonymous.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json()["detail"] == "Email or password is incorrect."
    assert anonymous.get("/api/auth/me").status_code == 401


def test_logout_ends_the_session_on_the_server(anonymous):
    signup(anonymous)
    token = anonymous.cookies[SESSION_COOKIE]
    assert anonymous.post("/api/auth/logout").status_code == 204
    assert db.value("SELECT COUNT(*) FROM sessions") == 0
    anonymous.cookies.set(SESSION_COOKIE, token)  # an old copy of the cookie no longer works
    assert anonymous.get("/api/auth/me").status_code == 401


def test_expired_sessions_are_refused(anonymous):
    signup(anonymous)
    db.execute("UPDATE sessions SET expires_at = %s", ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),))
    assert anonymous.get("/api/auth/me").status_code == 401
    assert anonymous.get("/api/agreements").status_code == 401


def test_a_made_up_session_cookie_is_refused(anonymous):
    anonymous.cookies.set(SESSION_COOKIE, "made-up")
    assert anonymous.get("/api/auth/me").status_code == 401


# --- what needs a login ---------------------------------------------------------------------------

STAFF_ENDPOINTS = [("GET", "/api/agreements"), ("GET", "/api/agreements/x"), ("GET", "/api/agreements/x/pdf"), ("DELETE", "/api/agreements/x"),
                   ("PUT", "/api/agreements/x/marks"), ("GET", "/api/files"), ("POST", "/api/files"), ("GET", "/api/files/x"),
                   ("PATCH", "/api/files/x"), ("DELETE", "/api/files/x"), ("POST", "/api/files/x/send"), ("POST", "/api/files/x/link"),
                   ("GET", "/api/files/x/events"), ("GET", "/api/files/x/pdf"), ("GET", "/api/files/x/signed.pdf"), ("GET", "/api/auth/me")]


@pytest.mark.parametrize("method,path", STAFF_ENDPOINTS)
def test_staff_endpoints_need_a_login(anonymous, method, path):
    response = anonymous.request(method, path, json={} if method in ("POST", "PUT", "PATCH") else None)
    assert response.status_code == 401
    assert response.json()["detail"] == "Log in to continue."


def test_uploading_needs_a_login(anonymous):
    response = anonymous.post("/api/agreements", files={"file": ("A.pdf", pdf_bytes(), "application/pdf")})
    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/api/health", "/api/sample-agreement.pdf"])
def test_public_endpoints_stay_public(anonymous, path):
    assert anonymous.get(path).status_code == 200


def test_signers_never_need_an_account(tmp_path):
    from tests.signature_images import data_url
    from tests.test_files import create_file, prepared_agreement, token_from
    with StaffClient(create_app(tmp_path)) as staff:
        item = create_file(staff, prepared_agreement(staff)["id"]).json()
        token = token_from(staff.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    with TestClient(create_app(tmp_path)) as signer:
        auth = {"X-Signing-Token": token}
        assert signer.get("/api/signing", headers=auth).status_code == 200
        body = {"name": "Jordan Smith", "method": "drawn", "image": data_url(), "consent": True}
        assert signer.post("/api/signing/sign", headers=auth, json=body).status_code == 200
        assert signer.get("/api/signing/signed.pdf", headers=auth).status_code == 200


def test_sessions_survive_an_app_restart(tmp_path):
    with TestClient(create_app(tmp_path)) as first:
        sign_in(first)
        cookie = first.cookies[SESSION_COOKIE]
    with TestClient(create_app(tmp_path)) as restarted:
        restarted.cookies.set(SESSION_COOKIE, cookie)
        assert restarted.get("/api/auth/me").status_code == 200


# --- code review regressions ----------------------------------------------------------------------

def test_an_extended_session_also_extends_the_browser_cookie(anonymous):
    signup(anonymous)
    db.execute("UPDATE sessions SET expires_at = %s", ((datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),))
    response = anonymous.get("/api/auth/me")
    assert response.status_code == 200
    cookie = response.headers.get("set-cookie", "")
    assert cookie.startswith(f"{SESSION_COOKIE}=") and "Max-Age=1209600" in cookie  # 14 days again
    assert db.value("SELECT expires_at FROM sessions") > (datetime.now(timezone.utc) + timedelta(days=13)).isoformat()


def test_a_fresh_session_is_not_rewritten_on_every_request(anonymous):
    signup(anonymous)
    assert "set-cookie" not in anonymous.get("/api/auth/me").headers


def test_login_and_signup_only_accept_small_requests(anonymous):
    big = {"email": "ana@riverside.example", "password": "x" * (2 * 1024 * 1024)}
    assert anonymous.post("/api/auth/login", json=big).status_code == 413
    assert anonymous.post("/api/auth/signup", json={**big, "company": "C", "name": "N"}).status_code == 413


def test_logging_in_clears_that_users_expired_sessions(anonymous):
    signup(anonymous)
    db.execute("UPDATE sessions SET expires_at = %s", ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),))
    assert anonymous.post("/api/auth/login", json={"email": "ana@riverside.example", "password": PASSWORD}).status_code == 200
    assert db.value("SELECT COUNT(*) FROM sessions") == 1  # only the new one
