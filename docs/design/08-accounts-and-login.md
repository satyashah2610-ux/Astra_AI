# Design 08: Accounts, companies and login

Status: implemented.

## Problem

The staff side has no login: anyone who can reach the API can see and change every agreement and file. To be usable by hundreds of users across many companies, staff need accounts, and each company's data must be invisible to every other company. Signers (clients) must still never need an account: their signing link stays their credential.

## Decisions taken with the product owner

- **Email + password** login. No sign-in-by-email links: without a verified domain, Resend's free tier only delivers to the account owner's address, so login must not depend on email.
- No domain will be bought for now, so nothing in login or signing depends on email delivery.

## High-level design

```
Sign up ──► company (organization) + first user ──► session cookie
Log in  ──► session cookie (HttpOnly, SameSite=Lax, Secure when served over HTTPS)
Every staff API call ──► session → user → organization ──► queries filtered by organization_id
Public signing API ──► unchanged: the link secret identifies one file (and so its organization)
```

- **Organizations.** Sign-up creates a company and its first user. Agreements and files belong to one organization; every staff query filters by it. Another company's ids return 404, not 403, so ids reveal nothing.
- **Sessions.** A random 256-bit token in an HttpOnly cookie; only its SHA-256 hash is stored (the same approach as signing links). 14-day lifetime, extended on use; logout deletes the session.
- **Passwords.** `hashlib.scrypt` (memory-hard, in the standard library, no new dependency) with a random 16-byte salt, compared in constant time. At least 10 characters; the same generic message for "wrong email" and "wrong password".
- **Cross-site protection.** The existing Origin / Sec-Fetch-Site check already blocks state-changing requests from other websites; SameSite=Lax adds a second layer for the session cookie.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Login method | Email + password | Email sign-in links | Works without email delivery (no domain). |
| Password hashing | scrypt (stdlib) | argon2 (extra package), bcrypt | Memory-hard and standard; no new dependency to vet. |
| Session storage | Server-side sessions table, hashed token in a cookie | JWT | Logout and expiry are immediate; nothing sensitive lives in the browser. |
| Tenant isolation | `organization_id` on agreements and files, checked in every query | Separate database per company | Simple, testable, standard for this size. |
| Roles, invitations, password reset | Left out for now | — | A company's first user can do everything. Invitations and reset need email delivery (a domain); planned once a domain exists. |
| Login rate limiting | Left out for now | Per-IP / per-email throttling | Recorded as a known gap; scrypt makes each guess slow. Add with hosting. |

## Low-level design

**Migration `0002_accounts.sql`:** `organizations(id, name, created_at)`, `users(id, organization_id, name, email, password_hash, created_at)` with a unique index on `lower(email)`, `sessions(token_hash, user_id, created_at, expires_at)`; `organization_id` added to `agreements` and `files` (not null), with agreement names unique per organization.

**API**

| Method & path | Body | Result |
|---|---|---|
| `POST /api/auth/signup` | company, name, email, password | 201 user + company, session cookie; 409 email taken; 422 invalid |
| `POST /api/auth/login` | email, password | 200 user, session cookie; 401 generic message |
| `POST /api/auth/logout` | — | 204, session deleted, cookie cleared |
| `GET /api/auth/me` | — | 200 user + company; 401 when not logged in |

Every other staff endpoint returns 401 without a valid session. Public: `/api/health`, `/api/sample-agreement.pdf`, `/api/signing/*`.

**Frontend:** a Login / Create account page shown when `/api/auth/me` is 401; the header shows the user's name and company with **Log out**; a 401 from any call returns to the login page. The signing page is unchanged and never asks signers to log in.

## Test plan (written before the code)

**Unit:** password hashing (verify, wrong password, unique salts, tampered hash), session token hashing, sign-up and login validation.

**Integration:** sign-up creates company + user + session; duplicate email (any case) is 409; login with wrong email or password gives the same 401; logout ends the session; expired sessions are refused; cookie flags; every staff endpoint is 401 without a session; **company A cannot list, read, change, send or download company B's agreements or files** (404); signers still sign without logging in; agreement names are unique per company only.

**Frontend:** login and sign-up forms (validation, errors, success), logout, a 401 returns to login.

**Browser:** create an account, then the full loop; a second company cannot see the first company's files.
