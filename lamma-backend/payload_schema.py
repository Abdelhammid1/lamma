"""Server-side check of an invitation's payload before it is stored.

The create form builds the payload in the browser, and until now the
server stored whatever arrived. That is how `blob:` links (valid only in
the editor's tab) reached a published page and silently dropped a song
and a photo. This rejects the shapes that break a live invitation:

- links a guest's browser can't open (`blob:`, `javascript:`, `data:`…)
- wrong types (a string where the template expects a list, …)
- lists far past what the form can produce
- oversized text and payloads

Unknown keys are allowed — older invitations carry fields the current
form no longer writes, and the templates ignore what they don't read.
"""

from __future__ import annotations

import json
import re
from datetime import datetime

MAX_PAYLOAD_BYTES = 200_000
MAX_STRING = 5_000

COUPLE_TYPES = {"wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard", "wedding-blue", "engagement", "qiraya", "sobou", "invitation"}
BIRTHDAY_TYPES = {"birthday", "birthday-elegant"}

# Generous ceilings: well above what the form allows (8 photos, 4
# contacts, 5 colours…) so a legitimate invitation never trips them.
LIMITS = {
    "gallery": 12, "schedule": 40, "contacts": 10, "colors": 10,
    "memories": 12, "quiz": 30, "options": 10,
}

_MEDIA_PATH = re.compile(r"^/media/[a-z0-9][a-z0-9-]*/[A-Za-z0-9._-]+$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_payload(event_type: str, payload) -> list[str]:
    """Return a list of human-readable problems; empty means OK.
    `payload` is the decoded JSON (dict) or a JSON string."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return ["payload is not valid JSON"]
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]

    errors: list[str] = []
    size = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    if size > MAX_PAYLOAD_BYTES:
        errors.append(f"payload is too large ({size // 1000} KB, max {MAX_PAYLOAD_BYTES // 1000} KB)")

    _walk_strings(payload, "", errors)

    if event_type in COUPLE_TYPES:
        _check_couple(payload, errors)
    elif event_type in BIRTHDAY_TYPES:
        _check_birthday(payload, errors)
    return errors[:10]


# --- shared ------------------------------------------------------------------

def _walk_strings(node, path, errors):
    """Every string anywhere: length cap, and no browser-local links."""
    if isinstance(node, str):
        if len(node) > MAX_STRING:
            errors.append(f"{path or 'value'} is too long ({len(node)} characters)")
        if "blob:" in node:
            errors.append(f"{path or 'value'} is a link that only works in the editor's tab (blob:) — the file wasn't uploaded")
    elif isinstance(node, dict):
        for k, v in node.items():
            _walk_strings(v, f"{path}.{k}" if path else str(k), errors)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk_strings(v, f"{path}[{i}]", errors)


def _media_url(value, path, errors, *, allow_web=True, allow_empty=True):
    """A media link a guest can open: our own /media/<slug>/<file>, or an
    http(s) URL. Empty is allowed where the field is optional."""
    if value is None or (value == "" and allow_empty):
        return
    if not isinstance(value, str):
        errors.append(f"{path} must be a link")
        return
    v = value.strip()
    if "blob:" in v:
        return          # already reported by _walk_strings, in plainer words
    if _MEDIA_PATH.match(v):
        return
    if allow_web and re.match(r"^https?://", v, re.I):
        return
    # Older invitations store relative paths ("media/medo/x.jpg"); keep
    # them editable. Anything with another scheme (javascript:, data:,
    # blob:) or a protocol-relative //host is refused.
    if v and ":" not in v and not v.startswith("//"):
        return
    errors.append(f"{path} is not a link guests can open")


def _web_url(value, path, errors):
    """Maps fields: a link, or a typed address (the page searches for
    it). Only a non-web scheme — javascript:, data:, blob: — or a
    protocol-relative //host is refused."""
    if value in (None, ""):
        return
    if not isinstance(value, str):
        errors.append(f"{path} must be text")
        return
    v = value.strip()
    m = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*):", v)
    if v.startswith("//") or (m and m.group(1).lower() not in ("http", "https")):
        errors.append(f"{path} must be a normal web link or an address")


def _list(payload, key, path, errors, limit_key=None):
    v = payload.get(key)
    if v is None:
        return []
    if not isinstance(v, list):
        errors.append(f"{path} must be a list")
        return []
    limit = LIMITS[limit_key or key]
    if len(v) > limit:
        errors.append(f"{path} has {len(v)} items (max {limit})")
    return v


def _obj(payload, key, path, errors):
    v = payload.get(key)
    if v is None:
        return {}
    if not isinstance(v, dict):
        errors.append(f"{path} must be an object")
        return {}
    return v


def _str_fields(obj, keys, path, errors):
    for k in keys:
        v = obj.get(k)
        if v is not None and not isinstance(v, str):
            errors.append(f"{path}.{k} must be text" if path else f"{k} must be text")


# --- per family --------------------------------------------------------------

def _check_couple(p, errors):
    couple = _obj(p, "couple", "couple", errors)
    _str_fields(couple, ("groom", "bride", "eventType", "groomLabel", "brideLabel"), "couple", errors)

    event = _obj(p, "event", "event", errors)
    _str_fields(event, ("datetimeIso", "welcomeTime", "receptionTime"), "event", errors)
    iso = event.get("datetimeIso")
    if isinstance(iso, str) and iso:
        try:
            datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except ValueError:
            errors.append("event.datetimeIso is not a valid date")

    venue = _obj(p, "venue", "venue", errors)
    _str_fields(venue, ("name", "address"), "venue", errors)
    _web_url(venue.get("mapsEmbedSrc"), "venue.mapsEmbedSrc", errors)
    _web_url(venue.get("mapsDeepLink"), "venue.mapsDeepLink", errors)

    for key in ("blessing", "verse"):          # verse: wedding-blue's opening line
        if p.get(key) is not None and not isinstance(p.get(key), str):
            errors.append(f"{key} must be text")

    # wedding-burgundy extras (optional everywhere, ignored by the others)
    _str_fields(couple, ("groomFull", "brideFull"), "couple", errors)
    _str_fields(_obj(p, "families", "families", errors), ("groom", "bride"), "families", errors)
    _str_fields(_obj(p, "ceremony", "ceremony", errors), ("name",), "ceremony", errors)
    _str_fields(_obj(p, "gift", "gift", errors), ("message", "details"), "gift", errors)

    dress = _obj(p, "dressCode", "dressCode", errors)
    _str_fields(dress, ("label", "note"), "dressCode", errors)   # note: wedding-wizard
    colors = _list(dress, "colors", "dressCode.colors", errors)
    for i, c in enumerate(colors):
        if not (isinstance(c, str) and _HEX.match(c)):
            errors.append(f"dressCode.colors[{i}] must be a colour like #a13b58")

    for i, url in enumerate(_list(p, "gallery", "gallery", errors)):
        _media_url(url, f"gallery[{i}]", errors, allow_empty=False)

    for i, it in enumerate(_list(p, "schedule", "schedule", errors)):
        if not isinstance(it, dict):
            errors.append(f"schedule[{i}] must be an object")
            continue
        _str_fields(it, ("time", "label", "detail"), f"schedule[{i}]", errors)   # detail: wedding-wizard

    for i, c in enumerate(_list(p, "contacts", "contacts", errors)):
        if not isinstance(c, dict):
            errors.append(f"contacts[{i}] must be an object")
            continue
        _str_fields(c, ("name", "role", "phone"), f"contacts[{i}]", errors)

    _media_url(p.get("music"), "music", errors)


def _check_birthday(p, errors):
    _str_fields(p, ("name", "letterAr", "letterEn", "signatureEn", "signatureAr",
                    "honorific", "dateLabel"), "", errors)

    for i, q in enumerate(_list(p, "quiz", "quiz", errors)):
        if not isinstance(q, dict):
            errors.append(f"quiz[{i}] must be an object")
            continue
        opts = q.get("options")
        if opts is not None and (not isinstance(opts, list) or len(opts) > LIMITS["options"]):
            errors.append(f"quiz[{i}].options must be a list of at most {LIMITS['options']}")
        ci = q.get("correctIndex")
        if ci is not None and not isinstance(ci, int):
            errors.append(f"quiz[{i}].correctIndex must be a number")

    for i, m in enumerate(_list(p, "memories", "memories", errors)):
        if not isinstance(m, dict):
            errors.append(f"memories[{i}] must be an object")
            continue
        _media_url(m.get("url"), f"memories[{i}].url", errors)

    _media_url(p.get("videoUrl"), "videoUrl", errors)
    _media_url(p.get("musicUrl"), "musicUrl", errors)
