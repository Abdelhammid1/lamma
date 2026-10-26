"""Public (unauthenticated) API endpoints — the self-serve flow.

Stages implemented here:
  Stage 1 — POST /api/check-slug
  Stage 2 — POST /api/events, POST /api/events/<id>/media,
            GET  /api/events/<id>/status
  Stage 3 — POST /api/events/<id>/activate            (added later)
"""

import json
import os
import re
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from flask_login import current_user

from auth import AdminUser, HostUser
from codes import ActivationError, normalize_code, validate_code_for_event
from models import ActivationCode, Event, Lead, MediaBlob, Rsvp, User, View, Wish, db
from rate_limit import limiter
from slugs import SlugError, validate
from slugs import normalize as normalize_slug
from uploads import UploadError, event_upload_lock, stage_upload, total_bytes_for_event


bp = Blueprint("public_api", __name__, url_prefix="/api")


VALID_EVENT_TYPES = frozenset({
    "birthday", "birthday-elegant",
    "wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard",
    "engagement", "qiraya", "sobou", "invitation",
})


# --------------------------------------------------------------------------
# Lead tracking — anyone who opened /create.html, before they commit
# --------------------------------------------------------------------------

@bp.post("/leads")
@limiter.limit("30/minute")
def record_lead():
    """Log a visit to the create form so the admin can follow up with
    hosts who didn't make it all the way to publish. Fire-and-forget
    from the frontend — the response is always 204; the frontend never
    waits on it or shows errors.

    Body: `{ "event_type": "<type>" }`. Unknown or missing types are
    normalized to "unknown" rather than rejected — this is a telemetry
    endpoint, not a validation gate."""
    body = request.get_json(silent=True) or {}
    t = (body.get("event_type") or "unknown").strip().lower()[:40]
    row = Lead(
        event_type=t or "unknown",
        user_agent=(request.headers.get("User-Agent") or "")[:500] or None,
        ip=request.remote_addr,
        referrer=(request.headers.get("Referer") or "")[:500] or None,
    )
    db.session.add(row)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        # Still a 204 — telemetry failures must not break the UX.
    return ("", 204)


# --------------------------------------------------------------------------
# Public RSVP write — guests on a published invitation page
# --------------------------------------------------------------------------

@bp.post("/invitations/<slug>/rsvp")
@limiter.limit("20/hour")
def submit_rsvp(slug):
    """Guest-facing RSVP submission. The invitation page JS POSTs here
    instead of writing to Firestore so the owning host can read the
    responses back through the backend without Firestore rules letting
    the whole world read PII.

    Body: `{ "name": "...", "attending": "yes"|"no", "guestCount": 1 }`.
    Returns 201 on success. Rejects if the event isn't published, or if
    required fields are missing or malformed."""
    body = request.get_json(silent=True) or {}

    event = db.session.query(Event).filter_by(slug=slug).first()
    if event is None or event.status != "published":
        return jsonify(error="not_published", message="This invitation isn't open for RSVPs."), 404

    name = (body.get("name") or "").strip()[:200]
    attending = (body.get("attending") or "").strip().lower()
    try:
        guest_count = int(body.get("guestCount") or 1)
    except (TypeError, ValueError):
        guest_count = 1
    guest_count = max(1, min(20, guest_count))

    if not name:
        return jsonify(error="missing_name", message="Please tell us your name."), 400
    if attending not in ("yes", "no"):
        return jsonify(error="bad_attending", message='attending must be "yes" or "no".'), 400

    row = Rsvp(
        event_id=event.id,
        event_slug=event.slug,
        name=name,
        attending=attending,
        guest_count=guest_count if attending == "yes" else 1,
        ip=request.remote_addr,
        user_agent=(request.headers.get("User-Agent") or "")[:500] or None,
    )
    db.session.add(row)
    db.session.commit()
    return jsonify(ok=True, id=row.id), 201


# --------------------------------------------------------------------------
# Public wishes write + read — guestbook on the invitation page
# --------------------------------------------------------------------------

@bp.post("/invitations/<slug>/wishes")
@limiter.limit("30/hour")
def submit_wish(slug):
    """Guest-facing guestbook submission. The invitation page JS POSTs
    here instead of writing to Firestore so the owning host can read
    the wishes back through the backend without us publishing PII in a
    collection anyone can read.

    Body: `{ "name": "...", "message": "..." }`. Returns 201 on success.
    Rejects if the event isn't published, or if required fields are
    missing. Name is clamped to 200 chars, message to 1000."""
    body = request.get_json(silent=True) or {}

    event = db.session.query(Event).filter_by(slug=slug).first()
    if event is None or event.status != "published":
        return jsonify(error="not_published", message="This invitation isn't open for wishes."), 404

    name    = (body.get("name")    or "").strip()[:200]
    message = (body.get("message") or "").strip()[:1000]

    if not name:
        return jsonify(error="missing_name",    message="Please tell us your name."), 400
    if not message:
        return jsonify(error="missing_message", message="Please leave a wish."), 400

    row = Wish(
        event_id=event.id,
        event_slug=event.slug,
        name=name,
        message=message,
        ip=request.remote_addr,
        user_agent=(request.headers.get("User-Agent") or "")[:500] or None,
    )
    db.session.add(row)
    db.session.commit()
    return jsonify(ok=True, id=row.id), 201


@bp.get("/invitations/<slug>/wishes")
@limiter.limit("120/hour")
def list_wishes(slug):
    """Public read — the invitation page polls this instead of using
    Firestore's onSnapshot. Returns the newest `limit` wishes (default
    50, capped at 200) so clients render the feed immediately."""
    try:
        limit = max(1, min(200, int(request.args.get("limit", "50"))))
    except (TypeError, ValueError):
        limit = 50
    # By the live event's id, not the slug: a slug freed by an expired
    # or deleted event can be taken by a new couple, who must not see
    # the previous couple's guestbook.
    event = (db.session.query(Event)
             .filter_by(slug=slug, status="published")
             .first())
    if event is None:
        return jsonify(wishes=[]), 200
    rows = (db.session.query(Wish)
            .filter(Wish.event_id == event.id)
            .order_by(Wish.created_at.desc())
            .limit(limit)
            .all())
    return jsonify(wishes=[{
        "id":         w.id,
        "name":       w.name,
        "message":    w.message,
        "created_at": w.created_at.isoformat() + "Z" if w.created_at else None,
    } for w in rows]), 200


# --------------------------------------------------------------------------
# View ping — one lightweight record per page open
# --------------------------------------------------------------------------

import hashlib
from datetime import date as _date

_BOT_UA_RE = re.compile(
    r"\b(bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|monitoring|axios|python-urllib|curl|wget)\b",
    re.IGNORECASE,
)


def _visitor_hash(slug: str) -> str:
    """sha256 of (slug + ip + ua + day-stamp + app secret). Keeps PII
    out of the DB — only a derived hash is stored, bucketed per day so
    the same visitor across two days produces two different hashes,
    which is how we count "unique today" vs "unique lifetime"."""
    secret = (current_app.config.get("SECRET_KEY") or "lamma-dev-salt")
    day = _date.today().isoformat()
    raw = f"{slug}|{request.remote_addr or ''}|{request.headers.get('User-Agent') or ''}|{day}|{secret}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@bp.post("/invitations/<slug>/view")
@limiter.limit("240/hour")
def record_view(slug):
    """Lightweight view ping fired by the invitation page on load via
    navigator.sendBeacon. Always returns 204 — the browser doesn't
    inspect the body and we don't want to leak event metadata to a
    scanner.

    Skips bot user-agents (crude but good enough), ?preview=1 cover
    previews, and visits where the host-cookie is present (the host
    pre-viewing their own event shouldn't inflate their own counters).
    De-dupes to one "unique" record per visitor_hash per day via a
    cheap SELECT; a second same-day visit still records a row but with
    is_unique=False so we can tell apart raw hits from unique visitors.
    """
    # Signal from the page or the admin preview flow — don't record.
    if request.args.get("preview") == "1":
        return ("", 204)

    ua = request.headers.get("User-Agent") or ""
    if _BOT_UA_RE.search(ua):
        return ("", 204)

    # Host preview exemption — if the request carries the host's
    # session cookie and that user owns this event, skip the count.
    if current_user.is_authenticated:
        from auth import HostUser, AdminUser
        event = db.session.query(Event).filter_by(slug=slug).first()
        if event is not None:
            if isinstance(current_user, AdminUser):
                return ("", 204)
            if isinstance(current_user, HostUser) and event.user_id == current_user.id:
                return ("", 204)

    event = db.session.query(Event).filter_by(slug=slug).first()
    # Still record the raw hit even if the event isn't published yet —
    # it's useful signal for pre-launch share tests. But if there's no
    # row at all, there's nothing to attribute, so drop it.
    if event is None:
        return ("", 204)

    vh = _visitor_hash(slug)
    today = datetime.utcnow().date()
    # Count a visitor as "unique" only once per calendar day.
    already_today = db.session.query(View.id).filter(
        View.event_slug == slug,
        View.visitor_hash == vh,
        View.created_at >= datetime(today.year, today.month, today.day),
    ).first()

    row = View(
        event_id=event.id,
        event_slug=slug,
        visitor_hash=vh,
        is_unique=(already_today is None),
    )
    db.session.add(row)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
    return ("", 204)


# --------------------------------------------------------------------------
# Stage 1 — Slug availability check
# --------------------------------------------------------------------------

@bp.post("/check-slug")
@limiter.limit("30/minute")
def check_slug():
    """Body: `{ "slug": "medo" }` → `{ "available": bool, "reason"?, "message"? }`.

    Always returns HTTP 200 with a JSON body; `available=false` includes
    a short `reason` code + human `message`. Non-JSON bodies get the same
    "empty slug" answer."""
    body = request.get_json(silent=True) or {}
    raw = body.get("slug")

    try:
        slug = validate(raw, db_session=db.session)
    except SlugError as e:
        return jsonify(available=False, reason=e.reason, message=e.message), 200

    return jsonify(available=True, slug=slug), 200


@bp.post("/check-code")
@limiter.limit("20/hour")
def check_code():
    """Body: `{ "code": "AH3F-9K2P-XZLB", "event_id"? }` →
    `{ "valid": bool, "reason"?, "message"? }`.

    Lets /create reject a bad code BEFORE it reserves the name and
    uploads every file. Doesn't burn the code — activate still re-checks
    and burns it. Same rate limit as a human retyping a code; 12 random
    characters can't be guessed at 20/hour."""
    body = request.get_json(silent=True) or {}
    raw_code = normalize_code(body.get("code"))
    if not raw_code:
        return jsonify(valid=False, reason="missing_code",
                       message="Please enter your activation code."), 200
    code_row = db.session.get(ActivationCode, raw_code)
    try:
        # A brand-new event has no id yet; an unbound code is fine for
        # it, a code minted for some other event is not.
        validate_code_for_event(code_row, body.get("event_id") or "")
    except ActivationError as e:
        return jsonify(valid=False, reason=e.reason, message=e.message), 200
    return jsonify(valid=True), 200


# --------------------------------------------------------------------------
# Stage 2 — Event creation, media upload, status polling
# --------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


import hashlib
import secrets
from datetime import timedelta

# Claim-token lifespan — admin should share the link soon after
# creating the account; 7 days is comfortable but still forces a
# refresh if the host sits on an unopened email.
_CLAIM_TOKEN_TTL_DAYS = 7


def _mint_claim_token() -> tuple[str, str, datetime]:
    """Generate a single-use high-entropy claim token. Returns
    (raw_token_for_the_url, sha256_hash_for_the_db, expiry)."""
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()
    expires = datetime.utcnow() + timedelta(days=_CLAIM_TOKEN_TTL_DAYS)
    return raw, digest, expires


def _resolve_owner_user_id(body) -> tuple[str | None, str | None, tuple | None]:
    """Figure out which User owns this new event.

    - Logged-in host → (own_id, None, None).
    - Logged-in admin → must supply `host_email`.
      * If email is new → create a passwordless row with a claim token
        hash stored on it; return the RAW token to the caller so the
        admin can share the /user/claim/<token> link with the host.
      * If email already belongs to a registered host → REFUSE unless
        the admin passed `host_email_confirm_existing: true`. This
        closes the pre-registration squat: anyone could sign up with
        a guessed email ahead of the admin and silently receive the
        host's wedding without the admin noticing. The admin must
        acknowledge they intend to attach to an already-existing
        account (and verify the account belongs to the right person)
        before we hand over an event. The 409 response tells the
        frontend to prompt the admin.
    - Nobody logged in → 401.

    Returns (user_id, raw_claim_token or None, error_tuple or None).
    """
    if current_user.is_authenticated and isinstance(current_user, HostUser):
        return current_user.id, None, None
    if current_user.is_authenticated and isinstance(current_user, AdminUser):
        email = (body.get("host_email") or "").strip().lower()
        if not _EMAIL_RE.match(email):
            return None, None, (jsonify(error="host_email_required",
                                  message="Enter the host's email so the invitation lands in their account."), 400)
        existing = db.session.query(User).filter_by(email=email).first()
        if existing:
            # Only attach to an existing account on an explicit admin
            # confirmation — this is the whole account-squat guard.
            if not bool(body.get("host_email_confirm_existing")):
                return None, None, (jsonify(
                    error="existing_account",
                    email=email,
                    has_password=bool(existing.password_hash),
                    message="That email is already registered. Confirm you want to attach this event to the existing account by re-submitting with host_email_confirm_existing: true.",
                ), 409)
            return existing.id, None, None
        raw, digest, expires = _mint_claim_token()
        row = User(email=email, claim_token_hash=digest, claim_token_expires_at=expires)
        db.session.add(row)
        db.session.commit()
        return row.id, raw, None
    return None, None, (jsonify(error="auth_required",
                          message="Please sign in to publish an invitation."), 401)


@bp.post("/events")
@limiter.limit("20/hour")
def create_event():
    """Body: `{ slug, event_type, contact?, payload_json?, host_email? }`
    → `{ event_id, slug, status }`.

    Requires a logged-in host (preferred) or a logged-in admin who
    supplied `host_email` so the event has an owner. See
    `_resolve_owner_user_id` for the rules.

    Slug is re-validated server-side even though the client already ran
    `/check-slug` — network races mean two clients could try the same
    slug at the same time; the DB unique constraint on `Event.slug`
    breaks the tie.

    Payload is stored as a JSON string (the client sends the full page
    content — quiz, letter, memory URLs — and the server commits it
    verbatim on activation).
    """
    body = request.get_json(silent=True) or {}

    user_id, claim_token, err = _resolve_owner_user_id(body)
    if err:
        return err

    event_type = (body.get("event_type") or "").strip().lower()
    if event_type not in VALID_EVENT_TYPES:
        return jsonify(error="bad_event_type",
                       message=f"event_type must be one of {sorted(VALID_EVENT_TYPES)}"), 400

    contact = (body.get("contact") or "").strip()[:120] or None

    payload = body.get("payload_json")
    if payload is not None and not isinstance(payload, (dict, list, str)):
        return jsonify(error="bad_payload",
                       message="payload_json must be an object, array, or JSON string."), 400
    payload_str = None
    if payload is not None:
        from payload_schema import validate_payload
        problems = validate_payload(event_type, payload)
        if problems:
            return jsonify(error="bad_payload", message="; ".join(problems[:3]),
                           problems=problems), 400
        payload_str = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    # Retry after a failed publish (wrong code, dropped upload, reload):
    # the name is already held by this same owner's unfinished event.
    # Hand that event back with the new payload instead of "taken", and
    # drop its staged files — the client re-uploads the current ones.
    resumed = _resume_own_event(normalize_slug(body.get("slug")), user_id,
                                event_type, contact, payload_str)
    if resumed is not None:
        return jsonify(event_id=resumed.id, slug=resumed.slug,
                       event_type=resumed.event_type, status=resumed.status,
                       resumed=True), 200

    try:
        slug = validate(body.get("slug"), db_session=db.session)
    except SlugError as e:
        return jsonify(error=e.reason, message=e.message), 400

    event = Event(
        slug=slug,
        event_type=event_type,
        status="awaiting_code",     # created + awaiting an activation code
        contact=contact,
        payload_json=payload_str,
        user_id=user_id,
    )
    db.session.add(event)
    try:
        db.session.commit()
    except Exception:                # unique constraint race
        db.session.rollback()
        return jsonify(error="taken", message="That name was just taken."), 409

    resp = {
        "event_id":   event.id,
        "slug":       event.slug,
        "event_type": event.event_type,
        "status":     event.status,
    }
    # Admin-created a brand-new account for the host → include the
    # one-shot claim URL so the admin can forward it (WhatsApp, SMS,
    # etc.) and the host can set their own password.
    if claim_token:
        resp["claim_url"] = "/user/claim/" + claim_token
    return jsonify(resp), 201


@bp.post("/events/<event_id>/media")
def upload_media(event_id):
    """Multipart upload — one file per request keeps retry logic simple.

    Form field name: `file`. Response: `{ path, size_bytes, filename }`.
    """
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found", message="Event not found."), 404
    if event.status not in ("draft", "awaiting_code"):
        return jsonify(error="locked",
                       message="Cannot upload to a published or expired event."), 409

    file_storage = request.files.get("file")
    with event_upload_lock(event_id):
        try:
            meta = stage_upload(event_id, file_storage)
        except UploadError as e:
            return jsonify(error=e.reason, message=e.message), 400

        blob = MediaBlob(
            event_id=event_id,
            path=meta["path"],
            size_bytes=meta["size_bytes"],
            content_hash=meta["content_hash"],
        )
        db.session.add(blob)
        db.session.commit()

    return jsonify(
        path=meta["path"],
        filename=meta["filename"],
        size_bytes=meta["size_bytes"],
    ), 201


@bp.get("/events/<event_id>/status")
def event_status(event_id):
    """Lightweight poll — used by the client's 'waiting for code' screen."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found", message="Event not found."), 404

    return jsonify(
        event_id=event.id,
        slug=event.slug,
        event_type=event.event_type,
        status=event.status,
        created_at=event.created_at.isoformat() if event.created_at else None,
        activated_at=event.activated_at.isoformat() if event.activated_at else None,
        media_count=db.session.query(MediaBlob).filter_by(event_id=event_id).count(),
        media_bytes=total_bytes_for_event(event_id),
    ), 200


# --------------------------------------------------------------------------
# Stage 3 — Activation (publish to local disk)
# --------------------------------------------------------------------------

@bp.post("/events/<event_id>/activate")
@limiter.limit("10/hour")
def activate_event(event_id):
    """Body: `{ "code": "AH3F-9K2P-XZLB" }`.

    On success: marks the code as used, moves every staged media blob
    into `<MEDIA_SERVE_DIR>/<slug>/<filename>`, writes
    `<DATA_SERVE_DIR>/<slug>.json`, cleans local staging, sets
    `event.status = 'published'`, returns `{ status, public_url }`.

    On any failure the event's status is unchanged so the user can retry.
    """
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found", message="Event not found."), 404
    if event.status == "published":
        return jsonify(error="already_published",
                       message="This page is already live."), 409
    if event.status not in ("draft", "awaiting_code"):
        return jsonify(error="locked",
                       message="This event can no longer be activated."), 409

    body = request.get_json(silent=True) or {}
    raw_code = normalize_code(body.get("code"))
    if not raw_code:
        return jsonify(error="missing_code", message="Please enter your activation code."), 400

    code_row = db.session.get(ActivationCode, raw_code)
    try:
        validate_code_for_event(code_row, event.id)
    except ActivationError as e:
        return jsonify(error=e.reason, message=e.message), 400

    # Commit to local disk. storage.commit_event is idempotent so a retry after a
    # partial move does the right thing.
    from storage import commit_event
    try:
        blobs = db.session.query(MediaBlob).filter_by(event_id=event.id).all()
        commit_event(event, blobs, current_app.config["UPLOAD_STAGING_DIR"])
    except OSError as e:
        current_app.logger.exception("storage commit failed")
        return jsonify(error="storage_failed",
                       message="Could not save your invitation. Please try again."), 502

    # DB updates + code burn
    code_row.used = True
    code_row.used_at = datetime.utcnow()
    event.status = "published"
    event.activated_at = datetime.utcnow()
    db.session.commit()

    _cleanup_staging(event.id)

    return jsonify(
        status="published",
        public_url=_build_public_url(event),
    ), 200


# --------------------------------------------------------------------------
# Internal helpers
# --------------------------------------------------------------------------

def _resume_own_event(slug, user_id, event_type, contact, payload_str):
    """Return this owner's unfinished event holding `slug`, refreshed
    with the new submission, or None when there isn't one."""
    if not slug or not user_id:
        return None
    event = (db.session.query(Event)
             .filter(Event.slug == slug,
                     Event.user_id == user_id,
                     Event.status.in_(("draft", "awaiting_code")))
             .first())
    if event is None:
        return None
    event.event_type = event_type
    event.contact = contact
    event.payload_json = payload_str
    # The previous attempt's staged files are superseded by this one's
    # uploads — leaving them would let activate commit stale files and
    # count them against the media quota.
    db.session.query(MediaBlob).filter_by(event_id=event.id).delete()
    db.session.commit()
    _cleanup_staging(event.id)
    return event


def _cleanup_staging(event_id: str) -> None:
    root = current_app.config["UPLOAD_STAGING_DIR"]
    d = os.path.join(root, event_id)
    if not os.path.isdir(d):
        return
    for name in os.listdir(d):
        try:
            os.remove(os.path.join(d, name))
        except OSError:
            pass
    try:
        os.rmdir(d)
    except OSError:
        pass


def _build_public_url(event: Event) -> str:
    """Where the guest actually opens the invitation.

    Routing on the lamma vhost splits by prefix: /wedding/* serves
    wedding/index.html (which bootstraps via wedding/js/bootstrap.js),
    while /* catches birthdays and lands on birthday.html. Handing
    out the birthday-style /<slug> for a wedding renders the demo
    (Ahmed & Sara) because birthday.html's loader doesn't understand
    the wedding schema.
    """
    # Prefix-routed templates — each lives under /<type>/<slug> and is
    # served by its own index.html via _redirects. The birthday + any
    # unknown type stays on the /<slug> catch-all.
    domain  = current_app.config["PUBLIC_DOMAIN"]
    PREFIXED = {"wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard", "birthday-elegant",
                "engagement", "qiraya", "sobou"}
    if event.event_type in PREFIXED:
        return f"https://lamma.{domain}/{event.event_type}/{event.slug}"
    return f"https://lamma.{domain}/{event.slug}"
