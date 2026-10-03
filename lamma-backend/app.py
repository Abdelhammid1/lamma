"""Flask app factory.

Usage:
    export FLASK_APP=app:create_app
    flask db-init                    # or: python -c "from app import create_app; create_app().app_context().push(); from models import db; db.create_all()"
    flask run
"""

import os
import re
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, send_from_directory, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from auth import login_manager
from cli import register_cli
from config import Config
from models import db
from rate_limit import init_limiter
from scheduler import init_scheduler


# Slug sanity for the public-serve routes: lowercase letters, digits,
# dashes only — same shape slugs.validate() enforces. The regex is
# the fence; send_from_directory still rejects anything with .. inside.
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,200}$")

# Extension → safe content-type for /media/<slug>/<file>. Anything
# whose extension isn't in this map is 404'd before send_from_directory
# can guess a mimetype from it. svg / html / xml / pdf / js are
# deliberately excluded — serving them from this origin would be XSS.
_MEDIA_EXT_MIME = {
    "jpg":  "image/jpeg", "jpeg": "image/jpeg",
    "png":  "image/png",
    "gif":  "image/gif",
    "webp": "image/webp",
    "mp4":  "video/mp4",
    "mov":  "video/quicktime",
    "webm": "video/webm",
    "mp3":  "audio/mpeg",
    "m4a":  "audio/mp4",
    "aac":  "audio/aac",
    "ogg":  "audio/ogg",
    "wav":  "audio/wav",
}


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__, instance_path=str(Path(__file__).parent / "instance"))
    app.config.from_object(config_object)

    # Behind nginx (and Docker port-forward), every request hits Flask with
    # request.remote_addr = 127.0.0.1. That makes Flask-Limiter bucket ALL
    # clients into one shared quota — one busy tester exhausts /api/events
    # for everyone. Trust X-Forwarded-For from nginx (one proxy hop) so
    # remote_addr resolves to the real client IP.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Every writable path Flask touches needs to exist before first use.
    # MEDIA_SERVE_DIR + DATA_SERVE_DIR are the new local-disk home for
    # published invitations (replacing the GitHub Contents commit path).
    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(app.config["UPLOAD_STAGING_DIR"], exist_ok=True)
    os.makedirs(app.config["MEDIA_SERVE_DIR"],    exist_ok=True)
    os.makedirs(app.config["DATA_SERVE_DIR"],     exist_ok=True)

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

    # Public-serve routes for the local-disk media the activate flow
    # now writes. These are a backstop — the recommended path is for
    # nginx to serve both prefixes directly with an `alias` block
    # (see install.sh's NGINX_HINT). The Flask routes exist so the
    # system works end-to-end even before the sysadmin updates nginx.
    #
    # Hardening against stored XSS: these routes serve customer-
    # uploaded bytes from the same origin as /admin, so a bad actor
    # could craft an .html / .svg / .xml file and pass it as
    # Content-Type: image/* in multipart (uploads.py sniffs the
    # multipart header, not the real contents). Three layers close that:
    #   1. Hard extension allowlist — anything else 404s.
    #   2. Content-Type set explicitly from the allowlist, never from
    #      the on-disk filename sniffer, never text/html.
    #   3. nosniff + sandbox CSP so even a mismatched extension can't
    #      run script in this origin.
    @app.get("/data/<slug>.json")
    def serve_data(slug):
        if not _SAFE_SLUG.match(slug):
            abort(404)
        resp = send_from_directory(
            app.config["DATA_SERVE_DIR"], f"{slug}.json",
            mimetype="application/json", max_age=300,
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    @app.get("/media/<slug>/<filename>")
    def serve_media(slug, filename):
        if not _SAFE_SLUG.match(slug) or not _SAFE_NAME.match(filename):
            abort(404)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        mimetype = _MEDIA_EXT_MIME.get(ext)
        if mimetype is None:
            abort(404)
        resp = send_from_directory(
            os.path.join(app.config["MEDIA_SERVE_DIR"], slug),
            filename, mimetype=mimetype, max_age=604800,
        )
        # Even if some bytes slip through claiming to be an image but
        # containing HTML, the browser must not sniff + render it.
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return resp

    # Background cleanup — only under gunicorn / production, not under
    # pytest (TestConfig sets SCHEDULER_ENABLED = False).
    init_scheduler(app)

    return app


# For `flask run` and gunicorn `wsgi:app`
app = create_app()
