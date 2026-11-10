"""The app's own address, for links sent by email (password resets, signing links)."""
import os

from fastapi import HTTPException, Request

from .security import UNKNOWN_HOST, parse_host


def secure_cookies(request: Request) -> bool:
    return request.url.scheme == "https" or os.environ.get("ASTRA_SECURE_COOKIES") == "1"


def app_url(request: Request) -> str:
    """Where links in emails point: ASTRA_APP_URL, or this request's host rebuilt from its checked parts.
    Never the raw Host header: anything but a clean host[:port] is refused, so a link can't be pointed elsewhere.
    Behind a TLS-terminating proxy (ASTRA_SECURE_COOKIES=1) the request arrives as http, but the link must be https."""
    configured = os.environ.get("ASTRA_APP_URL", "").strip().rstrip("/")
    if configured:
        return configured
    parsed = parse_host(request.headers.get("host", ""))
    if parsed is None:  # the middleware already refuses these; never build a link from one
        raise HTTPException(400, UNKNOWN_HOST)
    name, port = parsed
    host = f"[{name}]" if ":" in name else name
    scheme = "https" if secure_cookies(request) else request.url.scheme
    return f"{scheme}://{host}{'' if port is None else f':{port}'}"
