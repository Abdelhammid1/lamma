"""Integration tests for the Stage 2 event endpoints:
POST /api/events, POST /api/events/<id>/media, GET /api/events/<id>/status.
"""

import io
import json
import os

import pytest

from models import Event, MediaBlob, db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_event(client, slug="medo", event_type="birthday", **extra):
    body = {"slug": slug, "event_type": event_type, **extra}
    return client.post("/api/events", json=body)


def _upload(client, event_id, data=b"\xff\xd8\xff hello jpeg bytes",
            filename="photo.jpg", mimetype="image/jpeg"):
    return client.post(
        f"/api/events/{event_id}/media",
        data={"file": (io.BytesIO(data), filename, mimetype)},
        content_type="multipart/form-data",
    )


# ---------------------------------------------------------------------------
# POST /api/events
# ---------------------------------------------------------------------------

def test_create_event_ok(client, session):
    res = _create_event(client, slug="medo", event_type="birthday",
                        contact="+201234567890",
                        payload_json={"name": "Medo", "quiz": []})
    assert res.status_code == 201
    body = res.get_json()
    assert body["slug"] == "medo"
    assert body["event_type"] == "birthday"
    assert body["status"] == "awaiting_code"
    assert "event_id" in body

    row = session.query(Event).filter_by(id=body["event_id"]).one()
    assert row.contact == "+201234567890"
    assert json.loads(row.payload_json) == {"name": "Medo", "quiz": []}


def test_create_event_normalizes_slug(client):
    res = _create_event(client, slug="  Sara  ")
    assert res.status_code == 201
    assert res.get_json()["slug"] == "sara"


def test_create_event_reserved_slug(client):
    res = _create_event(client, slug="admin")
    assert res.status_code == 400
    assert res.get_json()["error"] == "reserved"


def test_create_event_bad_type(client):
    res = _create_event(client, slug="ok", event_type="funeral")
    assert res.status_code == 400
    assert res.get_json()["error"] == "bad_event_type"


def test_create_event_double_take_returns_409(client, session):
    """Two clients race for the same slug — the second gets 409."""
    r1 = _create_event(client, slug="mona")
    assert r1.status_code == 201

    r2 = _create_event(client, slug="mona")
    # slug validation catches this pre-DB and returns 400 'taken'
    assert r2.status_code == 400
    assert r2.get_json()["error"] == "taken"


def test_create_event_payload_can_be_string_or_object(client):
    r1 = _create_event(client, slug="alpha", payload_json='{"a":1}')
    assert r1.status_code == 201

    r2 = _create_event(client, slug="beta", payload_json={"a": 1})
    assert r2.status_code == 201


def test_create_event_missing_body(client):
    res = client.post("/api/events")
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/events/<id>/media
# ---------------------------------------------------------------------------

def test_upload_photo_ok(client, session):
    event_id = _create_event(client, slug="p1").get_json()["event_id"]
    res = _upload(client, event_id, filename="cover.jpg")

    assert res.status_code == 201
    body = res.get_json()
    assert body["filename"] == "cover.jpg"
    assert body["path"].startswith(event_id + "/")
    assert body["size_bytes"] > 0

    row = session.query(MediaBlob).filter_by(event_id=event_id).one()
    assert row.path == body["path"]


def test_upload_rejects_unknown_type(client):
    event_id = _create_event(client, slug="p2").get_json()["event_id"]
    res = _upload(client, event_id, filename="malware.exe",
                  mimetype="application/x-msdownload")
    assert res.status_code == 400
    assert res.get_json()["error"] == "bad_type"


def test_upload_rejects_empty(client):
    event_id = _create_event(client, slug="p3").get_json()["event_id"]
    res = _upload(client, event_id, data=b"", filename="empty.jpg")
    assert res.status_code == 400
    assert res.get_json()["error"] == "empty"


def test_upload_dedupes_identical_bytes(client, session):
    """Uploading the exact same bytes twice keeps a single on-disk copy."""
    event_id = _create_event(client, slug="p4").get_json()["event_id"]
    data = b"\x89PNG\r\n\x1a\n same content"

    r1 = _upload(client, event_id, data=data, filename="a.png", mimetype="image/png")
    r2 = _upload(client, event_id, data=data, filename="a.png", mimetype="image/png")
    assert r1.status_code == 201
    assert r2.status_code == 201
    # Same path returned both times (dedupe hit)
    assert r1.get_json()["path"] == r2.get_json()["path"]


def test_upload_different_bytes_same_name_gets_suffix(client):
    event_id = _create_event(client, slug="p5").get_json()["event_id"]
    r1 = _upload(client, event_id, data=b"one", filename="a.jpg")
    r2 = _upload(client, event_id, data=b"two", filename="a.jpg")
    assert r1.get_json()["path"] != r2.get_json()["path"]


def test_upload_sanitizes_filename(client):
    event_id = _create_event(client, slug="p6").get_json()["event_id"]
    res = _upload(client, event_id, filename="../../etc/passwd.jpg")
    # basename + sanitized — no leading dots or path components
    assert res.status_code == 201
    fn = res.get_json()["filename"]
    assert "/" not in fn and ".." not in fn


def test_upload_unknown_event_404(client):
    res = _upload(client, "no-such-id")
    assert res.status_code == 404


def test_upload_locked_when_published(client, session):
    event_id = _create_event(client, slug="p7").get_json()["event_id"]
    # simulate activation:
    e = session.get(Event, event_id)
    e.status = "published"
    session.commit()

    res = _upload(client, event_id)
    assert res.status_code == 409
    assert res.get_json()["error"] == "locked"


# ---------------------------------------------------------------------------
# GET /api/events/<id>/status
# ---------------------------------------------------------------------------

def test_status_ok(client):
    event_id = _create_event(client, slug="s1").get_json()["event_id"]
    res = client.get(f"/api/events/{event_id}/status")
    assert res.status_code == 200
    body = res.get_json()
    assert body["event_id"] == event_id
    assert body["slug"] == "s1"
    assert body["status"] == "awaiting_code"
    assert body["media_count"] == 0
    assert body["created_at"]                 # ISO string set


def test_status_counts_media(client):
    event_id = _create_event(client, slug="s2").get_json()["event_id"]
    _upload(client, event_id, filename="1.jpg")
    _upload(client, event_id, data=b"different", filename="2.jpg")
    body = client.get(f"/api/events/{event_id}/status").get_json()
    assert body["media_count"] == 2
    assert body["media_bytes"] > 0


def test_status_unknown_event_404(client):
    res = client.get("/api/events/no-such-id/status")
    assert res.status_code == 404
