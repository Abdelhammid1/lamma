"""Invitation pages with link-preview tags.

WhatsApp, Facebook and iMessage build a link preview from the HTML the
server sends; they never run the page's JavaScript. The template
index.html files are static and identical for every couple, so a shared
link showed only "Wedding Invitation" with no names or photo.

nginx sends /<template>/<slug> here. This reads the template's own
index.html from SITE_ROOT, rewrites <title> and adds og:/twitter: tags
from the published event, and returns it. Anything this can't do
(unknown slug, not published, template file missing) is a 404, and
nginx falls back to the plain static file — so a backend problem can
never take an invitation page down.
"""

import json
import os
import re
from datetime import datetime, timedelta

from flask import Blueprint, abort, current_app
from markupsafe import escape

from models import Event, db


bp = Blueprint("pages", __name__)

TEMPLATES = ("wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard", "wedding-blue", "engagement", "qiraya", "sobou", "birthday-elegant")
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")
_TITLE_RE = re.compile(r"<title>.*?</title>", re.S | re.I)

_KIND = {
    "wedding": "Wedding", "wedding-noir": "Wedding", "wedding-burgundy": "Wedding",
    "wedding-wizard": "Wedding", "wedding-blue": "زفاف", "engagement": "Engagement",
    "qiraya": "قراية فاتحة", "sobou": "سبوع", "birthday-elegant": "Birthday",
}


@bp.get("/<any(wedding, 'wedding-noir', 'wedding-burgundy', 'wedding-wizard', 'wedding-blue', engagement, qiraya, sobou, 'birthday-elegant'):tpl>/<slug>")
@bp.get("/<any(wedding, 'wedding-noir', 'wedding-burgundy', 'wedding-wizard', 'wedding-blue', engagement, qiraya, sobou, 'birthday-elegant'):tpl>/<slug>/")
def invitation_page(tpl, slug):
    if not _SAFE_SLUG.match(slug):
        abort(404)
    event = (db.session.query(Event)
             .filter_by(slug=slug, status="published")
             .first())
    if event is None:
        abort(404)
    path = os.path.join(current_app.config["SITE_ROOT"], tpl, "index.html")
    try:
        with open(path, encoding="utf-8") as f:
            html = f.read()
    except OSError:
        abort(404)
    try:
        payload = json.loads(event.payload_json) if event.payload_json else {}
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    title, description, image = preview_fields(tpl, payload)
    # A fixed origin, never the request's Host / X-Forwarded-Host: those
    # are client-controlled, and this response is cacheable, so a forged
    # header could poison the preview everyone else gets.
    base = f"https://lamma.{current_app.config['PUBLIC_DOMAIN']}"
    tags = "\n".join([
        f'<meta property="og:type" content="website" />',
        f'<meta property="og:site_name" content="لمّة · LAMMA" />',
        f'<meta property="og:title" content="{escape(title)}" />',
        f'<meta property="og:description" content="{escape(description)}" />',
        f'<meta property="og:url" content="{escape(f"{base}/{tpl}/{slug}")}" />',
        f'<meta property="og:image" content="{escape(_absolute(image, base))}" />',
        f'<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="description" content="{escape(description)}" />',
    ])
    new_title = f"<title>{escape(title)}</title>"
    if _TITLE_RE.search(html):
        html = _TITLE_RE.sub(lambda _: new_title + "\n" + tags, html, count=1)
    else:
        html = html.replace("</head>", new_title + "\n" + tags + "\n</head>", 1)
    resp = current_app.response_class(html, mimetype="text/html")
    resp.headers["Cache-Control"] = "public, max-age=60"
    return resp


def preview_fields(tpl: str, p: dict) -> tuple[str, str, str]:
    """(title, description, image path) for one invitation's payload."""
    kind = _KIND.get(tpl, "Invitation")
    if tpl == "birthday-elegant":
        name = _s(p.get("name"))
        title = f"{name}'s Birthday" if name else "Birthday Invitation"
        memories = p.get("memories") if isinstance(p.get("memories"), list) else []
        image = next((_s(m.get("url")) for m in memories if isinstance(m, dict) and _s(m.get("url"))), "")
        return title, "You're invited 💌", image or "/logo.jpg"

    couple = p.get("couple") if isinstance(p.get("couple"), dict) else {}
    groom, bride = _s(couple.get("groom")), _s(couple.get("bride"))
    if tpl == "sobou":
        names = groom                       # the groom field holds the baby's name
    else:
        names = " & ".join(n for n in (groom, bride) if n)
    title = f"{names} · {kind}" if names else f"{kind} Invitation"

    event = p.get("event") if isinstance(p.get("event"), dict) else {}
    venue = p.get("venue") if isinstance(p.get("venue"), dict) else {}
    bits = [b for b in (_cairo_date(_s(event.get("datetimeIso"))), _s(venue.get("name"))) if b]
    description = " · ".join(bits) or "You're invited 💌"

    gallery = p.get("gallery") if isinstance(p.get("gallery"), list) else []
    image = next((_s(u) for u in gallery if _s(u)), "")
    if not image and tpl == "wedding-wizard":
        image = "/wedding-wizard/images/share.jpg"   # no gallery: the sealed letter
    return title, description, image or "/logo.jpg"


def display_name(event_type: str, payload_json: str | None) -> str:
    """The names a host recognises their invitation by ("Mohamed &
    Farida"), or "" when the payload has none."""
    try:
        p = json.loads(payload_json) if payload_json else {}
    except ValueError:
        return ""
    if not isinstance(p, dict):
        return ""
    if event_type in ("birthday", "birthday-elegant"):
        return _s(p.get("name"))
    couple = p.get("couple") if isinstance(p.get("couple"), dict) else {}
    groom, bride = _s(couple.get("groom")), _s(couple.get("bride"))
    if event_type == "sobou":
        return groom
    return " & ".join(n for n in (groom, bride) if n)


def _s(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _cairo_date(iso: str) -> str:
    """'2026-11-01T17:00:00.000Z' → 'Sunday, 1 November 2026' in Cairo time."""
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    try:
        from zoneinfo import ZoneInfo
        d = d.astimezone(ZoneInfo("Africa/Cairo"))
    except Exception:
        d = d + timedelta(hours=2)          # no tz database: Cairo is UTC+2/+3
    return f"{d.strftime('%A')}, {d.day} {d.strftime('%B %Y')}"


def _absolute(path: str, base: str) -> str:
    if path.startswith(("http://", "https://")):
        return path
    if path.startswith("//"):
        return "https:" + path
    return base + "/" + path.lstrip("/")
