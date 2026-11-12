"""Reminders until a file is signed (at most seven per emailed link), and the "signed" email to the staff member who sent it.

A background loop in the app process sends due reminders. Each one is claimed under the database write lock,
so several app processes never send the same reminder twice.
"""
import asyncio
import contextlib
import logging
import math
import os
import threading
from datetime import datetime, timedelta, timezone

from .database import utc_now, write_lock
from .email import reminder_email, signed_notice_email
from .email_limit import take_email_slot
from .events import record_event
from .storage import Storage
from .tokens import hash_token, new_token

logger = logging.getLogger("astrasign.reminders")

DEFAULT_MINUTES = 24 * 60
MAX_MINUTES = 366 * 24 * 60  # anything longer is a mistake
BATCH = 20  # reminders per check, so one check never holds the loop for long
MAX_REMINDERS = 7  # after each emailed link: a week of daily reminders, then they stop


def reminder_interval() -> timedelta:
    """ASTRA_REMINDER_MINUTES (e.g. 2 for a demo), else 24 hours."""
    try:
        minutes = float(os.environ.get("ASTRA_REMINDER_MINUTES", DEFAULT_MINUTES))
    except ValueError:
        minutes = DEFAULT_MINUTES
    return timedelta(minutes=minutes if math.isfinite(minutes) and 0 < minutes <= MAX_MINUTES else DEFAULT_MINUTES)


def after(interval: timedelta) -> str:
    return (datetime.now(timezone.utc) + interval).isoformat()


def check_every() -> float:
    """Seconds between checks: a quarter of the interval, between 1 and 30."""
    return min(30.0, max(1.0, reminder_interval().total_seconds() / 4))


def send_due_reminders(storage: Storage, sender, stop: threading.Event | None = None) -> int:
    """Email every due reminder (up to BATCH), stopping early once `stop` is set. Returns how many were attempted."""
    interval, attempted = reminder_interval(), 0
    for _ in range(BATCH):
        if stop is not None and stop.is_set():
            break
        token = new_token()
        with storage.database() as db:
            write_lock(db)  # claim: no other run or process can pick the same file now
            row = db.execute("""SELECT f.id, f.organization_id, f.signer_name, f.signer_email, f.document_name, f.link_base,
                                       u.name AS staff_name, u.email AS staff_email, o.name AS company
                                FROM files f JOIN organizations o ON o.id = f.organization_id LEFT JOIN users u ON u.id = f.sent_by
                                WHERE f.remind_at <= %s AND f.status IN ('sent', 'viewed') ORDER BY f.remind_at LIMIT 1""",
                             (utc_now(),)).fetchone()
            if row is None:
                break
            if not take_email_slot(db, row["organization_id"], "reminder"):  # the daily reminder allowance: try again in an hour
                db.execute("UPDATE files SET remind_at = %s WHERE id = %s", (after(min(interval, timedelta(hours=1))), row["id"]))
                continue
            db.execute("INSERT INTO signing_links (token_hash, file_id, created_at) VALUES (%s, %s, %s)",
                       (hash_token(token), row["id"], utc_now()))
            db.execute("""UPDATE files SET reminders_left = reminders_left - 1,
                                  remind_at = CASE WHEN reminders_left > 1 THEN %s END WHERE id = %s""",  # the last one: none after it
                       (after(interval), row["id"]))
        attempted += 1
        sender_name = row["staff_name"] or row["company"]
        email = reminder_email(to=row["signer_email"], signer_name=row["signer_name"], sender_name=sender_name,
                               sender_email=row["staff_email"], company=row["company"], document_name=row["document_name"],
                               link=f"{row['link_base']}/sign#{token}")
        record_delivery(storage, sender, email, row["id"], "reminder_sent", "reminder_failed")
    return attempted


def record_delivery(storage: Storage, sender, email, file_id: str, ok: str, failed: str) -> None:
    """Send, then record the outcome on the file's timeline (unless the file was deleted meanwhile)."""
    try:
        sender.send(email)
        outcome = ok
    except Exception as exc:  # EmailError, or anything unexpected from the provider client
        logger.warning("Email not delivered id=%s type=%s: %s", file_id, ok, exc)
        outcome = failed
    with storage.database() as db:
        write_lock(db)
        if db.execute("SELECT 1 FROM files WHERE id = %s", (file_id,)).fetchone():
            record_event(db, file_id, outcome, detail=email.to)


async def reminder_loop(storage: Storage, sender, stop: threading.Event) -> None:
    """Runs for the app's lifetime; one failed check never stops the next. When cancelled (the app is stopping and
    `stop` is set), a check already running finishes its current reminder first, so it never outlives the database pool."""
    while True:
        await asyncio.sleep(check_every())
        check = asyncio.ensure_future(asyncio.to_thread(send_due_reminders, storage, sender, stop))
        try:
            await asyncio.shield(check)
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await check
            raise
        except Exception:
            logger.exception("Reminder check failed")


def notify_signed(storage: Storage, sender, file_id: str, base_url: str) -> None:
    """Runs after the signing response: email the staff member who sent the file (or the company's first user)."""
    with storage.database() as db:
        row = db.execute("""SELECT f.title, f.signer_name, f.document_name, u.name, u.email
                            FROM files f JOIN users u ON u.id = COALESCE(f.sent_by,
                                (SELECT id FROM users WHERE organization_id = f.organization_id ORDER BY created_at LIMIT 1))
                            WHERE f.id = %s""", (file_id,)).fetchone()
    if row is None:
        return
    email = signed_notice_email(to=row["email"], staff_name=row["name"], signer_name=row["signer_name"],
                                document_name=row["document_name"], file_title=row["title"], link=f"{base_url}/")
    record_delivery(storage, sender, email, file_id, "signed_notice_sent", "signed_notice_failed")
