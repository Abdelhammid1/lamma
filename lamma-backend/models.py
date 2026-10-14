"""Database models. Only Event fields relevant to Stage 1 (slug validation)
are exercised now; ActivationCode, Admin, MediaBlob, and AuditLog are
declared so the schema is complete from the start (single migration point).
"""

import uuid
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def _uuid_str() -> str:
    return str(uuid.uuid4())


class Event(db.Model):
    __tablename__ = "events"

    id                    = db.Column(db.String(36),  primary_key=True, default=_uuid_str)
    slug                  = db.Column(db.String(40),  unique=True,      nullable=False, index=True)
    event_type            = db.Column(db.String(20),  nullable=False)   # 'birthday' | 'wedding' | 'invitation'
    status                = db.Column(db.String(20),  nullable=False, default="draft")
    contact               = db.Column(db.String(120), nullable=True)
    payload_json          = db.Column(db.Text,        nullable=True)
    created_at            = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow, index=True)
    activated_at          = db.Column(db.DateTime,    nullable=True)
    published_commit_sha  = db.Column(db.String(64),  nullable=True)
    # Nullable so existing (pre-accounts) events keep working. New
    # events published through /api/events get this filled in from the
    # logged-in User or from the host_email the admin supplied.
    user_id               = db.Column(db.String(36),  db.ForeignKey("users.id"), nullable=True, index=True)


class User(db.Model):
    """Customer / host account — the person whose event is published.
    Separate from Admin so admin privileges never leak into a host's
    session even if someone reuses an email."""
    __tablename__ = "users"

    id            = db.Column(db.String(36),  primary_key=True, default=_uuid_str)
    email         = db.Column(db.String(200), unique=True, nullable=False, index=True)
    # password_hash is NULL on an admin-created account until the host
    # claims it via a single-use `claim_token_hash` link the admin
    # shares out-of-band. Signup refuses to touch an existing row, so
    # knowing the email alone can't take the account over.
    password_hash          = db.Column(db.String(200), nullable=True)
    claim_token_hash       = db.Column(db.String(200), nullable=True, index=True)
    claim_token_expires_at = db.Column(db.DateTime,    nullable=True)
    name                   = db.Column(db.String(200), nullable=True)
    phone                  = db.Column(db.String(50),  nullable=True)
    created_at             = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow)
    last_login_at          = db.Column(db.DateTime,    nullable=True)


class ActivationCode(db.Model):
    __tablename__ = "activation_codes"

    code          = db.Column(db.String(20),  primary_key=True)
    event_id      = db.Column(db.String(36),  db.ForeignKey("events.id"), nullable=True)
    used          = db.Column(db.Boolean,     nullable=False, default=False)
    used_at       = db.Column(db.DateTime,    nullable=True)
    expires_at    = db.Column(db.DateTime,    nullable=True)
    generated_by  = db.Column(db.String(36),  db.ForeignKey("admins.id"), nullable=True)
    created_at    = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow)
    notes         = db.Column(db.Text,        nullable=True)


class Admin(db.Model):
    __tablename__ = "admins"

    id             = db.Column(db.String(36),  primary_key=True, default=_uuid_str)
    email          = db.Column(db.String(120), unique=True, nullable=False)
    password_hash  = db.Column(db.String(200), nullable=False)
    created_at     = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow)
    last_login_at  = db.Column(db.DateTime,    nullable=True)


class MediaBlob(db.Model):
    __tablename__ = "media_blobs"

    id              = db.Column(db.String(36), primary_key=True, default=_uuid_str)
    event_id        = db.Column(db.String(36), db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    path            = db.Column(db.String(250), nullable=False)
    size_bytes      = db.Column(db.Integer,     nullable=False)
    content_hash    = db.Column(db.String(64),  nullable=False)
    committed_sha   = db.Column(db.String(64),  nullable=True)
    created_at      = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow)


class AuditLog(db.Model):
    __tablename__ = "audit_log"

    id            = db.Column(db.Integer,     primary_key=True, autoincrement=True)
    admin_id      = db.Column(db.String(36),  db.ForeignKey("admins.id"), nullable=True)
    action        = db.Column(db.String(80),  nullable=False)
    event_id      = db.Column(db.String(36),  nullable=True)
    details_json  = db.Column(db.Text,        nullable=True)
    created_at    = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow, index=True)


class Lead(db.Model):
    """A visitor opened /create.html but has not (yet) finished publishing.
    Logged by the public POST /api/leads so the admin can follow up with
    hosts who started a flow but didn't convert. One row per visit, not
    deduped — the dashboard shows them newest-first so repeat visits are
    obvious."""
    __tablename__ = "leads"

    id         = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    event_type = db.Column(db.String(40), nullable=False, index=True)
    user_agent = db.Column(db.String(500), nullable=True)
    ip         = db.Column(db.String(45),  nullable=True)   # IPv6 fits in 45
    referrer   = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime,   nullable=False, default=datetime.utcnow, index=True)
