# Design 14: Signing reminders and "signed" notice

Status: implemented.

## Problem

After a file is sent, nothing happens if the client doesn't sign: staff have to notice and chase. And when the client does sign, staff only find out by opening the app.

## High-level design

```
Send / reissue (emailed) ──► remind_at = now + interval, sent_by = staff
Every tick (≤30 s) ──► files with remind_at ≤ now and status sent/viewed:
      reminder email with a fresh link (earlier links keep working) ──► remind_at = now + interval
      timeline: Reminder sent / Reminder not delivered
Client signs ──► remind_at cleared ──► email to the staff member who sent it ──► timeline: Company notified
```

| Decision | Chosen | Why |
|---|---|---|
| Interval | Every 24 hours until signed; `ASTRA_REMINDER_MINUTES` (default 1440) | The product owner asked for daily reminders until signed; 2 minutes for a local demo. |
| Which files | Only files whose link was emailed by the latest send or reissue | If staff chose to share the link themselves, we don't start emailing the client. |
| The link in a reminder | Each reminder carries a new link; earlier links (the first email, earlier reminders) keep working until staff reissue the link | Links are stored only as hashes, so the original can't be re-sent; invalidating it would break the email the client may already be using. Reissue still revokes every link (its purpose is revoking a leaked one). |
| Abuse limit | Reminders have their own allowance of 100 per company per day (sends and reissues keep their 50); when it's full, the reminder waits an hour | Without a limit each sent file adds a daily email forever; sharing the 50 would let waiting files block new sends. |
| Sender | "<staff> via Astra Sign", replies to the staff member who sent the file | Same as the first email: the client knows who is asking. |
| Who is notified on signing | The staff member who sent (or last reissued) the file | One login per company today; the sender is the person waiting on it. |
| Tracking per file | Timeline events (Reminder sent / not delivered, Company notified / not delivered); the file shows reminders sent and when the next one is due | "Track that for each document." |
| Scheduler | A background loop in the app process; each reminder is claimed under the database write lock | No extra service to host; several app processes can't send the same reminder twice. |

Left for later: turning reminders off per file; a cap on the number of reminders; reminders run only while the app is running (a sleeping free host delays them).

## Low-level design

**Migration `0007_reminders.sql`:** `files.remind_at`, `files.sent_by → users ON DELETE SET NULL`, `files.link_base` (the app address the link was built with, since the loop has no request); `signing_links (token_hash PK, file_id → files ON DELETE CASCADE, created_at)`; new event types `reminder_sent`, `reminder_failed`, `signed_notice_sent`, `signed_notice_failed`.

**Backend:** `app/reminders.py` (`reminder_interval`, `send_due_reminders`, `reminder_loop`, `notify_signed`, `record_delivery`); `app/email_limit.py` (the daily allowances: `signing_emails.kind` is `send` or `reminder`); signing looks a link up in `files.token_hash` or `signing_links`; signing clears `remind_at` and notifies after the response. File API adds `reminders_sent` and `next_reminder_at`.

**Frontend:** file detail shows "Reminders": number sent and the next one; timeline labels for the new events; the email checkbox says reminders follow until signed.

## Tests (written first)

Integration: emailed send schedules a reminder, unemailed doesn't; a due reminder emails a new working link (the old one still works) and moves the schedule; viewed files are reminded, signed and deleted ones aren't; reissue revokes reminder links and restarts the schedule; reminders have their own daily limit and never block sends; a failed reminder is recorded; two runs at once send one email; the loop sends on its own; signing emails the sender and records it; a failed notice is recorded. Unit: reminder and notice emails escape names. Frontend: reminder info and labels. Browser: the staff member gets the "signed" email.
