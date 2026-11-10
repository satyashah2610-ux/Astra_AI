"""Staff accounts: passwords, sessions, and the /api/auth endpoints.

Signers never log in; their signing link is their credential (see signing.py).
"""
import base64
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response

from .database import utc_now
from .email import EmailError, reset_email
from .events import request_origin
from .links import app_url, secure_cookies
from .models import ForgotBody, LoginBody, ResetBody, SignupBody
from .storage import Storage

logger = logging.getLogger("astrasign.auth")

SESSION_COOKIE = "astra_session"
SESSION_DAYS = 14
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}  # memory-hard: about 16 MB and tens of milliseconds per guess
NOT_LOGGED_IN = "Log in to continue."
WRONG_LOGIN = "Email or password is incorrect."
RESET_SENT = "If an account exists for that email, we’ve sent a link to reset the password."
RESET_INVALID = "This reset link is invalid or has expired. Request a new one."
RESET_MINUTES = 60
RESETS_PER_EMAIL_PER_HOUR = 3
RESETS_PER_IP_PER_HOUR = 10


# --- passwords --------------------------------------------------------------------------------------

def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32, maxmem=64 * 1024 * 1024)


def hash_password(password: str) -> str:
    """'scrypt$n$r$p$salt$hash', base64 parts. A new random salt every time."""
    salt = secrets.token_bytes(16)
    key = _scrypt(password, salt, **SCRYPT)
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")  # noqa: E731
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${encode(salt)}${encode(key)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check; any damaged or foreign hash simply doesn't verify."""
    try:
        scheme, n, r, p, salt, key = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))  # noqa: E731
        expected = decode(key)
        return hmac.compare_digest(_scrypt(password, decode(salt), int(n), int(r), int(p)), expected)
    except (ValueError, TypeError):
        return False


_UNKNOWN_EMAIL_HASH = hash_password(secrets.token_urlsafe(16))  # compared against when the email doesn't exist


# --- sessions ---------------------------------------------------------------------------------------

def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def in_days(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def public_account(row) -> dict:
    return {"user": {"id": row["user_id"], "name": row["name"], "email": row["email"]},
            "organization": {"id": row["organization_id"], "name": row["organization_name"]}}


ACCOUNT_QUERY = """SELECT u.id AS user_id, u.name, u.email, u.organization_id, o.name AS organization_name
                   FROM users u JOIN organizations o ON o.id = u.organization_id"""


def create_auth(storage: Storage, email_sender=None):
    """The /api/auth router and the `current_user` dependency every staff endpoint uses."""
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    def set_session_cookie(request: Request, response: Response, token: str) -> None:
        response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
                            secure=secure_cookies(request), path="/")

    def start_session(db, request: Request, response: Response, user_id: str) -> None:
        token, now = new_session_token(), utc_now()
        db.execute("DELETE FROM sessions WHERE user_id = %s AND expires_at <= %s", (user_id, now))  # tidy this user's expired sessions
        db.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
                   (hash_session_token(token), user_id, now, in_days(SESSION_DAYS)))
        set_session_cookie(request, response, token)

    def current_user(request: Request, response: Response) -> dict:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            raise HTTPException(401, NOT_LOGGED_IN)
        token_hash = hash_session_token(token)
        with storage.database() as db:
            row = db.execute("""SELECT u.id AS user_id, u.name, u.email, u.organization_id, o.name AS organization_name, s.expires_at
                                FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.organization_id
                                WHERE s.token_hash = %s""", (token_hash,)).fetchone()  # one round trip per request
            if row is None or row["expires_at"] <= utc_now():
                raise HTTPException(401, NOT_LOGGED_IN)
            if row["expires_at"] < in_days(SESSION_DAYS - 1):  # slide the expiry at most once a day
                db.execute("UPDATE sessions SET expires_at = %s WHERE token_hash = %s", (in_days(SESSION_DAYS), token_hash))
                set_session_cookie(request, response, token)  # the browser's cookie must slide with the server's expiry
        return dict(row)

    @router.post("/signup", status_code=201)
    def signup(body: SignupBody, request: Request, response: Response):
        organization_id, user_id, now = str(uuid4()), str(uuid4()), utc_now()
        password_hash = hash_password(body.password)
        try:
            with storage.database() as db:
                db.execute("INSERT INTO organizations (id, name, created_at) VALUES (%s, %s, %s)", (organization_id, body.company, now))
                db.execute("INSERT INTO users (id, organization_id, name, email, password_hash, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                           (user_id, organization_id, body.name, body.email.lower(), password_hash, now))
                start_session(db, request, response, user_id)
                account = db.execute(ACCOUNT_QUERY + " WHERE u.id = %s", (user_id,)).fetchone()
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(409, "An account with this email already exists. Log in instead.") from exc
        logger.info("Account created organization=%s user=%s", organization_id, user_id)
        return public_account(account)

    @router.post("/login")
    def login(body: LoginBody, request: Request, response: Response):
        with storage.database() as db:
            user = db.execute("SELECT id, password_hash FROM users WHERE lower(email) = lower(%s)", (body.email,)).fetchone()
        # scrypt runs with no pooled connection held, so slow guesses can't exhaust the pool.
        valid = verify_password(body.password, user["password_hash"] if user else _UNKNOWN_EMAIL_HASH)
        if user is None or not valid:  # same work and same answer whether or not the email exists
            raise HTTPException(401, WRONG_LOGIN)
        with storage.database() as db:
            start_session(db, request, response, user["id"])
            account = db.execute(ACCOUNT_QUERY + " WHERE u.id = %s", (user["id"],)).fetchone()
        return public_account(account)

    @router.post("/logout", status_code=204)
    def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            with storage.database() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = %s", (hash_session_token(token),))
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
        return response

    @router.get("/me")
    def me(account: dict = Depends(current_user)):
        return public_account(account)

    def deliver(email) -> None:
        """Runs after the response is sent, so a known email isn't slower to answer than an unknown one."""
        if email_sender is None:
            logger.warning("Password reset requested but email is not configured (RESEND_API_KEY / ASTRA_EMAIL_FROM)")
            return
        try:
            email_sender.send(email)
        except EmailError as exc:
            logger.warning("Password reset email could not be sent: %s", exc)

    @router.post("/forgot", status_code=202)
    def forgot(body: ForgotBody, request: Request, background: BackgroundTasks):
        email, ip, now = body.email.lower(), request_origin(request)[0], utc_now()
        base_url = app_url(request)  # before any lookup: a bad host fails the same way for every email
        hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with storage.database() as db:
            db.execute("DELETE FROM password_reset_requests WHERE at <= %s", (hour_ago,))  # only the last hour is ever counted
            from_ip = db.execute("SELECT COUNT(*) FROM password_reset_requests WHERE ip = %s AND at > %s", (ip, hour_ago)).fetchone()[0]
            for_email = db.execute("SELECT COUNT(*) FROM password_reset_requests WHERE email = %s AND at > %s", (email, hour_ago)).fetchone()[0]
            db.execute("INSERT INTO password_reset_requests (ip, email, at) VALUES (%s, %s, %s)", (ip, email, now))
            user = db.execute("SELECT id, name, email FROM users WHERE lower(email) = %s", (email,)).fetchone()
            if user and from_ip < RESETS_PER_IP_PER_HOUR and for_email < RESETS_PER_EMAIL_PER_HOUR:
                token = new_session_token()
                expires = (datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)).isoformat()
                db.execute("DELETE FROM password_resets WHERE user_id = %s AND (used_at IS NOT NULL OR expires_at <= %s)",
                           (user["id"], now))  # dead links are never needed again
                db.execute("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
                           (hash_session_token(token), user["id"], now, expires))
                background.add_task(deliver, reset_email(user["email"], user["name"], f"{base_url}/reset-password#{token}"))
                logger.info("Password reset link issued user=%s", user["id"])
        return {"message": RESET_SENT}  # identical for every email, sent or not

    @router.post("/reset")
    def reset(body: ResetBody, request: Request, response: Response):
        password_hash = hash_password(body.password)  # hashed before taking a connection
        now = utc_now()
        with storage.database() as db:
            used = db.execute("""UPDATE password_resets SET used_at = %s
                                 WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s RETURNING user_id""",
                              (now, hash_session_token(body.token), now)).fetchone()  # atomic: a link works once
            if used is None:
                raise HTTPException(400, RESET_INVALID)
            user_id = used["user_id"]
            db.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
            db.execute("UPDATE password_resets SET used_at = %s WHERE user_id = %s AND used_at IS NULL", (now, user_id))
            db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))  # sign out everywhere else
            start_session(db, request, response, user_id)
            account = db.execute(ACCOUNT_QUERY + " WHERE u.id = %s", (user_id,)).fetchone()
        logger.info("Password reset completed user=%s", user_id)
        return public_account(account)

    return router, current_user
