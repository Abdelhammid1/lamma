"""Slug validation + reserved list.

A slug is what becomes the URL identifier at `<slug>.manasety.ai` (or
`manasety.ai/birthday/<slug>` in path-based mode). We enforce:

- lowercase alphanumeric + hyphen only
- 2–40 characters
- no leading / trailing hyphen
- not in the reserved list (subdomains already used by the company OR
  paths that this site itself owns)
- not already taken by an active event
"""

import re


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")


# Subdomains already used by other manasety.ai products or infra. Never
# available for a customer to claim.
COMPANY_RESERVED = frozenset({
    "admin", "www", "api", "lamma", "mail", "ftp",
    "marsoud", "lexoffice", "almustashar", "activefit",
    "school", "elyasmin", "chatwoot", "n8n", "qaffer",
    "blog", "support", "help", "status",
})

# Paths this site itself owns — must never collide with a slug.
SITE_RESERVED = frozenset({
    "birthday", "wedding", "invitation",
    "create", "about", "contact", "terms", "privacy",
})

RESERVED_SLUGS = COMPANY_RESERVED | SITE_RESERVED


class SlugError(ValueError):
    """Raised when a slug fails validation. `reason` is a short code
    suitable for JSON responses; `message` is a human sentence."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def normalize(slug: str | None) -> str:
    """Trim + lowercase. Returns empty string for None."""
    if slug is None:
        return ""
    return slug.strip().lower()


def check_format(slug: str) -> None:
    """Raise SlugError if the slug fails purely-syntactic checks."""
    if not slug:
        raise SlugError("empty", "Please enter a name.")
    if len(slug) < 2:
        raise SlugError("too_short", "Name must be at least 2 characters.")
    if len(slug) > 40:
        raise SlugError("too_long", "Name must be at most 40 characters.")
    if not SLUG_RE.match(slug):
        raise SlugError(
            "bad_format",
            "Use lowercase English letters, digits, or hyphens only (no spaces).",
        )


def check_reserved(slug: str) -> None:
    """Raise SlugError if the slug is on the reserved list."""
    if slug in RESERVED_SLUGS:
        raise SlugError("reserved", "That name is reserved. Please choose another.")


def is_available(slug: str, db_session) -> bool:
    """Ask the DB whether this slug is claimed by an active event.

    An event 'holds' the slug when its status is `awaiting_code` or
    `published`. Draft / expired / deleted events don't lock the slug —
    the cleanup cron frees drafts after 48h.
    """
    from models import Event   # local import to avoid a circular ref

    row = (
        db_session.query(Event)
        .filter(Event.slug == slug)
        .filter(Event.status.in_(("awaiting_code", "published")))
        .first()
    )
    return row is None


def validate(slug: str, db_session=None) -> str:
    """Full pipeline: normalize → format → reserved → (optional) DB check.

    Returns the normalized slug on success. Raises SlugError otherwise.
    Passing db_session=None skips the availability check (useful in
    pure unit tests of the format/reserved logic).
    """
    s = normalize(slug)
    check_format(s)
    check_reserved(s)
    if db_session is not None and not is_available(s, db_session):
        raise SlugError("taken", "That name is already taken.")
    return s
