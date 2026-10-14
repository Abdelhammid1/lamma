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
from github import GitHubClient, GitHubError
from models import ActivationCode, Event, Lead, MediaBlob, User, db
from rate_limit import limiter
from slugs import SlugError, validate
from uploads import UploadError, stage_upload, total_bytes_for_event


bp = Blueprint("public_api", __name__, url_prefix="/api")


VALID_EVENT_TYPES = frozenset({
    "birthday", "birthday-elegant",
    "wedding", "wedding-noir",
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
      * If email is already registered → attach, no claim link needed.
      * If email is new → create a passwordless row with a claim token
        hash stored on it; return the RAW token to the caller so the
        admin can share the /user/claim/<token> link with the host.
        The row has no password, so simply knowing the email cannot
        take the account over — the host must prove possession of the
        token (shared via a side channel: WhatsApp / SMS / email).
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

    try:
        slug = validate(body.get("slug"), db_session=db.session)
    except SlugError as e:
        return jsonify(error=e.reason, message=e.message), 400

    contact = (body.get("contact") or "").strip()[:120] or None

    payload = body.get("payload_json")
    if payload is not None and not isinstance(payload, (dict, list, str)):
        return jsonify(error="bad_payload",
                       message="payload_json must be an object, array, or JSON string."), 400
    payload_str = None
    if payload is not None:
        payload_str = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

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
# Stage 3 — Activation (commit to GitHub)
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

    # Commit to local disk (replaces the old GitHub Contents + Git Data
    # API path). storage.commit_event is idempotent so a retry after a
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

def _serialize_event(event: Event) -> str:
    """Turn the row's `payload_json` + slug into the string we commit."""
    payload = json.loads(event.payload_json) if event.payload_json else {}
    if not isinstance(payload, dict):
        payload = {"payload": payload}
    payload.setdefault("slug", event.slug)
    payload.setdefault("event_type", event.event_type)
    payload["published_at"] = datetime.utcnow().isoformat() + "Z"
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _local_staging_path(event_id: str, blob_path: str) -> str:
    root = current_app.config["UPLOAD_STAGING_DIR"]
    # blob.path is either "<event_id>/<file>" (pre-publish) or the final
    # "<type>/media/<slug>/<file>" after publish; only the pre-publish form
    # exists locally.
    if blob_path.startswith(f"{event_id}/"):
        return os.path.join(root, blob_path)
    return os.path.join(root, event_id, os.path.basename(blob_path))


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
    PREFIXED = {"wedding", "wedding-noir", "birthday-elegant",
                "engagement", "qiraya", "sobou"}
    if event.event_type in PREFIXED:
        return f"https://lamma.{domain}/{event.event_type}/{event.slug}"
    return f"https://lamma.{domain}/{event.slug}"
