"""Request guards for the API.

The staff API has no login yet (planned) and runs on the staff member's own computer, so a
malicious website open in the same browser is the main threat:

- DNS rebinding: a site points its own domain at 127.0.0.1 to read the local API. Blocked by
  serving only requests whose Host header is an allowed name.
- Cross-site requests: a site makes the browser POST or DELETE (an upload, send or reissue needs
  no CORS preflight). Blocked by rejecting state-changing requests from another origin.
- Oversize bodies: a chunked upload has no Content-Length, so the size is counted while it
  streams in, with a much smaller limit on the public signing endpoints.

Every response also gets headers that stop framing (clickjacking), caching, sniffing and referrers.
"""
import re
from urllib.parse import urlsplit

from fastapi import HTTPException
from fastapi.responses import JSONResponse

DEFAULT_ALLOWED_HOSTS = "127.0.0.1,localhost"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"cache-control", b"no-store"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"frame-ancestors 'none'"),
    (b"referrer-policy", b"no-referrer"),
]


def parse_allowed_hosts(value: str | None) -> frozenset[str]:
    """Comma-separated host names (no ports) from ASTRA_ALLOWED_HOSTS."""
    return frozenset(host.strip().lower() for host in (value or DEFAULT_ALLOWED_HOSTS).split(",") if host.strip())


HOST_HEADER = re.compile(r"(?:\[(?P<ipv6>[0-9a-f:.]+)\]|(?P<name>[a-z0-9.-]+))(?::(?P<port>[0-9]{1,5}))?")


UNKNOWN_HOST = "Unknown host name. Open the app at its configured address."


def parse_host(host_header: str) -> tuple[str, int | None] | None:
    """A Host header as (name, port), or None unless it is exactly a host name and an optional numeric port.

    Strict on purpose: values like 'localhost:x@evil.example' must not pass as 'localhost', because the
    host is used to build links in emails, where everything before '@' would be read as a user name.
    """
    match = HOST_HEADER.fullmatch(host_header.strip().lower())
    if not match or (match["port"] and int(match["port"]) > 65535):
        return None
    return (match["ipv6"] or match["name"]), (int(match["port"]) if match["port"] else None)


def host_name(host_header: str) -> str:
    """'127.0.0.1:8000' -> '127.0.0.1', '[::1]:8000' -> '::1'; '' for anything that isn't a clean host[:port]."""
    parsed = parse_host(host_header)
    return parsed[0] if parsed else ""


def is_cross_site(origin: str | None, fetch_site: str | None, host_header: str) -> bool:
    if fetch_site == "cross-site":
        return True
    if origin is None:
        return False  # non-browser clients and same-origin GET-style requests
    parts = urlsplit(origin)
    return not (parts.scheme in {"http", "https"} and parts.netloc.lower() == host_header.strip().lower())


class BodyTooLarge(HTTPException):
    """An HTTPException so FastAPI's body parsing re-raises it unchanged as a 413."""


class SecurityMiddleware:
    def __init__(self, app, allowed_hosts: frozenset[str], body_limit: int, body_limit_message: str,
                 small_body_prefixes: tuple[str, ...] = (), small_body_limit: int = 1024 * 1024):
        self.app = app
        self.allowed_hosts = allowed_hosts
        self.body_limit = body_limit
        self.body_limit_message = body_limit_message
        self.small_body_prefixes = small_body_prefixes
        self.small_body_limit = small_body_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                names = {name.lower() for name, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [h for h in SECURITY_HEADERS if h[0] not in names]
            await send(message)

        async def reject(status: int, detail: str):
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send_with_headers)

        headers = {name.decode("latin-1").lower(): value.decode("latin-1") for name, value in scope["headers"]}
        host = headers.get("host", "")
        if host_name(host) not in self.allowed_hosts:
            await reject(400, UNKNOWN_HOST)
            return
        if scope["method"] not in SAFE_METHODS and is_cross_site(headers.get("origin"), headers.get("sec-fetch-site"), host):
            await reject(403, "Requests from other websites are not allowed.")
            return

        if "\x00" in scope["path"]:  # can't name anything stored in PostgreSQL
            await reject(404, "Not found.")
            return

        small = scope["path"].startswith(self.small_body_prefixes) if self.small_body_prefixes else False
        limit = self.small_body_limit if small else self.body_limit
        message = "The request is too large." if small else self.body_limit_message
        length = headers.get("content-length")
        if length is not None and (not length.isdigit() or int(length) > limit):
            await reject(413, message)
            return

        received = 0

        async def counted_receive():
            nonlocal received
            event = await receive()
            if event["type"] == "http.request":
                received += len(event.get("body", b""))
                if received > limit:
                    raise BodyTooLarge(413, message)
            return event

        await self.app(scope, counted_receive, send_with_headers)
