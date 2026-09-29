"""Tests for the 48h cleanup job."""

import io
import os
from datetime import datetime, timedelta

from models import Event, MediaBlob, db
from scheduler import CLEANUP_AFTER_HOURS, cleanup_expired_events


def _upload(client, event_id, filename="a.jpg"):
    return client.post(
        f"/api/events/{event_id}/media",
        data={"file": (io.BytesIO(b"\xff\xd8fake"), filename, "image/jpeg")},
        content_type="multipart/form-data",
    )


def _make_event(session, slug, status, hours_old):
    ev = Event(slug=slug, event_type="birthday", status=status)
    session.add(ev)
    session.commit()
    ev.created_at = datetime.utcnow() - timedelta(hours=hours_old)
    session.commit()
    return ev


def test_cleanup_expires_old_draft(app, session):
    ev = _make_event(session, "old-draft", "draft", hours_old=CLEANUP_AFTER_HOURS + 1)
    n = cleanup_expired_events(app)
    session.expire_all()
    assert n == 1
    assert session.get(Event, ev.id).status == "expired"


def test_cleanup_expires_old_awaiting_code(app, session):
    ev = _make_event(session, "old-await", "awaiting_code", hours_old=CLEANUP_AFTER_HOURS + 5)
    n = cleanup_expired_events(app)
    session.expire_all()
    assert n == 1
    assert session.get(Event, ev.id).status == "expired"


def test_cleanup_leaves_fresh_events_alone(app, session):
    ev = _make_event(session, "fresh", "awaiting_code", hours_old=1)
    n = cleanup_expired_events(app)
    session.expire_all()
    assert n == 0
    assert session.get(Event, ev.id).status == "awaiting_code"


def test_cleanup_does_not_touch_published(app, session):
    ev = _make_event(session, "live", "published", hours_old=CLEANUP_AFTER_HOURS + 24)
    n = cleanup_expired_events(app)
    session.expire_all()
    assert n == 0
    assert session.get(Event, ev.id).status == "published"


def test_cleanup_removes_staging_files_and_blob_rows(app, session, client):
    # Fresh event through the normal API so upload staging actually creates
    from json import dumps
    res = client.post("/api/events", json={"slug": "with-media", "event_type": "birthday",
                                            "payload_json": {"name": "x"}})
    event_id = res.get_json()["event_id"]
    _upload(client, event_id, filename="p.jpg")
    _upload(client, event_id, filename="q.jpg")

    # Verify staging dir has files
    staging = os.path.join(app.config["UPLOAD_STAGING_DIR"], event_id)
    assert os.path.isdir(staging)
    assert len(os.listdir(staging)) == 2
    assert session.query(MediaBlob).filter_by(event_id=event_id).count() == 2

    # Backdate the event
    ev = session.get(Event, event_id)
    ev.created_at = datetime.utcnow() - timedelta(hours=CLEANUP_AFTER_HOURS + 1)
    session.commit()

    cleanup_expired_events(app)
    session.expire_all()

    assert session.get(Event, event_id).status == "expired"
    assert session.query(MediaBlob).filter_by(event_id=event_id).count() == 0
    assert not os.path.isdir(staging)


def test_cleanup_frees_slug_for_reuse(app, session, client):
    """After a slug expires, someone else can claim it."""
    ev = _make_event(session, "reuse-me", "awaiting_code", hours_old=CLEANUP_AFTER_HOURS + 2)
    cleanup_expired_events(app)

    # Slug is no longer held by an active event → check-slug says available
    res = client.post("/api/check-slug", json={"slug": "reuse-me"})
    assert res.get_json()["available"] is True
