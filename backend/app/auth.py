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

from .database import utc_now, write_lock
from .email import EmailError, confirmation_email, reset_email
from .events import request_origin
from .links import app_url, secure_cookies
from .signed_documents import remove_signed_pdf
from .models import ConfirmBody, ConfirmCheckBody, DeleteAccountBody, ForgotBody, LoginBody, ResetBody, SignupBody
from .storage import Storage

logger = logging.getLogger("astrasign.auth")

SESSION_COOKIE = "astra_session"
SESSION_DAYS = 14
IDLE_MINUTES = 12  # the browser logs out after 10 idle minutes; the server ends sessions it didn't close (activity is
                   # reported about once a minute and saved every 30 s, so 2 more minutes never cut an active user)
TOUCH_SECONDS = 30  # how often activity is written, at most
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}  # memory-hard: about 16 MB and tens of milliseconds per guess
NOT_LOGGED_IN = "Log in to continue."
WRONG_LOGIN = "Email or password is incorrect."
RESET_SENT = "If an account exists for that email, we’ve sent a link to reset the password."
RESET_INVALID = "This reset link is invalid or has expired. Request a new one."
ACCOUNT_CREATED = "Account created. Log in to continue."
CHECK_EMAIL = "Account created. Check your email for a link to confirm your address, then log in."
NOT_CONFIRMED = "Confirm your email address first: use the link we sent you, or send a new one."
EMAIL_CONFIRMED = "Email confirmed."
CONFIRM_INVALID = "This confirmation link is invalid or has expired. Log in to send a new one."
CONFIRM_SENT = "If that account still needs confirming, we’ve sent a new link."
LOCKED = "Too many failed attempts. Wait 15 minutes, or reset your password."
NETWORK_LOCKED = "Too many failed attempts from this network. Wait 15 minutes and try again."
WRONG_PASSWORD = "That password doesn’t match this account."
CHECK_FAILED = "Couldn’t check the password right now. Try again in a moment."
PASSWORD_RESET = "Your password has been reset. Log in with your new password."
RESET_MINUTES = 60
RESETS_PER_EMAIL_PER_HOUR = 3
RESETS_PER_IP_PER_HOUR = 10
CONFIRM_HOURS = 24
CONFIRMATIONS_PER_HOUR = 3  # links per account, the sign-up one included
FAILURE_MINUTES = 15  # failed logins are counted over this window
FAILURES_PER_EMAIL = 5
FAILURES_PER_IP = 20


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
    """Constant-time check; any damaged or foreign hash simply doesn't verify. A failure while checking (e.g. out of
    memory) is raised, not reported as a wrong password."""
    try:
        scheme, n, r, p, salt, key = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))  # noqa: E731
        expected, salt_bytes, n, r, p = decode(key), decode(salt), int(n), int(r), int(p)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(_scrypt(password, salt_bytes, n, r, p), expected)


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
        idle_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=IDLE_MINUTES)).isoformat()
        db.execute("DELETE FROM sessions WHERE user_id = %s AND (expires_at <= %s OR last_seen_at <= %s)",
                   (user_id, now, idle_cutoff))  # tidy this user's expired and abandoned sessions
        db.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (%s, %s, %s, %s, %s)",
                   (hash_session_token(token), user_id, now, in_days(SESSION_DAYS), now))
        set_session_cookie(request, response, token)

    def current_user(request: Request, response: Response) -> dict:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            raise HTTPException(401, NOT_LOGGED_IN)
        token_hash = hash_session_token(token)
        with storage.database() as db:
            row = db.execute("""SELECT u.id AS user_id, u.name, u.email, u.organization_id, o.name AS organization_name,
                                       s.expires_at, s.last_seen_at
                                FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.organization_id
                                WHERE s.token_hash = %s""", (token_hash,)).fetchone()  # one round trip per request
            now = datetime.now(timezone.utc)
            if row is None or row["expires_at"] <= now.isoformat():
                raise HTTPException(401, NOT_LOGGED_IN)
            idle = row["last_seen_at"] <= (now - timedelta(minutes=IDLE_MINUTES)).isoformat()
            if idle:  # unused for 12 minutes: ended (deleted here, refused below, after the deletion is committed)
                db.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash,))
            elif row["last_seen_at"] <= (now - timedelta(seconds=TOUCH_SECONDS)).isoformat():  # not a write per request
                db.execute("UPDATE sessions SET last_seen_at = %s WHERE token_hash = %s", (now.isoformat(), token_hash))
            if not idle and row["expires_at"] < in_days(SESSION_DAYS - 1):  # slide the expiry at most once a day
                db.execute("UPDATE sessions SET expires_at = %s WHERE token_hash = %s", (in_days(SESSION_DAYS), token_hash))
                set_session_cookie(request, response, token)  # the browser's cookie must slide with the server's expiry
        if idle:
            raise HTTPException(401, NOT_LOGGED_IN)
        return dict(row)

    def issue_confirmation(db, user_id: str, email: str, name: str, base_url: str, background: BackgroundTasks) -> None:
        token, now = new_session_token(), utc_now()
        expires = (datetime.now(timezone.utc) + timedelta(hours=CONFIRM_HOURS)).isoformat()
        db.execute("INSERT INTO email_confirmations (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
                   (hash_session_token(token), user_id, now, expires))
        background.add_task(deliver, confirmation_email(email, name, f"{base_url}/confirm-email#{token}"))

    @router.post("/signup", status_code=201)
    def signup(body: SignupBody, request: Request, background: BackgroundTasks):
        organization_id, user_id, now = str(uuid4()), str(uuid4()), utc_now()
        base_url = app_url(request)  # before any change: a refused host can't leave an account whose link was never sent
        password_hash = hash_password(body.password)
        must_confirm = email_sender is not None  # without email (local development) nobody could ever confirm
        try:
            with storage.database() as db:
                db.execute("INSERT INTO organizations (id, name, created_at) VALUES (%s, %s, %s)", (organization_id, body.company, now))
                db.execute("""INSERT INTO users (id, organization_id, name, email, password_hash, created_at, email_confirmed_at)
                              VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                           (user_id, organization_id, body.name, body.email.lower(), password_hash, now, None if must_confirm else now))
                if must_confirm:
                    issue_confirmation(db, user_id, body.email.lower(), body.name, base_url, background)
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(409, "An account with this email already exists. Log in instead.") from exc
        logger.info("Account created organization=%s user=%s confirmed=%s", organization_id, user_id, not must_confirm)
        return {"message": CHECK_EMAIL if must_confirm else ACCOUNT_CREATED}  # no session: they log in next

    def begin_attempt(db, email: str, ip: str | None) -> int:
        """Count this password attempt as a failure up front (under a per-email and per-address lock), so attempts
        running in parallel can't all pass the limit before any is recorded. A correct password clears it again."""
        window = (datetime.now(timezone.utc) - timedelta(minutes=FAILURE_MINUTES)).isoformat()
        db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"login-email:{email}",))
        if ip:
            db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"login-ip:{ip}",))
        db.execute("DELETE FROM login_failures WHERE email = %s AND at <= %s", (email, window))  # only the window counts
        if db.execute("SELECT COUNT(*) FROM login_failures WHERE email = %s", (email,)).fetchone()[0] >= FAILURES_PER_EMAIL:
            raise HTTPException(429, LOCKED)  # even the right password waits: no guessing on
        if ip:
            db.execute("DELETE FROM login_failures WHERE ip = %s AND at <= %s", (ip, window))
            if db.execute("SELECT COUNT(*) FROM login_failures WHERE ip = %s", (ip,)).fetchone()[0] >= FAILURES_PER_IP:
                raise HTTPException(429, NETWORK_LOCKED)  # a password reset wouldn't help with this one
        return db.execute("INSERT INTO login_failures (email, ip, at) VALUES (%s, %s, %s) RETURNING id",
                          (email, ip, utc_now())).fetchone()[0]

    def check_password(attempt: int, password: str, stored: str) -> bool:
        """The password check for a recorded attempt. If checking itself fails (e.g. out of memory), the attempt is
        withdrawn, so it isn't held against the user, and the answer is "try again", never "wrong password"."""
        try:
            return verify_password(password, stored)
        except Exception:
            logger.exception("Password check failed")
            with storage.database() as db:
                db.execute("DELETE FROM login_failures WHERE id = %s", (attempt,))
            raise HTTPException(503, CHECK_FAILED) from None

    def attempt_succeeded(db, email: str) -> None:
        db.execute("DELETE FROM login_failures WHERE email = %s", (email,))  # the right password: earlier typos stop counting

    @router.post("/login")
    def login(body: LoginBody, request: Request, response: Response):
        email, ip = body.email.lower(), request_origin(request)[0]
        with storage.database() as db:
            attempt = begin_attempt(db, email, ip)
            user = db.execute("SELECT id, password_hash, email_confirmed_at FROM users WHERE lower(email) = %s", (email,)).fetchone()
        # scrypt runs with no pooled connection held, so slow guesses can't exhaust the pool.
        valid = check_password(attempt, body.password, user["password_hash"] if user else _UNKNOWN_EMAIL_HASH)
        if user is None or not valid:  # same work and same answer whether or not the email exists; the failure stays recorded
            raise HTTPException(401, WRONG_LOGIN)
        with storage.database() as db:
            attempt_succeeded(db, email)
        if user["email_confirmed_at"] is None:  # only someone who knows the password learns this
            raise HTTPException(403, NOT_CONFIRMED)
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

    @router.delete("/account", status_code=204)
    def delete_account(body: DeleteAccountBody, account: dict = Depends(current_user)):
        """Deletes the whole company (one login per company): every row it owns, then its stored PDFs and images."""
        organization_id = account["organization_id"]
        with storage.database() as db:
            write_lock(db)  # no file can be created or signed for this company halfway through
            agreement_ids = [row["id"] for row in db.execute("SELECT id FROM agreements WHERE organization_id = %s", (organization_id,))]
            file_ids = [row["id"] for row in db.execute("SELECT id FROM files WHERE organization_id = %s", (organization_id,))]
            for table in ("signer_items", "signatures", "file_events"):  # no foreign keys on these
                db.execute(f"DELETE FROM {table} WHERE file_id = ANY(%s)", (file_ids,))
            db.execute("DELETE FROM password_reset_requests WHERE email = %s", (account["email"].lower(),))  # no foreign key
            # Cascades to users, sessions, reset links, agreements, files and signing-email counts.
            db.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
        stored = [storage.template_pdf(identifier) for identifier in agreement_ids]
        for identifier in file_ids:
            stored += [storage.document_pdf(identifier), storage.signature_png(identifier), storage.initials_png(identifier)]
        # After commit: the data is already unreachable, so a file that can't be removed is logged, not undone.
        for path in stored:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove a stored file of a deleted account: %s", path.name)
        for identifier in file_ids:
            try:
                remove_signed_pdf(storage, identifier)  # waits for a signed-PDF build in progress, then removes it
            except OSError:
                logger.warning("Could not remove the signed PDF of a deleted account's file %s", identifier)
        logger.info("Account deleted organization=%s files=%s agreements=%s", organization_id, len(file_ids), len(agreement_ids))
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
        return response

    @router.get("/me")
    def me(account: dict = Depends(current_user)):
        return public_account(account)

    def deliver(email) -> None:
        """Runs after the response is sent, so a known email isn't slower to answer than an unknown one."""
        if email_sender is None:
            logger.warning("An email was requested but email is not configured (RESEND_API_KEY / ASTRA_EMAIL_FROM)")
            return
        try:
            email_sender.send(email)
        except EmailError as exc:
            logger.warning("Email could not be sent (%s): %s", email.subject, exc)

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

    @router.post("/confirm/check")
    def confirm_check(body: ConfirmCheckBody):
        """Whether a confirmation link can still be used, so the page can send a used or expired one to the login page
        without asking for a password. Uses nothing up; the link itself is the only secret."""
        with storage.database() as db:
            row = db.execute("SELECT 1 FROM email_confirmations WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s",
                             (hash_session_token(body.token), utc_now())).fetchone()
        return {"valid": row is not None}

    @router.post("/confirm")
    def confirm_email(body: ConfirmBody, request: Request, response: Response):
        """Confirming needs the account's password too: someone who signed up with another person's address
        can't get that person to confirm the account with one click (and be logged in to it). Success logs in."""
        token_hash, ip = hash_session_token(body.token), request_origin(request)[0]
        with storage.database() as db:
            user = db.execute("""SELECT u.id, u.email, u.password_hash FROM email_confirmations c JOIN users u ON u.id = c.user_id
                                 WHERE c.token_hash = %s AND c.used_at IS NULL AND c.expires_at > %s""",
                              (token_hash, utc_now())).fetchone()
            if user is None:
                raise HTTPException(400, CONFIRM_INVALID)
            attempt = begin_attempt(db, user["email"], ip)  # wrong passwords here count toward the same lock as logins
        if not check_password(attempt, body.password, user["password_hash"]):
            raise HTTPException(401, WRONG_PASSWORD)
        now = utc_now()
        with storage.database() as db:
            attempt_succeeded(db, user["email"])
            used = db.execute("""UPDATE email_confirmations SET used_at = %s
                                 WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s RETURNING user_id""",
                              (now, token_hash, now)).fetchone()  # atomic: a link works once
            if used is None:
                raise HTTPException(400, CONFIRM_INVALID)
            db.execute("UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, %s) WHERE id = %s", (now, used["user_id"]))
            start_session(db, request, response, used["user_id"])  # the first login comes with confirming
        logger.info("Email confirmed user=%s", used["user_id"])
        return {"message": EMAIL_CONFIRMED}

    @router.post("/resend-confirmation", status_code=202)
    def resend_confirmation(body: ForgotBody, request: Request, background: BackgroundTasks):
        base_url = app_url(request)  # before any lookup: a bad host fails the same way for every email
        hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with storage.database() as db:
            user = db.execute("SELECT id, name, email FROM users WHERE lower(email) = %s AND email_confirmed_at IS NULL",
                              (body.email.lower(),)).fetchone()
            if user and email_sender is not None:
                recent = db.execute("SELECT COUNT(*) FROM email_confirmations WHERE user_id = %s AND created_at > %s",
                                    (user["id"], hour_ago)).fetchone()[0]
                if recent < CONFIRMATIONS_PER_HOUR:
                    issue_confirmation(db, user["id"], user["email"], user["name"], base_url, background)
        return {"message": CONFIRM_SENT}  # identical for every email, sent or not

    @router.post("/reset")
    def reset(body: ResetBody):
        password_hash = hash_password(body.password)  # hashed before taking a connection
        now = utc_now()
        with storage.database() as db:
            used = db.execute("""UPDATE password_resets SET used_at = %s
                                 WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s RETURNING user_id""",
                              (now, hash_session_token(body.token), now)).fetchone()  # atomic: a link works once
            if used is None:
                raise HTTPException(400, RESET_INVALID)
            user_id = used["user_id"]
            email = db.execute("""UPDATE users SET password_hash = %s, email_confirmed_at = COALESCE(email_confirmed_at, %s)
                                  WHERE id = %s RETURNING email""", (password_hash, now, user_id)).fetchone()["email"]
            db.execute("DELETE FROM login_failures WHERE email = %s", (email,))  # the link proved ownership: unlock
            db.execute("UPDATE password_resets SET used_at = %s WHERE user_id = %s AND used_at IS NULL", (now, user_id))
            db.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))  # signed out everywhere
        logger.info("Password reset completed user=%s", user_id)
        return {"message": PASSWORD_RESET}  # no session: they log in with the new password

    return router, current_user
