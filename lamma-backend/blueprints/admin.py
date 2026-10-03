"""Internal admin dashboard — Flask-Login gated.

Routes:
    GET/POST /admin/login
    POST     /admin/logout
    GET      /admin/                          → dashboard summary
    GET      /admin/events                    → all events table
    POST     /admin/events/<id>/generate-code → mint activation code
    POST     /admin/events/<id>/delete        → soft-delete
"""

import json
from datetime import datetime

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
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

    # If it was published, also remove the JSON + media from local
    # disk (the activate path writes them to MEDIA_SERVE_DIR /
    # DATA_SERVE_DIR). storage.delete_event is idempotent so a
    # retry does the right thing.
    if event.status == "published":
        from storage import delete_event as _delete_event_files
        try:
            _delete_event_files(event.slug)
        except Exception:   # noqa: BLE001 — best-effort cleanup
            current_app.logger.exception("local-disk cleanup failed for %s", event.slug)

    event.status = "deleted"
    db.session.commit()
    _audit(current_user.id, "delete_event", event.id)
    flash(f"Deleted {event.slug}.", "info")
    return redirect(url_for("admin.events"))


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
