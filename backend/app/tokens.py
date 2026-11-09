"""Signing-link secrets. Only the hash is ever stored."""
import hashlib
import secrets


def new_token() -> str:
    """A 256-bit, URL-safe secret for one signing link."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 hex digest used to look a token up without storing it."""
    return hashlib.sha256(token.encode()).hexdigest()
