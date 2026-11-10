# Design 10: Personalised signing email

Status: implemented.

## Problem

Sending a file shows a signing link that staff must copy into their own email or chat. The product owner wants the client to receive a personalised email with the link, directly from the app.

## High-level design

```
New file form ── optional personal message ──► stored on the file (editable while draft)
Send / Reissue link ── "Email the link to <signer>" (on by default) ──► link created as today
        └─► after the response: email to the signer ──► timeline: "Email sent to …" or "Email not delivered"
```

- **From** `<Staff name> via Astra Sign <sign@mail.signwithastra.com>`; **Reply-To** the staff member's own email, so replies reach them, not a no-reply box.
- **Body:** greets the signer by name, says who sent which document for which company, shows the personal message (if any) as quoted text, a **Review and sign** button, the copyable link, and a note that no account is needed.
- **Copy link stays.** Staff can untick "Email the link" (e.g. to send it by WhatsApp), and the link is always shown once after sending, as before.
- **Sending never blocks or undoes the send.** The email goes out after the response; the result is recorded on the file's timeline. When email isn't configured, the screen says so and staff copy the link.
- **Reissuing a link emails the new link** (same checkbox), because the old one stops working.
- **Daily limit: 50 signing emails per company per rolling 24 hours.** Anyone can sign up, so without a limit an account could use our verified domain to mass-mail (phishing). Past the limit the file is still sent and the screen asks staff to copy the link.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Sender identity | "Name via Astra Sign" from our verified domain, Reply-To the staff email | Sending as the staff member's own address | Their domain isn't ours; spoofed From addresses fail SPF/DKIM and land in spam. |
| Personal message | Optional, plain text, up to 2,000 characters, stored on the file, escaped in the email | Rich text / templates | Covers "Hi Jordan, here's the agreement we discussed"; no HTML injection surface. |
| When to email | On send and reissue, opt-out checkbox (on by default) | Always / never | Default matches the request; opting out keeps WhatsApp/SMS workflows. |
| Delivery result | Timeline events `email_sent` / `email_failed` with the recipient | Blocking the send until the provider answers | The file is sent either way; staff see what happened and can reissue. |
| Link base | Shared `app_url()` (ASTRA_APP_URL or the strictly parsed host) | Duplicate logic | One audited place builds every emailed link (see the Host-header fix). |
| Abuse of our sending domain | 50 emails per company per 24 h, counted in the send's transaction | Email verification at sign-up; no limit | Verification is a larger flow (later); no limit risks the domain's reputation. |
| Staff "client signed" email | Not in this step | — | Not requested; simplest version first. |

## Low-level design

**Migration `0004_signing_email.sql`:** `files.message TEXT`; `file_events.detail TEXT`; `file_events.type` also allows `email_sent`, `email_failed`.
**Migration `0005_signing_email_limit.sql`:** `signing_emails (organization_id, at)`, one row per queued email; rows older than a day are deleted when counting.

**API**

| Endpoint | Change |
|---|---|
| `POST /api/files`, `PATCH /api/files/{id}` | optional `message` (trimmed; empty clears it; ≤ 2,000; no NUL) |
| `POST /api/files/{id}/send`, `POST /api/files/{id}/link` | optional body `{"email": true|false}` (default true); response adds `email`: `"sending"`, `"off"`, `"not_configured"` or `"limit_reached"` |
| `GET /api/files/{id}/events` | events may carry `detail` (the recipient) |

**Modules:** `app/links.py` (`app_url`, shared with password reset); `app/email.py` gains `from_name` on `Email` and `signing_email(...)`; `app/files.py` queues the email after commit and records the result.

## Test plan (written before the code)

**Unit:** `signing_email` content (signer, sender, company, document, link, escaped message with line breaks, Reply-To, from-name), Resend `from` built as `Name via Astra Sign <address>` with quoting, outbox keeps the from-name.

**Integration:** sending emails the signer once with a working link and records `email_sent`; `{"email": false}` sends nothing; no sender configured gives `not_configured` and still sends the file; a provider failure records `email_failed` and the file stays sent; reissue emails the new link (old link refused); the personal message is stored, editable while draft, cleared by empty text, escaped in the email, limited in length; another company can't send or read it.

**Frontend:** the form's message box, the "Email the link" checkbox (default on, sent in the request), the confirmation text for each `email` result, timeline labels for email events.

**Browser:** create and send with a message; the outbox email contains the message and a link that opens the signing page.
