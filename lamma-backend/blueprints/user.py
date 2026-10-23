"""Host (customer) auth + dashboard.

Mirrors the admin blueprint but scoped to a single user: the host can
only see / edit / view responses for events whose `user_id` matches
their session. Email + password only in v1 — no verification, no reset
flow (admin can reset manually via SQL or a future flow).

Routes:
    GET/POST  /user/signup           → create a new user, auto-login
    GET/POST  /user/login            → sign in, redirect ?next= or /user/
    POST      /user/logout
    GET       /user/                 → dashboard listing their events
    GET       /user/events/<id>/responses → RSVP + wishes for own event
    GET       /user/claim/<claim_token>   → set a password on an
            admin-created account that has no password yet (admin
            emails this link to the host).
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta
from functools import wraps
from urllib.parse import urlparse

from flask import (
    Blueprint, abort, flash, jsonify, redirect, render_template, request,
    url_for,
)
from flask_login import current_user, login_required, login_user, logout_user

from auth import HostUser, hash_password, verify_password
from models import Event, User, db
from rate_limit import limiter


bp = Blueprint("user", __name__, url_prefix="/user", template_folder="../templates")


# --------------------------------------------------------------------------
# CSRF for form-encoded POST routes
# --------------------------------------------------------------------------
#
# The auth endpoints below take application/x-www-form-urlencoded bodies
# which CORS does NOT preflight — so without an origin check a form on
# evil.com could cross-site POST to /user/login (session fixation),
# /user/logout (log the host out), or worst case /user/claim/<token>
# with an attacker-chosen password (full account takeover of a host
# whose claim link leaked).
#
# Flask's session cookie is also set to SameSite=Lax in config.py, so
# modern browsers already drop the cookie on a cross-site form POST,
# but this origin check is the belt to that suspenders — closes legacy
# browsers + any future proxy/middleware that strips SameSite.
#
# @csrf_safe_post:
#   - GET / HEAD / OPTIONS pass through unchecked
#   - POST / PUT / PATCH / DELETE must carry an Origin or Referer header
#     whose netloc matches request.host — otherwise 403

def csrf_safe_post(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            header = request.headers.get("Origin") or request.headers.get("Referer")
            if not header:
                abort(403, description="Missing Origin / Referer on state-changing request.")
            try:
                got = urlparse(header).netloc.lower()
            except ValueError:
                abort(403, description="Malformed Origin / Referer.")
            if got != request.host.lower():
                abort(403, description="Cross-origin request rejected.")
        return fn(*args, **kwargs)
    return wrapper


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def host_required(fn):
    """Protect routes that are for hosts (not admins). An admin visiting
    a /user/ route is logged in — Flask-Login would wave them through —
    so we add this extra check that rejects admins. They can use /admin
    instead."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("user.login", next=request.path))
        if not isinstance(current_user, HostUser):
            # Admin session hitting a /user/ page — bounce to /admin.
            return redirect(url_for("admin.dashboard"))
        return fn(*args, **kwargs)
    return wrapper


def _safe_next(raw: str | None) -> str:
    """Only accept same-site relative paths as a ?next= target so a
    malicious link can't bounce the host off to another site after
    login. Hardened against the usual browser-parser-vs-urlparse gap:
      - reject control characters, backslashes (`\\evil.com`)
        and newlines before any check — browsers may normalize them
        differently than Python's urlparse
      - also re-parse the slash-normalized string so `/\\evil.com`
        (which some engines treat as scheme-relative) is caught
      - require a leading single "/" with no "//"
    Fallback: dashboard."""
    if not raw:
        return url_for("user.dashboard")
    # Any backslash, newline, or control character → suspicious.
    if "\\" in raw or any(ord(c) < 32 or ord(c) == 127 for c in raw):
        return url_for("user.dashboard")
    try:
        parsed = urlparse(raw)
    except ValueError:
        return url_for("user.dashboard")
    if parsed.scheme or parsed.netloc:
        return url_for("user.dashboard")
    if not raw.startswith("/") or raw.startswith("//"):
        return url_for("user.dashboard")
    # Belt-and-suspenders: re-parse with slashes normalized so a hidden
    # scheme-relative form in a mixed-slash input is still caught.
    normalized = raw.replace("\\", "/")
    try:
        reparsed = urlparse(normalized)
    except ValueError:
        return url_for("user.dashboard")
    if reparsed.netloc:
        return url_for("user.dashboard")
    return raw


# --------------------------------------------------------------------------
# Signup
# --------------------------------------------------------------------------

@bp.route("/signup", methods=["GET", "POST"])
@csrf_safe_post
@limiter.limit("30/hour", methods=["POST"])
def signup():
    # Already signed in? Jump to the dashboard.
    if current_user.is_authenticated and isinstance(current_user, HostUser):
        return redirect(url_for("user.dashboard"))

    if request.method == "GET":
        return render_template(
            "user/signup.html",
            email=request.args.get("email", ""),
            next_url=request.args.get("next", ""),
            error=None,
        )

    email    = (request.form.get("email")    or "").strip().lower()
    password = (request.form.get("password") or "")
    name     = (request.form.get("name")     or "").strip()[:200] or None
    next_raw = request.form.get("next")

    def _err(msg):
        return render_template(
            "user/signup.html",
            email=email, next_url=next_raw or "", error=msg,
        ), 400

    if not _EMAIL_RE.match(email):
        return _err("Please enter a valid email.")
    if len(password) < 8:
        return _err("Password must be at least 8 characters.")

    existing = db.session.query(User).filter_by(email=email).first()
    if existing:
        # Admin-created passwordless row? The host MUST claim it via the
        # /user/claim/<token> link the admin shared, not by hitting
        # signup with the right email — otherwise anyone who learns the
        # host's email can grab the account before them. Return the same
        # message in both cases so an attacker can't enumerate which
        # addresses are already linked to events.
        return _err("An account with that email already exists. Sign in — or if the admin set one up for you, use the claim link they shared.")

    row = User(email=email, password_hash=hash_password(password), name=name)
    db.session.add(row)
    db.session.commit()
    row.last_login_at = datetime.utcnow()
    db.session.commit()
    login_user(HostUser(row))

    return redirect(_safe_next(next_raw))


# --------------------------------------------------------------------------
# Claim — set a password on an admin-created passwordless account
# --------------------------------------------------------------------------

@bp.route("/claim/<token>", methods=["GET", "POST"])
@csrf_safe_post
@limiter.limit("20/hour", methods=["POST"])
def claim(token):
    """One-shot claim link the admin shares with a host whose account
    was pre-created. Validates a sha256 hash of the token against the
    stored one + checks the TTL, then lets the host pick a password
    and auto-logs them in. The token is cleared on success so the link
    cannot be reused."""
    digest = hashlib.sha256(token.encode("ascii")).hexdigest() if token else ""
    row = (db.session.query(User)
             .filter_by(claim_token_hash=digest)
             .first()) if digest else None
    valid = (
        row is not None
        and row.claim_token_expires_at is not None
        and row.claim_token_expires_at > datetime.utcnow()
    )

    if request.method == "GET":
        return render_template(
            "user/claim.html",
            valid=valid, email=(row.email if valid else None), error=None,
        )

    if not valid:
        return render_template(
            "user/claim.html",
            valid=False, email=None,
            error="This claim link is invalid or has expired. Ask the admin for a new one.",
        ), 400

    password = (request.form.get("password") or "")
    if len(password) < 8:
        return render_template(
            "user/claim.html",
            valid=True, email=row.email,
            error="Password must be at least 8 characters.",
        ), 400

    # Burn the token + set the password + log in.
    row.password_hash          = hash_password(password)
    row.claim_token_hash       = None
    row.claim_token_expires_at = None
    row.last_login_at          = datetime.utcnow()
    db.session.commit()
    login_user(HostUser(row))
    return redirect(url_for("user.dashboard"))


# --------------------------------------------------------------------------
# Login / logout
# --------------------------------------------------------------------------

@bp.route("/login", methods=["GET", "POST"])
@csrf_safe_post
@limiter.limit("30/hour", methods=["POST"])
def login():
    if current_user.is_authenticated and isinstance(current_user, HostUser):
        return redirect(url_for("user.dashboard"))

    if request.method == "GET":
        return render_template(
            "user/login.html",
            email=request.args.get("email", ""),
            next_url=request.args.get("next", ""),
            error=None,
        )

    email    = (request.form.get("email")    or "").strip().lower()
    password = (request.form.get("password") or "")
    next_raw = request.form.get("next")

    def _err(msg):
        return render_template(
            "user/login.html",
            email=email, next_url=next_raw or "", error=msg,
        ), 400

    row = db.session.query(User).filter_by(email=email).first() if _EMAIL_RE.match(email) else None
    if not row or not row.password_hash or not verify_password(password, row.password_hash):
        return _err("That email and password don't match.")

    row.last_login_at = datetime.utcnow()
    db.session.commit()
    login_user(HostUser(row))
    return redirect(_safe_next(next_raw))


@bp.post("/logout")
@csrf_safe_post
def logout():
    logout_user()
    return redirect(url_for("user.login"))


# --------------------------------------------------------------------------
# Dashboard — the host's events
# --------------------------------------------------------------------------

@bp.get("/")
@host_required
def dashboard():
    rows = (db.session.query(Event)
            .filter(Event.user_id == current_user.id)
            .order_by(Event.created_at.desc())
            .all())
    # Hours left before the cleanup job expires an unactivated event and
    # deletes its uploads — shown on the card so it's never a surprise.
    from scheduler import CLEANUP_AFTER_HOURS
    now = datetime.utcnow()
    hours_left = {
        ev.id: max(0, int(((ev.created_at + timedelta(hours=CLEANUP_AFTER_HOURS)) - now).total_seconds() // 3600))
        for ev in rows
        if ev.status in ("draft", "awaiting_code") and ev.created_at
    }
    return render_template("user/dashboard.html", events=rows, hours_left=hours_left)


@bp.get("/events/<event_id>/responses")
@host_required
def event_responses(event_id):
    event = db.session.get(Event, event_id)
    if event is None or event.user_id != current_user.id:
        abort(404)
    return render_template("user/responses.html", event=event)


# --------------------------------------------------------------------------
# API — "is the current session a host and if so what's their email?"
# Used by /create.html on load to decide whether to redirect to signin
# or let the host proceed.
# --------------------------------------------------------------------------

@bp.get("/me")
def whoami():
    if current_user.is_authenticated and isinstance(current_user, HostUser):
        return jsonify(
            authenticated=True,
            email=current_user.email,
            id=current_user.id,
        ), 200
    return jsonify(authenticated=False), 200
