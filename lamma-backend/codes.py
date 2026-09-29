"""Activation code generation + validation.

Codes are single-use, optionally bound to a specific event, optionally
expiring. Format is 12 uppercase alphanumeric chars split into three
4-char groups for readability, e.g. `AH3F-9K2P-XZLB`.
"""

import secrets
from datetime import datetime, timedelta
from typing import Optional


# We use a 30-char alphabet — the crockford base32 style without ambiguous
# characters (O/0, I/1, L/1) so codes dictated over the phone don't get
# mistyped.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code() -> str:
    """Return a fresh 12-char code in `XXXX-XXXX-XXXX` format."""
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(12))
    return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"


def normalize_code(raw: Optional[str]) -> str:
    """Strip spaces, uppercase. Also inserts hyphens if the user typed
    without them, so `AH3F9K2PXZLB` and `ah3f-9k2p-xzlb` both work."""
    if not raw:
        return ""
    s = "".join(c for c in raw.upper() if c.isalnum())
    if len(s) == 12:
        return f"{s[0:4]}-{s[4:8]}-{s[8:12]}"
    return raw.strip().upper()


class ActivationError(ValueError):
    """Raised when an activation code fails validation."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def validate_code_for_event(code_row, event_id: str, now: Optional[datetime] = None) -> None:
    """Raise ActivationError if `code_row` cannot be used to activate
    `event_id` right now. Success is silent."""
    now = now or datetime.utcnow()

    if code_row is None:
        raise ActivationError("not_found", "Invalid activation code.")
    if code_row.used:
        raise ActivationError("used", "This code has already been used.")
    if code_row.expires_at and code_row.expires_at < now:
        raise ActivationError("expired", "This code has expired. Ask the team for a new one.")
    if code_row.event_id is not None and code_row.event_id != event_id:
        # Code was minted for a different event — never let it cross-use
        raise ActivationError("wrong_event", "This code is not valid for this page.")


def make_expiry(hours: Optional[int]) -> Optional[datetime]:
    """Helper for the admin panel: turn '48' hours into a UTC datetime."""
    if not hours or hours <= 0:
        return None
    return datetime.utcnow() + timedelta(hours=int(hours))
