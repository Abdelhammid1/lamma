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
from datetime import datetime, timedelta
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

from auth import verify_password, admin_required
from codes import generate_code, make_expiry
from github import GitHubClient, GitHubError
from models import Admin, ActivationCode, AuditLog, Event, MediaBlob, Rsvp, View, Wish, db


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
@admin_required
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
@admin_required
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


@bp.get("/leads")
@admin_required
def leads():
    """List of visitors who opened /create.html but haven't published
    yet. Newest first. Uses a simple page size since lead volume is low;
    once it isn't, swap for keyset paging on created_at."""
    from models import Lead
    event_type = (request.args.get("type") or "").strip().lower()
    query = db.session.query(Lead)
    if event_type:
        query = query.filter(Lead.event_type == event_type)
    rows = query.order_by(Lead.created_at.desc()).limit(500).all()
    # Count per template type for the summary bar.
    counts = {}
    for t, n in db.session.query(Lead.event_type, db.func.count(Lead.id)).group_by(Lead.event_type).all():
        counts[t] = n
    return render_template("leads.html", leads=rows, counts=counts, filter_type=event_type)


@bp.get("/events/<event_id>/responses")
@admin_required
def event_responses(event_id):
    """Admin view of RSVPs + guestbook wishes for one event.

    The data lives in Firestore (invitations/<slug>/{rsvps,guestbook}),
    not in the backend DB — guests write directly from the public
    invitation page. The template renders a shell + loads a tiny client
    script that queries Firestore and renders the lists; a "Copy as
    text" button on the page formats everything for pasting into
    WhatsApp / email to send to the host.
    """
    event = db.session.get(Event, event_id)
    if event is None:
        abort(404)
    return render_template("responses.html", event=event)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

@bp.post("/events/<event_id>/generate-code")
@admin_required
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
@admin_required
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
@admin_required
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

def _can_access_event(event) -> bool:
    """Admin → always. Host → only their own events. Everyone else → no."""
    if not current_user.is_authenticated:
        return False
    from auth import AdminUser, HostUser
    if isinstance(current_user, AdminUser):
        return True
    if isinstance(current_user, HostUser):
        return event.user_id == current_user.id
    return False


@bp.get("/api/events/<event_id>/wishes")
@login_required
def api_event_wishes(event_id):
    """Wishes for one event, newest first. Admin can read any event;
    host can only read their own via _can_access_event."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only read responses for your own invitations."), 403

    rows = (db.session.query(Wish)
            .filter(Wish.event_id == event.id)
            .order_by(Wish.created_at.desc())
            .all())

    return jsonify(
        slug=event.slug,
        event_status=event.status,
        summary={"count": len(rows)},
        wishes=[{
            "id":         w.id,
            "name":       w.name,
            "message":    w.message,
            "created_at": w.created_at.isoformat() + "Z" if w.created_at else None,
        } for w in rows],
    ), 200


@bp.get("/api/events/<event_id>/views")
@login_required
def api_event_views(event_id):
    """Per-event view stats: total hits, unique-lifetime (distinct
    visitor_hashes), unique-today, unique-7d. Owner-or-admin."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only read stats for your own invitations."), 403

    from sqlalchemy import distinct, func
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    week_start  = today_start - timedelta(days=7)

    base = db.session.query(View).filter(View.event_id == event.id)
    total  = base.count()
    uniq_lifetime = base.with_entities(func.count(distinct(View.visitor_hash))).scalar() or 0
    uniq_today = base.filter(View.created_at >= today_start).with_entities(
        func.count(distinct(View.visitor_hash))
    ).scalar() or 0
    uniq_7d = base.filter(View.created_at >= week_start).with_entities(
        func.count(distinct(View.visitor_hash))
    ).scalar() or 0

    return jsonify(
        slug=event.slug,
        event_status=event.status,
        total=total,
        unique_lifetime=uniq_lifetime,
        unique_today=uniq_today,
        unique_7d=uniq_7d,
    ), 200


@bp.get("/api/events/<event_id>/rsvps")
@login_required
def api_event_rsvps(event_id):
    """RSVPs for one event, newest first. Admin can read any event;
    host can only read their own (via _can_access_event). Returns a
    small summary alongside so the host dashboard preview can show
    counts without a second request."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only read responses for your own invitations."), 403

    rows = (db.session.query(Rsvp)
            .filter(Rsvp.event_id == event.id)
            .order_by(Rsvp.created_at.desc())
            .all())

    yes = [r for r in rows if r.attending == "yes"]
    no  = [r for r in rows if r.attending == "no"]
    total_guests = sum(max(1, r.guest_count or 1) for r in yes)

    return jsonify(
        slug=event.slug,
        event_status=event.status,
        summary={
            "attending": len(yes),
            "declined":  len(no),
            "guests":    total_guests,
        },
        rsvps=[{
            "id":          r.id,
            "name":        r.name,
            "attending":   r.attending,
            "guest_count": r.guest_count,
            "created_at":  r.created_at.isoformat() + "Z" if r.created_at else None,
        } for r in rows],
    ), 200


@bp.get("/api/events/<event_id>")
@login_required
def api_get_event(event_id):
    """Return the stored payload + metadata so the /create form can
    pre-fill when the admin opens `?admin_edit=<id>` or the host opens
    the Edit link from their dashboard."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only edit your own invitations."), 403
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
    immediately (media moves still go through the public upload path).

    Owner-aware: the admin can edit any event; a host can only edit
    the events they own."""
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only edit your own invitations."), 403
    if event.status == "deleted":
        return jsonify(error="deleted",
                       message="Can't edit a deleted event."), 409

    body = request.get_json(silent=True) or {}
    new_payload = body.get("payload_json")
    if not isinstance(new_payload, (dict, list, str)):
        return jsonify(error="bad_payload",
                       message="payload_json must be an object, array, or JSON string."), 400
    # A blob: URL only exists inside the editor's browser tab — saving one
    # is how farhetna lost its song and a gallery photo. Refuse instead of
    # publishing a link no guest can open (a stale cached create-form.js
    # would otherwise keep doing it).
    if _contains_blob_url(new_payload):
        return jsonify(error="blob_url",
                       message="A photo or song wasn't uploaded. Reload the editor (Ctrl+Shift+R) and save again."), 400
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

    # Only the admin's own edits land in the admin audit log; a host
    # editing their own event doesn't need to show up there (and the
    # FK admin_id → admins.id would reject a host UUID anyway).
    from auth import AdminUser
    if isinstance(current_user, AdminUser):
        _audit(current_user.id, "admin_edit_event", event.id)
    return jsonify(event_id=event.id, slug=event.slug, status=event.status), 200


def _contains_blob_url(obj) -> bool:
    if isinstance(obj, str):
        return "blob:" in obj
    if isinstance(obj, dict):
        return any(_contains_blob_url(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_contains_blob_url(v) for v in obj)
    return False


@bp.post("/api/events/<event_id>/media")
@login_required
def api_upload_event_media(event_id):
    """Edit-mode upload — one file per request, form field `file`.
    Returns `{ url }` to bake into the payload before the PATCH.

    Published events get the file straight into <MEDIA_SERVE_DIR>/<slug>/
    so the URL works the moment the PATCH lands. Unpublished ones keep it
    in staging with a MediaBlob row; activate moves it like any other.

    Multipart, so admin_json_csrf (JSON-only) can't wrap it — the
    same-origin check alone blocks cross-site form posts."""
    import os
    import shutil
    from sqlalchemy import func
    from uploads import MAX_EVENT_BYTES, UploadError, stage_upload

    if not _is_same_origin():
        return jsonify(error="csrf_blocked",
                       message="Cross-origin request rejected."), 403
    event = db.session.get(Event, event_id)
    if event is None:
        return jsonify(error="not_found"), 404
    if not _can_access_event(event):
        return jsonify(error="forbidden",
                       message="You can only edit your own invitations."), 403
    if event.status == "deleted":
        return jsonify(error="deleted",
                       message="Can't edit a deleted event."), 409

    # stage_upload's quota only sees files still in staging — published
    # edits move straight out of it, so count every blob ever recorded
    # for this event instead.
    used = db.session.query(
        func.coalesce(func.sum(MediaBlob.size_bytes), 0)
    ).filter(MediaBlob.event_id == event.id).scalar() or 0
    if used + (request.content_length or 0) > MAX_EVENT_BYTES:
        return jsonify(error="event_quota",
                       message=f"This event's media limit is {MAX_EVENT_BYTES // (1024 * 1024)} MB."), 413

    try:
        meta = stage_upload(event.id, request.files.get("file"))
    except UploadError as e:
        return jsonify(error=e.reason, message=e.message), 400

    filename = meta["filename"]
    blob_path = meta["path"]
    if event.status == "published":
        staging_root = current_app.config["UPLOAD_STAGING_DIR"]
        media_dir = os.path.join(current_app.config["MEDIA_SERVE_DIR"], event.slug)
        os.makedirs(media_dir, exist_ok=True)
        src = os.path.join(staging_root, event.id, filename)
        dst = os.path.join(media_dir, filename)
        if os.path.exists(dst):
            # Never overwrite a committed file — the old payload (or a
            # guest's cached page) may still point at it.
            stem, ext = os.path.splitext(filename)
            filename = f"{stem}-{meta['content_hash'][:8]}{ext}"
            dst = os.path.join(media_dir, filename)
        tmp = dst + ".tmp"
        try:
            shutil.copy2(src, tmp)
            os.replace(tmp, dst)
        except OSError:
            current_app.logger.exception("edit upload commit failed for %s", event.slug)
            return jsonify(error="storage_failed",
                           message="Couldn't save the file. Please try again."), 500
        try:
            os.remove(src)
        except OSError:
            pass
        blob_path = f"{event.slug}/{filename}"

    db.session.add(MediaBlob(
        event_id=event.id,
        path=blob_path,
        size_bytes=meta["size_bytes"],
        content_hash=meta["content_hash"],
    ))
    db.session.commit()
    return jsonify(url=f"/media/{event.slug}/{filename}",
                   size_bytes=meta["size_bytes"]), 201


@bp.post("/api/events/<event_id>/publish")
@admin_required
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
