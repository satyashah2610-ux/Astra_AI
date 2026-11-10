# Design 12: Login protection (failed-login limits, email confirmation)

Status: implemented.

## Problem

Anyone could guess passwords without limit, and anyone could sign up with an address they don't own and send signing emails from our domain under that name.

## High-level design

```
Sign-up ──► account created, unconfirmed ──► email: /confirm-email#<token> (24 h, works once)
Confirm page ── POST /api/auth/confirm ──► confirmed ──► "Email confirmed. Log in."
Login ── too many recent failures? ──► 429 (before any password check)
      ── wrong email or password ──► 401, failure recorded
      ── right password, unconfirmed ──► 403 "Confirm your email first" + Send a new link
      ── right password, confirmed ──► session
```

| Decision | Chosen | Why |
|---|---|---|
| Lock rule | 5 failures per email or 20 per network address in 15 minutes; locked until older failures leave the window, even for the right password | Stops guessing; 5 is generous for typos; a correct password during a lock would otherwise let guessing continue. |
| No account enumeration | Failures are counted for any email, existing or not; the same 429 for both | The lock doesn't reveal which emails have accounts. |
| Recovery | A password reset clears that email's failures (and confirms the email) | The reset link proves ownership of the inbox. |
| Confirmation gate | Can't log in until confirmed | Simple and complete: nothing can be sent from an unconfirmed address. |
| Unconfirmed login | 403 only after the right password; wrong passwords stay 401 | Reveals "unconfirmed" only to someone who knows the password. |
| Resend | `POST /api/auth/resend-confirmation` always answers 202 the same; at most 3 links per account per hour | Same no-enumeration and abuse limits as forgot password. |
| Existing accounts | Marked confirmed by the migration | They were created before this rule. |
| No email configured (local development) | New accounts are confirmed at once (logged) | Otherwise nobody could ever log in without an email provider. |

Left for later: an unconfirmed sign-up keeps its email reserved (someone else's sign-up with it gets 409); clearing expired unconfirmed accounts needs a cleanup job.

## Low-level design

**Migration `0006_login_protection.sql`:** `users.email_confirmed_at TEXT` (existing rows set to their `created_at`); `email_confirmations (token_hash PK, user_id → users ON DELETE CASCADE, created_at, expires_at, used_at)`; `login_failures (id, email, ip, at)` with indexes on `(email, at)` and `(ip, at)`.

**API:** `POST /api/auth/signup` (message says to check the email when a link was sent); `POST /api/auth/login` (429 / 403 as above); `POST /api/auth/confirm {token}` (200, or 400 for invalid/expired/used); `POST /api/auth/resend-confirmation {email}` (202). `POST /api/auth/reset` also confirms the email and clears failures.

**Frontend:** `/confirm-email#<token>` page confirms on open and links to log in; the login page shows the 429/403 messages, with **Send a new confirmation link** for 403.

## Tests (written first)

Integration: locks after 5 failures for that email only, for unknown emails too, and after 20 per address; old failures expire; a reset clears the lock; sign-up sends one confirmation link; unconfirmed login is 403 only with the right password; the link confirms once; expired/used/made-up links refused; resend is generic and limited; without email configured accounts are confirmed at once; a reset confirms the email. Frontend: confirm page, login messages and resend. Browser: sign up, confirm from the outbox email, log in.
