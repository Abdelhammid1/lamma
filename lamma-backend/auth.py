"""Password + session auth for the admin panel AND for host accounts.

Flask-Login allows one user_loader per app, so admins and hosts share
the same session cookie infrastructure but are distinguished by a
prefix on the stored id: ``"admin:<uuid>"`` vs ``"user:<uuid>"``. The
wrapper classes AdminUser / HostUser keep behaviour clear at the call
site via `isinstance(current_user, HostUser)`.
"""

from flask_login import LoginManager, UserMixin
import bcrypt

from models import Admin, User, db


login_manager = LoginManager()
# Default redirect when @login_required bounces an unauthenticated
# request — hosts hit this far more often than admins, so the host
# login page wins. Routes that must bounce to the admin login override
# this per-view with @login_required(login_url=...) if needed.
login_manager.login_view = "user.login"
login_manager.login_message = None            # we render our own form messages


class AdminUser(UserMixin):
    """Wraps an `Admin` row so Flask-Login can hand it back on every
    request. The session cookie carries ``"admin:" + id``."""

    def __init__(self, row: Admin):
        self.row = row
        self.id = row.id

    def get_id(self) -> str:
        return "admin:" + self.row.id

    @property
    def email(self) -> str:
        return self.row.email


class HostUser(UserMixin):
    """Wraps a `User` row — the customer / event host. Session cookie
    carries ``"user:" + id`` so the shared user_loader can route it
    back to the right table."""

    def __init__(self, row: User):
        self.row = row
        self.id = row.id

    def get_id(self) -> str:
        return "user:" + self.row.id

    @property
    def email(self) -> str:
        return self.row.email


@login_manager.user_loader
def _load_user(session_id: str):
    """Flask-Login passes back whatever get_id() returned — route it
    to the right table by the prefix. Unknown prefix / missing row →
    None, which Flask-Login treats as logged-out."""
    if not session_id or ":" not in session_id:
        return None
    kind, raw_id = session_id.split(":", 1)
    if kind == "admin":
        row = db.session.get(Admin, raw_id)
        return AdminUser(row) if row else None
    if kind == "user":
        row = db.session.get(User, raw_id)
        return HostUser(row) if row else None
    return None


def admin_required(fn):
    """Protect admin-only routes. @login_required alone is not enough
    because the shared user_loader can hand back a HostUser session —
    which would let a signed-in host hit /admin/* and delete / generate
    codes for anyone's events. This decorator rejects every session
    that isn't an AdminUser."""
    from functools import wraps

    from flask import abort, redirect, url_for

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("admin.login"))
        if not isinstance(current_user, AdminUser):
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


# Need current_user available at decorator-wrap time.
from flask_login import current_user  # noqa: E402


# bcrypt directly (passlib is unmaintained and crashes on bcrypt >= 5).
# Hashes are the same standard $2b$ strings passlib wrote, so every
# stored password keeps working. bcrypt only reads the first 72 bytes —
# passlib silently truncated there; bcrypt 5 raises instead, so we
# truncate explicitly to keep the same behaviour.
def _pw_bytes(plain: str) -> bytes:
    return plain.encode("utf-8")[:72]


def hash_password(plain: str) -> str:
    """One-way hash — never store plaintext."""
    return bcrypt.hashpw(_pw_bytes(plain), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    if not (plain and hashed):
        return False
    try:
        return bcrypt.checkpw(_pw_bytes(plain), hashed.encode("ascii"))
    except (TypeError, ValueError):
        return False
