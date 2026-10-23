"""Integration tests for POST /api/events/:id/activate."""

import io
import json
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from codes import generate_code
from models import ActivationCode, Event, MediaBlob, db


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

def test_activate_success_writes_json_and_media(app, client, session, tmp_path):
    # Publishing writes to the server's own disk (storage.commit_event).
    app.config["MEDIA_SERVE_DIR"] = str(tmp_path / "media")
    app.config["DATA_SERVE_DIR"] = str(tmp_path / "data")
    ev = _make_event(session, slug="medo")
    code = _make_code(session, event_id=ev.id)
    _upload(client, ev.id, filename="cover.jpg")

    res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})

    assert res.status_code == 200
    assert res.get_json()["status"] == "published"
    assert res.get_json()["public_url"].endswith("/medo")

    data = json.loads((tmp_path / "data" / "medo.json").read_text(encoding="utf-8"))
    assert data["slug"] == "medo" and data["name"] == "Medo"
    assert (tmp_path / "media" / "medo" / "cover.jpg").is_file()

    session.expire_all()
    ev = session.get(Event, ev.id)
    code = session.get(ActivationCode, code.code)
    assert ev.status == "published"
    assert ev.activated_at is not None
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


def test_activate_storage_failure_returns_502_and_keeps_event(client, session):
    ev = _make_event(session)
    code = _make_code(session, event_id=ev.id)

    with patch("storage.commit_event", side_effect=OSError("disk full")):
        res = client.post(f"/api/events/{ev.id}/activate", json={"code": code.code})

    assert res.status_code == 502
    assert res.get_json()["error"] == "storage_failed"

    # DB state unchanged so the user can retry
    session.expire_all()
    assert session.get(Event, ev.id).status == "awaiting_code"
    assert session.get(ActivationCode, code.code).used is False


def test_activate_normalizes_hyphenless_code(client, session):
    ev = _make_event(session)
    code = _make_code(session, event_id=ev.id)
    raw = code.code.replace("-", "").lower()          # what a user might type

    res = client.post(f"/api/events/{ev.id}/activate", json={"code": raw})
    assert res.status_code == 200
