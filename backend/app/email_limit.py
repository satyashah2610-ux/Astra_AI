"""Daily limits on signing emails per company: one allowance for sends and reissues, a separate one for reminders."""
import logging
from datetime import datetime, timedelta, timezone

from .database import utc_now

logger = logging.getLogger("astrasign.email")

SIGNING_EMAILS_PER_DAY = 50  # per company: enough for real work, too few to use our domain for spam
REMINDERS_PER_DAY = 100  # separate, so waiting files never block new sends; together still a bounded amount


def take_email_slot(db, organization_id: str, kind: str = "send") -> bool:
    """Count one signing email if the company is under its limit. Call under the write lock, inside the
    transaction that sends, so parallel sends can't pass the limit together."""
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    limit = REMINDERS_PER_DAY if kind == "reminder" else SIGNING_EMAILS_PER_DAY
    db.execute("DELETE FROM signing_emails WHERE organization_id = %s AND at <= %s", (organization_id, day_ago))
    sent = db.execute("SELECT COUNT(*) FROM signing_emails WHERE organization_id = %s AND kind = %s", (organization_id, kind)).fetchone()[0]
    if sent >= limit:
        logger.warning("Signing email limit reached organization=%s kind=%s", organization_id, kind)
        return False
    db.execute("INSERT INTO signing_emails (organization_id, at, kind) VALUES (%s, %s, %s)", (organization_id, utc_now(), kind))
    return True
