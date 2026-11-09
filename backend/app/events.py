"""Append-only audit trail per file."""
from fastapi import Request

from .storage import utc_now

EVENT_TYPES = ("created", "sent", "link_reissued", "viewed", "signed")


def request_origin(request: Request | None) -> tuple[str | None, str | None]:
    """(IP address, browser) of the person making the request."""
    if request is None:
        return None, None
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent", "")[:500] or None


def record_event(db, file_id: str, event_type: str, request: Request | None = None, at: str | None = None) -> None:
    ip, user_agent = request_origin(request)
    db.execute("INSERT INTO file_events (file_id, type, at, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
               (file_id, event_type, at or utc_now(), ip, user_agent))


def list_events(db, file_id: str) -> list[dict]:
    rows = db.execute("SELECT type, at, ip, user_agent FROM file_events WHERE file_id = ? ORDER BY id", (file_id,))
    return [dict(row) for row in rows]
