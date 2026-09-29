"""Password + session auth for the internal admin panel.

Wraps Flask-Login + passlib. The login manager, hashing, and the
`current_admin` proxy live here so the rest of the app just imports
`login_required` (from flask_login) and `hash_password / verify_password`.
"""

from flask_login import LoginManager, UserMixin
from passlib.hash import bcrypt

from models import Admin, db


login_manager = LoginManager()
login_manager.login_view = "admin.login"
login_manager.login_message = None            # we render our own form messages


class AdminUser(UserMixin):
    """Wraps an `Admin` row so Flask-Login can hand it back on every
    request. Only the id is stored in the session cookie."""

    def __init__(self, row: Admin):
        self.row = row
        self.id = row.id

    def get_id(self) -> str:
        return self.row.id

    @property
    def email(self) -> str:
        return self.row.email


@login_manager.user_loader
def _load_user(user_id: str):
    row = db.session.get(Admin, user_id)
    return AdminUser(row) if row else None


def hash_password(plain: str) -> str:
    """One-way hash — never store plaintext."""
    return bcrypt.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    if not (plain and hashed):
        return False
    try:
        return bcrypt.verify(plain, hashed)
    except (TypeError, ValueError):
        return False
