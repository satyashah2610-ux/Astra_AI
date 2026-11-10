"""Append-only audit trail per file."""
import ipaddress
import os

from fastapi import Request

from .storage import utc_now


MAX_PROXIES = 5  # more than this is surely a typo


def trusted_proxies() -> int:
    """ASTRA_TRUSTED_PROXIES: how many proxies (e.g. the host's load balancer) sit in front of the app. 0 when unset.
    A value that isn't a whole number from 0 to 5 is an error: the app checks it at startup and refuses to run."""
    value = os.environ.get("ASTRA_TRUSTED_PROXIES", "").strip()
    if not value:
        return 0
    if not (value.isascii() and value.isdigit()) or int(value) > MAX_PROXIES:
        raise RuntimeError(f"ASTRA_TRUSTED_PROXIES must be a whole number from 0 to {MAX_PROXIES} "
                           "(the number of proxies in front of the app).")
    return int(value)


def parse_ip(text: str) -> str | None:
    """An address in one standard spelling, ignoring a port ("1.2.3.4:5678", "[2001:db8::1]:443"); None if not an address."""
    text = text.strip()
    if text.startswith("["):
        text = text[1:text.index("]")] if "]" in text else ""
    elif text.count(":") == 1:  # IPv4 with a port (a bare IPv6 address has several colons)
        text = text.split(":")[0]
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def client_ip(request: Request) -> str | None:
    """The visitor's address. Each trusted proxy appends the address it received the request from to X-Forwarded-For,
    so the visitor is the Nth entry from the right; entries further left were written by the visitor and are never used.
    Without trusted proxies, or with a missing, short or malformed header, the connection's own address is used."""
    peer = request.client.host if request.client else None
    peer = (parse_ip(peer) or peer) if peer else None
    hops = trusted_proxies()
    if hops == 0:
        return peer
    entries = ",".join(request.headers.getlist("x-forwarded-for")).split(",")  # several header lines read in order
    if len(entries) < hops:
        return peer
    return parse_ip(entries[-hops]) or peer


def request_origin(request: Request | None) -> tuple[str | None, str | None]:
    """(IP address, browser) of the person making the request."""
    if request is None:
        return None, None
    return client_ip(request), request.headers.get("user-agent", "")[:500] or None


def record_event(db, file_id: str, event_type: str, request: Request | None = None, at: str | None = None,
                 detail: str | None = None) -> None:
    ip, user_agent = request_origin(request)
    db.execute("INSERT INTO file_events (file_id, type, at, ip, user_agent, detail) VALUES (%s, %s, %s, %s, %s, %s)",
               (file_id, event_type, at or utc_now(), ip, user_agent, detail))


def list_events(db, file_id: str) -> list[dict]:
    rows = db.execute("SELECT type, at, ip, user_agent, detail FROM file_events WHERE file_id = %s ORDER BY id", (file_id,))
    return [dict(row) for row in rows]
