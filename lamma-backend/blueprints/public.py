"""Public (unauthenticated) API endpoints — the self-serve flow.

Stages implemented here:
  Stage 1 — POST /api/check-slug
  Stage 2 — POST /api/events, POST /api/events/<id>/media,
            GET  /api/events/<id>/status
  Stage 3 — POST /api/events/<id>/activate            (added later)
"""

import json
import os
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from codes import ActivationError, normalize_code, validate_code_for_event
from github import GitHubClient, GitHubError
from models import ActivationCode, Event, MediaBlob, db
from rate_limit import limiter
from slugs import SlugError, validate
from uploads import UploadError, stage_upload, total_bytes_for_event


bp = Blueprint("public_api", __name__, url_prefix="/api")


VALID_EVENT_TYPES = frozenset({"birthday", "wedding", "invitation"})


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

@bp.post("/events")
@limiter.limit("20/hour")
def create_event():
    """Body: `{ slug, event_type, contact?, payload_json? }` →
    `{ event_id, slug, status }`.

    Slug is re-validated server-side even though the client already ran
    `/check-slug` — network races mean two clients could try the same
    slug at the same time; the DB unique constraint on `Event.slug`
    breaks the tie.

    Payload is stored as a JSON string (the client sends the full page
    content — quiz, letter, memory URLs — and the server commits it
    verbatim on activation).
    """
    body = request.get_json(silent=True) or {}

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
    )
    db.session.add(event)
    try:
        db.session.commit()
    except Exception:                # unique constraint race
        db.session.rollback()
        return jsonify(error="taken", message="That name was just taken."), 409

    return jsonify(
        event_id=event.id,
        slug=event.slug,
        event_type=event.event_type,
        status=event.status,
    ), 201


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

    On success: marks the code as used, uploads every staged media blob
    to `<event_type>/media/<slug>/<filename>`, writes
    `<event_type>/data/<slug>.json`, cleans local staging, sets
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

    # Commit to GitHub — data JSON first (single-file failure is easy to
    # recover from), then each media blob, then update DB.
    client = GitHubClient()
    prefix = event.event_type                        # 'birthday' | 'wedding' | 'invitation'
    slug   = event.slug

    try:
        json_path = f"{prefix}/data/{slug}.json"
        json_body = _serialize_event(event)          # str
        put_res   = client.put_file(
            json_path,
            content=json_body,
            message=f"{prefix}: publish {slug}",
        )
        event.published_commit_sha = (put_res.get("content") or {}).get("sha")

        for blob in db.session.query(MediaBlob).filter_by(event_id=event.id).all():
            local_path = _local_staging_path(event.id, blob.path)
            if not os.path.exists(local_path):
                # Already committed on a previous partial attempt (idempotent)
                continue
            with open(local_path, "rb") as f:
                data = f.read()
            filename = os.path.basename(blob.path)
            remote_path = f"{prefix}/media/{slug}/{filename}"
            put_res = client.put_file(
                remote_path,
                content=data,
                message=f"{prefix}: add media {slug}/{filename}",
            )
            blob.committed_sha = (put_res.get("content") or {}).get("sha")
            blob.path = remote_path

    except GitHubError as e:
        return jsonify(error="github_failed",
                       message="Could not save your page. Please try again in a moment.",
                       status=e.status), 502

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
    domain = current_app.config["PUBLIC_DOMAIN"]
    return f"https://{event.slug}.{domain}/"
