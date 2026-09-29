"""Tests for the internal admin dashboard (Flask-Login gated)."""

import json
from unittest.mock import patch

import pytest

from auth import hash_password
from models import ActivationCode, Admin, AuditLog, Event, db


# --- fixtures --------------------------------------------------------------

@pytest.fixture
def admin(session):
    row = Admin(email="me@example.com", password_hash=hash_password("s3cret-pass"))
    session.add(row)
    session.commit()
    return row


@pytest.fixture
def logged_in(client, admin):
    """Log the admin in via the real POST /admin/login route so the
    session cookie is set the same way it is in production."""
    res = client.post("/admin/login", data={"email": "me@example.com",
                                            "password": "s3cret-pass"},
                      follow_redirects=False)
    assert res.status_code in (302, 303)
    return client


def _make_event(session, slug="medo", status="awaiting_code"):
    ev = Event(slug=slug, event_type="birthday", status=status,
               payload_json=json.dumps({"name": "Medo"}))
    session.add(ev); session.commit()
    return ev


class FakeGitHub:
    """Same fake as test_activation — records calls, never hits the net."""
    def __init__(self, *a, **kw):
        self.puts, self.deletes = [], []
    def put_file(self, path, content, message, sha=None):
        self.puts.append({"path": path, "message": message, "sha": sha})
        return {"content": {"sha": "sha-" + path[:6].replace("/", "-")}}
    def get_file(self, path):
        return {"sha": "existing-sha", "size": 0, "content_bytes": b""}
    def delete_file(self, path, sha, message):
        self.deletes.append({"path": path, "sha": sha, "message": message})
        return {"commit": {"sha": "d"}}
    def list_dir(self, path):
        return []


# --- login flow ------------------------------------------------------------

def test_login_page_renders(client):
    res = client.get("/admin/login")
    assert res.status_code == 200
    assert b"LAMMA" in res.data


def test_login_success_redirects_to_dashboard(client, admin):
    res = client.post("/admin/login", data={"email": "me@example.com",
                                            "password": "s3cret-pass"},
                      follow_redirects=False)
    assert res.status_code == 302
    assert res.location.endswith("/admin/")


def test_login_wrong_password_reprompts(client, admin):
    res = client.post("/admin/login", data={"email": "me@example.com",
                                            "password": "wrong"})
    assert res.status_code == 200
    assert b"Invalid email or password" in res.data


def test_login_normalizes_email(client, admin):
    res = client.post("/admin/login", data={"email": "  ME@Example.com  ",
                                            "password": "s3cret-pass"},
                      follow_redirects=False)
    assert res.status_code == 302


def test_dashboard_requires_login(client):
    res = client.get("/admin/", follow_redirects=False)
    assert res.status_code == 302
    assert "/admin/login" in res.location


def test_events_requires_login(client):
    res = client.get("/admin/events", follow_redirects=False)
    assert res.status_code == 302


def test_logout_clears_session(logged_in, client):
    res = client.post("/admin/logout", follow_redirects=False)
    assert res.status_code == 302
    # Now dashboard should redirect back to login
    res2 = client.get("/admin/", follow_redirects=False)
    assert "/admin/login" in res2.location


# --- dashboard + events list ----------------------------------------------

def test_dashboard_shows_counts(logged_in, session):
    for status, n in [("published", 2), ("awaiting_code", 3), ("draft", 1)]:
        for i in range(n):
            _make_event(session, slug=f"{status}-{i}", status=status)
    res = logged_in.get("/admin/")
    assert res.status_code == 200
    body = res.data.decode()
    assert "Published" in body
    assert ">2<" in body               # published count = 2


def test_events_page_filters_by_status(logged_in, session):
    _make_event(session, slug="a", status="published")
    _make_event(session, slug="b", status="draft")
    res = logged_in.get("/admin/events?status=published")
    body = res.data.decode()
    assert "<code>a</code>" in body
    assert "<code>b</code>" not in body


def test_events_page_search_by_slug(logged_in, session):
    _make_event(session, slug="medo")
    _make_event(session, slug="sara")
    res = logged_in.get("/admin/events?q=med")
    body = res.data.decode()
    assert "<code>medo</code>" in body
    assert "<code>sara</code>" not in body


# --- generate code --------------------------------------------------------

def test_generate_code_creates_row(logged_in, session):
    ev = _make_event(session, slug="p1")
    res = logged_in.post(f"/admin/events/{ev.id}/generate-code",
                         data={"expires_hours": 48, "notes": "instapay 123"})
    assert res.status_code == 200
    body = res.data.decode()
    # Big code is shown on the page
    assert "big-code" in body

    rows = session.query(ActivationCode).filter_by(event_id=ev.id).all()
    assert len(rows) == 1
    assert rows[0].notes == "instapay 123"
    assert rows[0].expires_at is not None
    assert rows[0].generated_by                  # bound to admin


def test_generate_code_records_audit(logged_in, session, admin):
    ev = _make_event(session, slug="p2")
    logged_in.post(f"/admin/events/{ev.id}/generate-code", data={"expires_hours": 24})

    logs = session.query(AuditLog).filter_by(action="generate_code").all()
    assert len(logs) == 1
    assert logs[0].admin_id == admin.id
    assert logs[0].event_id == ev.id


def test_generate_code_refuses_for_published(logged_in, session):
    ev = _make_event(session, slug="p3", status="published")
    res = logged_in.post(f"/admin/events/{ev.id}/generate-code",
                         data={}, follow_redirects=False)
    assert res.status_code == 302              # flashed + redirected to events
    assert session.query(ActivationCode).filter_by(event_id=ev.id).count() == 0


def test_generate_code_unknown_event_404(logged_in):
    res = logged_in.post("/admin/events/nope/generate-code", data={})
    assert res.status_code == 404


# --- delete event ---------------------------------------------------------

def test_delete_soft_deletes(logged_in, session):
    ev = _make_event(session, slug="del1")
    res = logged_in.post(f"/admin/events/{ev.id}/delete", follow_redirects=False)
    assert res.status_code == 302
    session.expire_all()
    assert session.get(Event, ev.id).status == "deleted"


def test_delete_published_attempts_github_cleanup(logged_in, session):
    ev = _make_event(session, slug="del2", status="published")
    with patch("blueprints.admin.GitHubClient", FakeGitHub) as _:
        res = logged_in.post(f"/admin/events/{ev.id}/delete", follow_redirects=False)
    assert res.status_code == 302
    session.expire_all()
    assert session.get(Event, ev.id).status == "deleted"


# --- audit log records login / logout -------------------------------------

def test_login_records_audit(client, admin, session):
    client.post("/admin/login", data={"email": "me@example.com", "password": "s3cret-pass"})
    logs = session.query(AuditLog).filter_by(action="login").all()
    assert len(logs) == 1
    assert logs[0].admin_id == admin.id


# --- CLI: create-admin ---------------------------------------------------

def test_cli_create_admin(app, session):
    from cli import create_admin
    runner = app.test_cli_runner()
    res = runner.invoke(create_admin, ["--email", "new@x.com", "--password", "longenough"])
    assert res.exit_code == 0
    assert "Created admin" in res.output
    assert session.query(Admin).filter_by(email="new@x.com").count() == 1


def test_cli_create_admin_short_password_rejected(app):
    from cli import create_admin
    runner = app.test_cli_runner()
    res = runner.invoke(create_admin, ["--email", "x@x.com", "--password", "short"])
    assert res.exit_code != 0
    assert "at least 8" in res.output.lower()


def test_cli_create_admin_duplicate_rejected(app, session, admin):
    from cli import create_admin
    runner = app.test_cli_runner()
    res = runner.invoke(create_admin, ["--email", "me@example.com", "--password", "longenough"])
    assert res.exit_code != 0
    assert "already exists" in res.output.lower()


# --- health check independent of the DB (kept from earlier stages)
def test_admin_root_redirects_to_dashboard(client):
    """Bare /admin (no slash) → dashboard (which then redirects to login)."""
    res = client.get("/admin", follow_redirects=False)
    assert res.status_code in (301, 302, 308)
