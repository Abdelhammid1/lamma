"""Internal admin dashboard — Flask-Login gated.

Routes:
    GET/POST /admin/login
    POST     /admin/logout
    GET      /admin/                          → dashboard summary
    GET      /admin/events                    → all events table
    POST     /admin/events/<id>/generate-code → mint activation code
    POST     /admin/codes/generate-unbound    → mint an unbound code
    POST     /admin/events/<id>/delete        → soft-delete

JSON API (used by /create's admin modes — see js/create-form.js):
    GET      /admin/api/events/<id>           → payload for the editor
    PATCH    /admin/api/events/<id>           → update payload + re-publish
    POST     /admin/api/events/<id>/publish   → activate without a code
"""

import json
from datetime import datetime
from functools import wraps
from urllib.parse import urlparse

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required, login_user, logout_user

from auth import verify_password
from codes import generate_code, make_expiry
from github import GitHubClient, GitHubError
from models import Admin, ActivationCode, AuditLog, Event, MediaBlob, db


bp = Blueprint(
    "admin",
    __name__,
    url_prefix="/admin",
    template_folder="../templates/admin",
    static_folder="../static/admin",
)


# ---------------------------------------------------------------------------
# CSRF guard for the JSON /admin/api/* endpoints
# ---------------------------------------------------------------------------
# Session-cookie auth alone is CSRF-vulnerable: a logged-in admin visiting a
# hostile page would have their browser attach the session cookie to any
# cross-origin request the attacker triggers. Two cheap, no-token defenses
# layered here close that:
#
#   1. State-changing requests must send `Content-Type: application/json`.
#      Browsers can submit HTML forms cross-origin with
#      application/x-www-form-urlencoded or multipart/form-data without a
#      CORS preflight — this would skip it. Any `fetch(..., {headers:
#      {'Content-Type': 'application/json'}})` is a "non-simple" CORS
#      request and triggers an OPTIONS preflight, which this server does
#      not whitelist for other origins.
#
#   2. Origin/Referer, when present, must match the request's own Host.
#      This stops a same-site-but-different-port attacker, and catches any
#      edge case the Content-Type check misses.
#
# Shared across all /admin/api/* mutating endpoints below.
def _is_same_origin() -> bool:
    header = request.headers.get("Origin") or request.headers.get("Referer")
    if not header:
        # Browsers send Origin on cross-origin PATCH/POST (and nearly always
        # on same-origin ones too). Missing header is suspicious — reject.
        return False
    want = request.host.lower()
    try:
        got = urlparse(header).netloc.lower()
    except ValueError:
        return False
    return got == want


def admin_json_csrf(fn):
    """Wrap mutating JSON endpoints. GET is handled by the browser's
    same-origin policy and session-cookie SameSite default; nothing extra
    needed. Everything else must be JSON + same-origin."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            ct = (request.content_type or "").split(";", 1)[0].strip().lower()
            if ct != "application/json":
                return jsonify(error="bad_content_type",
                               message="JSON only."), 415
            if not _is_same_origin():
                return jsonify(error="csrf_blocked",
                               message="Cross-origin request rejected."), 403
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("admin.dashboard"))

    error = None
    email = ""
    if request.method == "POST":
        email = (request.form.get("email") or "").strip().lower()
        password = request.form.get("password") or ""
        row = db.session.query(Admin).filter_by(email=email).first()

        if row and verify_password(password, row.password_hash):
            from auth import AdminUser
            login_user(AdminUser(row))
            row.last_login_at = datetime.utcnow()
            db.session.commit()
            _audit(row.id, "login")
            next_url = request.args.get("next") or url_for("admin.dashboard")
            return redirect(next_url)

        error = "Invalid email or password."

    return render_template("login.html", email=email, error=error)


@bp.post("/logout")
@login_required
def logout():
    _audit(current_user.id, "logout")
    logout_user()
    return redirect(url_for("admin.login"))


# ---------------------------------------------------------------------------
# Dashboard + events list
# ---------------------------------------------------------------------------

@bp.get("/")
@login_required
def dashboard():
    counts = _status_counts()
    recent = (
        db.session.query(Event)
        .order_by(Event.created_at.desc())
        .limit(10)
        .all()
    )
    return render_template("dashboard.html", counts=counts, recent=recent)


@bp.get("/events")
@login_required
def events():
    q = (request.args.get("q") or "").strip().lower()
    status = request.args.get("status") or ""
    query = db.session.query(Event)
    if status:
        query = query.filter(Event.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(Event.slug.ilike(like))
    rows = query.order_by(Event.created_at.desc()).all()
    return render_template("events.html", events=rows, q=q, status=status)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

@bp.post("/events/<event_id>/generate-code")
@login_required
def generate_code_for_event(event_id):
    event = db.session.get(Event, event_id)
    if event is None:
        abort(404)
    if event.status == "published":
        flash("This event is already published — no new code needed.", "warn")
        return redirect(url_for("admin.events"))

    hours = request.form.get("expires_hours", type=int)
    notes = (request.form.get("notes") or "").strip() or None

    code = ActivationCode(
        code=generate_code(),
        event_id=event.id,
        expires_at=make_expiry(hours),
        generated_by=current_user.id,
        notes=notes,
    )
    db.session.add(code)
    db.session.commit()

    _audit(current_user.id, "generate_code", event.id, {"code": code.code, "hours": hours})

    # Show the code once — it's stored plaintext in the DB, but we don't
    # want to repeat it back on later page loads either.
    return render_template("code_generated.html", event=event, code=code)


@bp.post("/codes/generate-unbound")
@login_required
def generate_unbound_code():
    """Mint a code with no event_id — the customer can then use it on
    whatever slug they choose in /create. First activation binds it.

    Necessary because the customer needs a code BEFORE they click
    Publish (the button is gated on it), but events are only created
    when Publish fires. Bound codes require the admin to conjure an
    empty event first, which the UI can't do. Unbound codes break
    that chicken-and-egg.
    """
    hours = request.form.get("expires_hours", type=int)
    notes = (request.form.get("notes") or "").strip() or None

    code = ActivationCode(
        code=generate_code(),
        event_id=None,
        expires_at=make_expiry(hours),
        generated_by=current_user.id,
        notes=notes,
    )
    db.session.add(code)
    db.session.commit()

    _audit(current_user.id, "generate_unbound_code", None, {"code": code.code, "hours": hours})

    return render_template("code_generated.html", event=None, code=code)


@bp.post("/events/<event_id>/delete")
@login_required
def delete_event(event_id):
    event = db.session.get(Event, event_id)
    if event is None:
        abort(404)

    # If it was published, clean up the content wherever it was
    # written. New events live on local disk (MEDIA_SERVE_DIR /
    # DATA_SERVE_DIR); events published before commit 93df6bc still
    # have their JSON + media on GitHub. Try both — each path is
    # idempotent + best-effort, so a missing file in either backend
    # doesn't block the DB status flip.
    if event.status == "published":
        from storage import delete_event as _delete_event_files
        try:
            _delete_event_files(event.slug)
        except Exception:   # noqa: BLE001 — best-effort cleanup
            current_app.logger.exception("local-disk cleanup failed for %s", event.slug)
        # Only touch GitHub if we still have a token to do it with;
        # the install script now treats GITHUB_TOKEN as optional.
        if current_app.config.get("GITHUB_TOKEN"):
            try:
                _cascade_delete_on_github(event)
            except Exception:   # noqa: BLE001
                current_app.logger.exception("GitHub cleanup failed for %s", event.slug)

    event.status = "deleted"
    db.session.commit()
    _audit(current_user.id, "delete_event", event.id)
    flash(f"Deleted {event.slug}.", "info")
    return redirect(url_for("admin.events"))


# ---------------------------------------------------------------------------
# JSON API — used by /create's admin modes (?admin_edit, ?admin_create)
# ---------------------------------------------------------------------------
# These three endpoints give the Flask-Login-gated admin everything the
# public flow has, minus the activation-code gate. They sit under
# /admin/api/ so Flask-Login (session-cookie backed) protects them for
# free — no second auth system to maintain.

@bp.get("/api/events/<event_id>")
@login_required
def api_get_event(event_id):
    """Return the stored payload + metadata so the /create form can
    pre-fill when the admin opens `?admin_edit=<id>`."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    try:
        payload = json.loads(event.payload_json) if event.payload_json else {}
    except (TypeError, ValueError):
        payload = {}
    return jsonify(
        event_id=event.id,
        slug=event.slug,
        event_type=event.event_type,
        status=event.status,
        payload_json=payload,
        contact=event.contact,
    ), 200


@bp.patch("/api/events/<event_id>")
@login_required
@admin_json_csrf
def api_update_event(event_id):
    """Rewrite the stored payload. If the event is already published,
    also re-write <DATA_SERVE_DIR>/<slug>.json so guests see the edit
    immediately (media moves still go through the public upload path)."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if event.status == "deleted":
        return jsonify(error="deleted",
                       message="Can't edit a deleted event."), 409

    body = request.get_json(silent=True) or {}
    new_payload = body.get("payload_json")
    if not isinstance(new_payload, (dict, list, str)):
        return jsonify(error="bad_payload",
                       message="payload_json must be an object, array, or JSON string."), 400
    event.payload_json = (
        new_payload if isinstance(new_payload, str)
        else json.dumps(new_payload, ensure_ascii=False)
    )
    db.session.commit()

    # Already-published events need their on-disk JSON refreshed so
    # the guest-facing page reflects the admin's edit without having
    # to go through the activate flow again.
    if event.status == "published":
        from storage import rewrite_data_json
        try:
            rewrite_data_json(event)
        except OSError:
            current_app.logger.exception("rewrite_data_json failed for %s", event.slug)
            return jsonify(error="storage_failed",
                           message="Saved to DB but couldn't rewrite the public file."), 500

    _audit(current_user.id, "admin_edit_event", event.id)
    return jsonify(event_id=event.id, slug=event.slug, status=event.status), 200


@bp.post("/api/events/<event_id>/publish")
@login_required
@admin_json_csrf
def api_publish_event(event_id):
    """Admin override — move the event to `published` and commit media
    without needing an activation code. Mirrors the public activate
    endpoint minus the code check + without burning a code."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if event.status == "published":
        return jsonify(error="already_published",
                       message="This event is already live."), 409
    if event.status == "deleted":
        return jsonify(error="deleted",
                       message="Can't publish a deleted event."), 409

    from storage import commit_event
    try:
        blobs = db.session.query(MediaBlob).filter_by(event_id=event.id).all()
        commit_event(event, blobs, current_app.config["UPLOAD_STAGING_DIR"])
    except OSError:
        current_app.logger.exception("admin storage commit failed for %s", event.slug)
        return jsonify(error="storage_failed",
                       message="Could not save your invitation."), 502

    event.status = "published"
    event.activated_at = datetime.utcnow()
    db.session.commit()

    # Clear staging exactly like the public activate path does.
    from blueprints.public import _cleanup_staging
    _cleanup_staging(event.id)

    _audit(current_user.id, "admin_publish_event", event.id)
    # Match the public URL shape so the frontend can navigate.
    from blueprints.public import _build_public_url
    return jsonify(
        status="published",
        public_url=_build_public_url(event),
    ), 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _status_counts() -> dict:
    """Group counts by status (draft, awaiting_code, published, expired,
    deleted). Missing statuses default to 0 in the template."""
    rows = db.session.query(Event.status, db.func.count(Event.id)).group_by(Event.status).all()
    return {status: n for status, n in rows}


def _audit(admin_id, action, event_id=None, details=None):
    db.session.add(AuditLog(
        admin_id=admin_id,
        action=action,
        event_id=event_id,
        details_json=json.dumps(details) if details is not None else None,
    ))
    db.session.commit()


def _cascade_delete_on_github(event: Event) -> None:
    """Best-effort removal of JSON + every media file. Logs but doesn't
    fail the whole delete if GitHub is unhappy — the DB row still moves
    to `deleted`."""
    client = GitHubClient()
    prefix = event.event_type
    try:
        current = client.get_file(f"{prefix}/data/{event.slug}.json")
        if current:
            client.delete_file(f"{prefix}/data/{event.slug}.json", current["sha"],
                               f"{prefix}: delete {event.slug}")
    except GitHubError:
        pass

    # Media directory: list + delete each file
    try:
        items = client.list_dir(f"{prefix}/media/{event.slug}")
        for it in items or []:
            if it.get("type") == "file":
                try:
                    client.delete_file(it["path"], it["sha"],
                                       f"{prefix}: delete media {event.slug}/{it['name']}")
                except GitHubError:
                    pass
    except GitHubError:
        pass
