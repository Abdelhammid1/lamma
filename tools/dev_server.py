"""Run the whole site locally on one origin, the way production serves it.

Production: nginx serves the static files, proxies /api, /admin, /user
and the invitation pages to Flask, and falls back to the static page
when Flask 404s. This does the same in one process so the frontend's
same-origin calls (/api/..., /user/me) work on localhost.

Usage (from the repo root):
    python tools/dev_server.py            # http://127.0.0.1:8010
    python tools/dev_server.py --port 9000

Uses lamma-backend/instance/ for the SQLite DB, uploads, /data and
/media — the same defaults as `flask run`. Not for production.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "lamma-backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("SITE_ROOT", str(REPO))

from flask import request, send_from_directory  # noqa: E402

from app import create_app  # noqa: E402

TEMPLATE_DIRS = ("wedding", "wedding-noir", "wedding-burgundy", "engagement", "qiraya", "sobou", "birthday-elegant")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")
_BACKEND_PREFIXES = ("/api/", "/admin", "/user", "/data/", "/media/")


def static_for(path: str) -> str | None:
    """Repo-relative file for a URL path, mirroring _redirects + nginx."""
    clean = path.lstrip("/")
    if clean == "":
        return "index.html"
    if clean == "create":
        return "create.html"
    target = REPO / clean
    if target.is_file():
        return clean
    if target.is_dir() and (target / "index.html").is_file():
        return f"{clean.rstrip('/')}/index.html"
    first = clean.split("/", 1)[0]
    if first in TEMPLATE_DIRS:
        return f"{first}/index.html"           # /wedding/<slug> → template
    if "/" not in clean.rstrip("/") and _SLUG.match(clean.rstrip("/")):
        return "birthday.html"                 # /<slug> → classic birthday
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8010)
    args = ap.parse_args()

    app = create_app()

    @app.errorhandler(404)
    def _static_fallback(e):
        # Backend 404s stay 404s; anything else is a static file, like
        # nginx's `location /` and the @static_invitation fallback.
        if request.method != "GET" or request.path.startswith(_BACKEND_PREFIXES):
            return e
        rel = static_for(request.path)
        if rel is None:
            return e
        resp = send_from_directory(REPO, rel, max_age=0)
        resp.status_code = 200
        return resp

    print(f"lamma dev server: http://127.0.0.1:{args.port}  (repo: {REPO})")
    app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
