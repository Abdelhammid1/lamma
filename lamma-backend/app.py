"""Flask app factory.

Usage:
    export FLASK_APP=app:create_app
    flask db-init                    # or: python -c "from app import create_app; create_app().app_context().push(); from models import db; db.create_all()"
    flask run
"""

import os
from pathlib import Path

from flask import Flask, jsonify, redirect, url_for

from auth import login_manager
from cli import register_cli
from config import Config
from models import db
from rate_limit import init_limiter
from scheduler import init_scheduler


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__, instance_path=str(Path(__file__).parent / "instance"))
    app.config.from_object(config_object)

    # Instance + uploads dirs need to exist before SQLite / staging writes.
    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(app.config["UPLOAD_STAGING_DIR"], exist_ok=True)

    db.init_app(app)
    login_manager.init_app(app)
    init_limiter(app)

    # Create tables on first boot (SQLite; Alembic later if we grow).
    with app.app_context():
        db.create_all()

    from blueprints.public import bp as public_bp
    from blueprints.admin  import bp as admin_bp
    app.register_blueprint(public_bp)
    app.register_blueprint(admin_bp)

    register_cli(app)

    # JSON-shaped error handler for the public API (matches the format
    # everything under /api/ already returns).
    @app.errorhandler(429)
    def _rate_limited(e):
        return jsonify(error="rate_limited",
                       message="Too many requests. Please slow down and try again in a minute."), 429

    @app.get("/api/health")
    def health():
        return jsonify(status="ok"), 200

    # Convenience: bare `/admin` (no trailing slash) → dashboard/login
    @app.get("/admin")
    def _admin_root():
        return redirect(url_for("admin.dashboard"))

    # Background cleanup — only under gunicorn / production, not under
    # pytest (TestConfig sets SCHEDULER_ENABLED = False).
    init_scheduler(app)

    return app


# For `flask run` and gunicorn `wsgi:app`
app = create_app()
