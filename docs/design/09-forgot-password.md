# Design 09: Forgot password (and the email module)

Status: implemented.

## Problem

Staff who forget their password are locked out. Now that `mail.signwithastra.com` is verified in Resend, the app can prove someone owns an email address by emailing them a link. The email-sending piece built here is reused later for signing emails.

## High-level design

```
Login page ── "Forgot password?" ──► POST /api/auth/forgot {email}
                                       │ always the same answer (never reveals whether the email exists)
                                       └─► if the account exists and limits allow: store sha256(token), email a link
Email ── "Choose a new password" ──► /reset-password#<token>   (secret in the fragment: never sent to servers or logs)
Reset page ── POST /api/auth/reset {token, password} ──► new password, link used up, every session signed out,
                                                         then signed in on this browser
```

- **One link, one hour, one use.** A random 256-bit secret; only its SHA-256 is stored. A successful reset uses up every outstanding reset link for that user.
- **Every other session is signed out** after a reset, in case someone else had access.
- **No account enumeration.** `/forgot` returns the same message for known and unknown emails, also when a limit is reached or sending fails.
- **Abuse limits.** At most 3 reset emails per account and 10 requests per IP address per hour. Beyond that, nothing is sent and the answer is unchanged.
- **The email module** is a small interface with three senders: Resend (production), a file outbox (local development and browser tests read emails from a folder), and none (email not configured; reset requests are accepted and logged, nothing is sent). Tests never send real email.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Reset method | Emailed one-time link | Security questions; admin reset | Standard and proves mailbox ownership. |
| Token location | URL fragment `#token`, posted in the body | `?token=` query | Fragments never reach server, proxy or analytics logs (same as signing links). |
| Link lifetime | 1 hour, single use | 24 hours | Short window if an inbox is compromised. |
| Link base URL | `ASTRA_APP_URL` if set (recommended in production), else the request's host **rebuilt from its parsed name and port** | The raw `Host` header; the browser's `Origin` | The Host header is accepted only as an exact `name[:port]` on the allow-list. A security review showed that taking the raw header let `localhost:x@evil.example` pass as `localhost` and point reset links at another site; parsing strictly and rebuilding the URL closes that. |
| Rate limits | Stored in PostgreSQL | In-memory counters | Survive restarts and work with more than one server process. |
| Email transport | Resend's HTTPS API via the standard library | Resend SDK | One small request; no new dependency to vet. |
| Sending failures | Logged; same answer to the user | Show an error | Keeps "does this email exist?" hidden; the user can try again. |

## Low-level design

**Migration `0003_password_resets.sql`:** `password_resets(token_hash PK, user_id → users, created_at, expires_at, used_at)`, `password_reset_requests(id, ip, email, at)` for the limits.

**API (public, small request bodies)**

| Method & path | Body | Result |
|---|---|---|
| `POST /api/auth/forgot` | email | 202 `{message}`: always the same |
| `POST /api/auth/reset` | token, password (≥ 10) | 200 account + session cookie; 400 invalid/expired/used link; 422 invalid password |

**Modules:** `app/email.py` (`Email`, `ResendSender`, `OutboxSender`, `sender_from_env`, `reset_email(name, link)`); `app/auth.py` gains the two endpoints. Frontend: `LoginPage` gets a "Forgot password?" mode; new `ResetPasswordPage` at `/reset-password#<token>`; `Root` routes it.

## Test plan (written before the code)

**Unit:** Resend request shape (endpoint, auth header, JSON body) with a fake transport; outbox writes one JSON file per email; no key means no sender; reset email escapes the user's name and contains the link.

**Integration:** a known email gets exactly one email with a working link while the database holds only the hash; an unknown email gets the same answer and no email; email case doesn't matter; resetting sets the new password, rejects the old one, uses the link up and signs out other sessions; expired, used and made-up links are refused; password rules apply; per-account and per-IP limits stop sending without changing the answer; a sending failure doesn't change the answer; the link uses `ASTRA_APP_URL` or the allow-listed host; both endpoints work without a login.

**Frontend:** the forgot form shows the same confirmation for any email; the reset page checks length and matching passwords, sends the token from the fragment, signs in on success, and explains an invalid link with a way to request a new one.

**Browser:** request a reset in the UI, open the emailed link from the outbox, set a new password, log in with it.
