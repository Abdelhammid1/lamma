"""Integration tests for POST /api/events/:id/activate.

The GitHubClient is replaced by a fake that records every call, so we
verify the *right* paths / bodies are sent without actually hitting
api.github.com.
"""

import io
import json
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from codes import generate_code
from models import ActivationCode, Event, MediaBlob, db


# ---------------------------------------------------------------------------
# Fake GitHub client — records every write, always returns a fake commit sha
# ---------------------------------------------------------------------------

_INSTANCES: list = []


class FakeGitHub:
    def __init__(self, *args, **kwargs):
        self.puts: list = []
        _INSTANCES.append(self)

    def put_file(self, path, content, message, sha=None):
        # Copy bytes so we can assert on them
        blob = bytes(content) if isinstance(content, (bytes, bytearray)) else content
        self.puts.append({"path": path, "content": blob, "message": message, "sha": sha})
        return {"content": {"sha": "fake-" + path[:8].replace("/", "-")}}


class FailingGitHub(FakeGitHub):
    def put_file(self, *args, **kwargs):
        from github import GitHubError
        raise GitHubError(500, "boom", "http://api/x")


@pytest.fixture(autouse=True)
def _reset_instances():
    _INSTANCES.clear()
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(session, slug="medo", event_type="birthday", status="awaiting_code",
                payload=None):
    payload = payload or {"name": "Medo", "quiz": [{"question": "q?", "options": ["a", "b"], "correctIndex": 0}]}
    ev = Event(
        slug=slug,
        event_type=event_type,
        status=status,
        payload_json=json.dumps(payload),
    )
    session.add(ev)
    session.commit()
    return ev


def _make_code(session, event_id=None, used=False, expires_at=None):
    row = ActivationCode(
        code=generate_code(),
        event_id=event_id,
        used=used,
        expires_at=expires_at,
    )
    session.add(row)
    session.commit()
    return row


def _upload(client, event_id, data=b"\xff\xd8fake jpeg", filename="1.jpg"):
    return client.post(
        f"/api/events/{event_id}/media",
        data={"file": (io.BytesIO(data), filename, "image/jpeg")},
        content_type="multipart/form-data",
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_activate_success_writes_json_and_media(client, session):
    ev = _make_event(session, slug="medo")
    code = _make_code(session, event_id=ev.id)
    _upload(client, ev.id, filename="cover.jpg")

    with patch("blueprints.public.GitHubClient", FakeGitHub):
        res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})

    assert res.status_code == 200
    assert res.get_json()["status"] == "published"
    assert res.get_json()["public_url"].endswith("/")

    gh = _INSTANCES[0]
    put_paths = [p["path"] for p in gh.puts]

    # JSON goes to <type>/data/<slug>.json
    assert "birthday/data/medo.json" in put_paths
    # Photo goes to <type>/media/<slug>/<filename>
    assert any(p.startswith("birthday/media/medo/") and p.endswith(".jpg") for p in put_paths)

    # DB reflects publication
    session.expire_all()
    ev = session.get(Event, ev.id)
    code = session.get(ActivationCode, code.code)
    assert ev.status == "published"
    assert ev.activated_at is not None
    assert ev.published_commit_sha
    assert code.used is True
    assert code.used_at is not None


def test_activate_missing_code(client, session):
    ev = _make_event(session)
    res = client.post(f"/api/events/{ev.id}/activate", json={})
    assert res.status_code == 400
    assert res.get_json()["error"] == "missing_code"


def test_activate_invalid_code(client, session):
    ev = _make_event(session)
    res = client.post(f"/api/events/{ev.id}/activate", json={"code": "XXXX-XXXX-XXXX"})
    assert res.status_code == 400
    assert res.get_json()["error"] == "not_found"


def test_activate_reused_code_rejected(client, session):
    ev = _make_event(session)
    code = _make_code(session, event_id=ev.id, used=True)
    res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})
    assert res.status_code == 400
    assert res.get_json()["error"] == "used"


def test_activate_expired_code(client, session):
    ev = _make_event(session)
    past = datetime.utcnow() - timedelta(hours=1)
    code = _make_code(session, event_id=ev.id, expires_at=past)
    res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})
    assert res.status_code == 400
    assert res.get_json()["error"] == "expired"


def test_activate_wrong_event_code(client, session):
    ev1 = _make_event(session, slug="a")
    ev2 = _make_event(session, slug="b")
    code = _make_code(session, event_id=ev2.id)      # bound to ev2
    res = client.post(f"/api/events/{ev1.id}/activate", json={"code": code.code})
    assert res.status_code == 400
    assert res.get_json()["error"] == "wrong_event"


def test_activate_universal_code(client, session):
    """A code with event_id=None should work for any not-yet-published event."""
    ev = _make_event(session, slug="uni")
    code = _make_code(session, event_id=None)

    with patch("blueprints.public.GitHubClient", FakeGitHub):
        res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})
    assert res.status_code == 200


def test_activate_already_published(client, session):
    ev = _make_event(session, status="published")
    code = _make_code(session, event_id=ev.id)
    res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})
    assert res.status_code == 409
    assert res.get_json()["error"] == "already_published"


def test_activate_unknown_event(client):
    res = client.post("/api/events/nope/activate", json={"code": "X"})
    assert res.status_code == 404


def test_activate_github_failure_returns_502_and_keeps_event(client, session):
    ev = _make_event(session)
    code = _make_code(session, event_id=ev.id)

    with patch("blueprints.public.GitHubClient", FailingGitHub):
        res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})

    assert res.status_code == 502
    assert res.get_json()["error"] == "github_failed"

    # DB state unchanged so the user can retry
    session.expire_all()
    assert session.get(Event, ev.id).status == "awaiting_code"
    assert session.get(ActivationCode, code.code).used is False


def test_activate_normalizes_hyphenless_code(client, session):
    ev = _make_event(session)
    code = _make_code(session, event_id=ev.id)
    raw = code.code.replace("-", "").lower()          # what a user might type

    with patch("blueprints.public.GitHubClient", FakeGitHub):
        res = client.post(f"/api/events/{ev.id}/activate", json={"code": raw})
    assert res.status_code == 200
