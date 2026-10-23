"""End-to-end fixtures: a throwaway copy of the whole site in a real
browser.

`site` starts tools/dev_server.py (Flask + the static files on one
origin, like production) against a fresh SQLite DB and temp media dirs,
seeded with one admin, one host and a few unbound activation codes.
Nothing touches lamma-backend/instance/.

Run:  python -m pytest e2e -q          (needs: pip install playwright
                                          && python -m playwright install chromium)
"""
from __future__ import annotations

import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def site(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("lamma-e2e")
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{(tmp / 'e2e.db').as_posix()}",
        "UPLOAD_STAGING_DIR": str(tmp / "staging"),
        "MEDIA_SERVE_DIR": str(tmp / "media"),
        "DATA_SERVE_DIR": str(tmp / "data"),
        "SCHEDULER_ENABLED": "0",
        "SECRET_KEY": secrets.token_hex(16),
        "PYTHONIOENCODING": "utf-8",
    }
    creds = {
        "admin": ("admin@e2e.test", secrets.token_urlsafe(10)),
        "host": ("host@e2e.test", secrets.token_urlsafe(10)),
    }
    seed = f"""
import sys; sys.path.insert(0, {str(REPO / 'lamma-backend')!r})
from app import create_app
from models import db, Admin, User, ActivationCode
from auth import hash_password
app = create_app()
with app.app_context():
    db.session.add(Admin(email={creds['admin'][0]!r}, password_hash=hash_password({creds['admin'][1]!r})))
    db.session.add(User(email={creds['host'][0]!r}, password_hash=hash_password({creds['host'][1]!r})))
    for c in ("GOOD-CODE-0001", "GOOD-CODE-0002", "GOOD-CODE-0003", "GOOD-CODE-0004"):
        db.session.add(ActivationCode(code=c, event_id=None))
    db.session.commit()
"""
    subprocess.run([sys.executable, "-c", seed], env=env, check=True, cwd=REPO / "lamma-backend")

    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, str(REPO / "tools" / "dev_server.py"), "--port", str(port)],
        env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("dev server did not start")

    yield {"base": base, "creds": creds}
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    """A fresh browser profile per test, failing on any uncaught JS error."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.js_errors = []
    pg.on("pageerror", lambda e: pg.js_errors.append(str(e)))
    yield pg
    ctx.close()


def sign_in(page, site, who="host"):
    email, password = site["creds"][who]
    url = "/admin/login" if who == "admin" else "/user/login"
    page.goto(site["base"] + url)
    page.fill('input[name="email"]', email)
    page.fill('input[name="password"]', password)
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
