"""Sending email: Resend in production, a file outbox for local development and browser tests, or nothing.

Configuration (environment or the git-ignored .env):
  RESEND_API_KEY + ASTRA_EMAIL_FROM   send through Resend (https://resend.com)
  ASTRA_EMAIL_OUTBOX=<folder>         write each email as a JSON file instead (takes precedence; never sends)
"""
import json
import logging
import os
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html import escape
from pathlib import Path

logger = logging.getLogger("astrasign.email")
RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    html: str
    text: str
    reply_to: str | None = None


class EmailError(Exception):
    """Sending failed. The message never contains the API key."""


class ResendSender:
    def __init__(self, api_key: str, sender: str, opener=urllib.request.urlopen):
        self._api_key, self.sender, self._open = api_key, sender, opener

    def send(self, email: Email) -> None:
        body = {"from": self.sender, "to": [email.to], "subject": email.subject, "html": email.html, "text": email.text}
        if email.reply_to:
            body["reply_to"] = email.reply_to
        request = urllib.request.Request(RESEND_URL, data=json.dumps(body).encode("utf-8"), method="POST", headers={
            "Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json", "User-Agent": "astra-sign/1.0"})
        try:
            with self._open(request, timeout=15) as response:
                if not 200 <= response.status < 300:
                    raise EmailError(f"Resend answered {response.status}")
        except urllib.error.HTTPError as exc:
            raise EmailError(f"Resend refused the email ({exc.code})") from None
        except OSError as exc:  # URLError and timeouts are OSErrors
            raise EmailError(f"Resend could not be reached ({type(exc).__name__})") from None


class OutboxSender:
    """Writes each email to <folder>/<time>-<id>.json. For local development and browser tests: nothing leaves the machine."""

    def __init__(self, folder: Path):
        self.folder = Path(folder)

    def send(self, email: Email) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        name = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')}-{uuid.uuid4().hex[:8]}.json"
        (self.folder / name).write_text(json.dumps(asdict(email), indent=2), encoding="utf-8")


def sender_from_env():
    """The configured sender, or None when email isn't set up (requests are still accepted; nothing is sent)."""
    if outbox := os.environ.get("ASTRA_EMAIL_OUTBOX"):
        return OutboxSender(Path(outbox))
    key, sender = os.environ.get("RESEND_API_KEY"), os.environ.get("ASTRA_EMAIL_FROM")
    if key and sender:
        return ResendSender(key, sender)
    return None


def _layout(heading: str, paragraphs: list[str], button_text: str, link: str, footer: str) -> str:
    safe_link = escape(link, quote=True)
    body = "".join(f'<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#33443a">{p}</p>' for p in paragraphs)
    return f"""<!doctype html><html><body style="margin:0;background:#f4f6f3;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e1e7df;border-radius:10px">
<tr><td style="padding:28px 28px 8px"><div style="font-size:20px;font-weight:bold;color:#254b39">Astra Sign</div></td></tr>
<tr><td style="padding:8px 28px 4px"><h1 style="margin:0 0 14px;font-size:20px;color:#1f2d26">{heading}</h1>{body}
<p style="margin:22px 0"><a href="{safe_link}" style="background:#32644d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">{button_text}</a></p>
<p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#7c857e">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">{safe_link}</span></p>
</td></tr>
<tr><td style="padding:14px 28px 26px;border-top:1px solid #eef1ec;font-size:12px;line-height:1.6;color:#7c857e">{footer}</td></tr>
</table></td></tr></table></body></html>"""


def reset_email(to: str, name: str, link: str) -> Email:
    greeting = name.strip() or "there"
    html = _layout("Reset your password",
                   [f"Hi {escape(greeting)},", "Someone (hopefully you) asked to reset the password for your Astra Sign account. "
                    "Choose a new password with the button below. The link works once and expires in 1 hour."],
                   "Choose a new password", link,
                   "If you didn't ask for this, you can ignore this email: your password won't change.")
    text = (f"Hi {greeting},\n\n"
            "Someone (hopefully you) asked to reset the password for your Astra Sign account.\n"
            f"Choose a new password here (works once, expires in 1 hour):\n{link}\n\n"
            "If you didn't ask for this, you can ignore this email: your password won't change.\n")
    return Email(to=to, subject="Reset your Astra Sign password", html=html, text=text)
