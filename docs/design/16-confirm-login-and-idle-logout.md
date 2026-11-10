# Design 16: Logged in by the confirmation link; logged out after 10 idle minutes

Status: implemented.

## Requested

1. After sign-up, the confirmation link logs the user straight in the first time; a used (or expired) link only leads to the login page.
2. A user inactive for 10 minutes is logged out.

## Design

```
/confirm-email#t ──► POST /api/auth/confirm/check {token} ──► not usable ──► login page: "This confirmation link has already been used or has expired."
                                                       └──► usable ──► password once ──► POST /api/auth/confirm ──► session cookie ──► the app
```

| Decision | Chosen | Why |
|---|---|---|
| Password on the confirm page | Kept, asked once (product owner's choice) | Without it, someone who signs up with your address could get you logged in to their account with one click. |
| Used-link check | `POST /api/auth/confirm/check` answers `{valid}` and uses nothing up | The page can send a used link to the login page without asking for a password; the 256-bit link is the only secret. |
| Idle limit | The browser logs out after exactly 10 minutes; the server ends sessions unused for 12 (`sessions.last_seen_at`) | The browser alone could be bypassed (a stolen cookie, a sleeping laptop); activity reaches the server about once a minute and is saved every 30 s, so the server's 2 extra minutes never cut off an active user. |
| Activity | Clicks, keys, scrolls, touches and mouse moves in any tab of the app (shared through localStorage); while active, the page tells the server at most once a minute | Editing a template without saving never times out; another open tab doesn't log you out. |
| Writes | `last_seen_at` written at most every 30 seconds | No write on every request. |

Left for later: a "you'll be logged out in a minute" warning (unsaved template changes are lost at the 10-minute logout).

## Tests (written first)

Integration: confirming logs in; the server never ends a session the browser still counts as active (11 minutes), but does at 12; logging in tidies abandoned sessions; a wrong password doesn't; the check doesn't use the link; used/expired/made-up links aren't usable; a used link never logs in again; 10 idle minutes end the session (deleted); use restarts the clock; at most one write per 30 seconds; a new login starts fresh. Frontend: confirm page (password once then the app; used link to the login page with the reason; link used meanwhile; wrong password; server error), idle timer (10 minutes, each kind of activity, other tabs, redraws don't restart it, keep-alive once a minute), the workspace logging out with the notice. Browser: confirm from the email lands in the app; the same link later shows the login page.
