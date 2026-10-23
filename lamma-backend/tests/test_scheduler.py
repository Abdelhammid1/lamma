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
    from tests.conftest import sign_in_host
    sign_in_host(client)
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


def test_scheduler_lock_lives_in_the_writable_state_dir(app, monkeypatch, tmp_path):
    """The code dir is read-only under systemd; the lock must not go there."""
    from scheduler import scheduler_lock_path
    app.config["UPLOAD_STAGING_DIR"] = str(tmp_path / "uploads")
    app.config["SCHEDULER_LOCK_FILE"] = ""
    assert scheduler_lock_path(app) == str(tmp_path / "uploads" / ".locks" / "scheduler.lock")
    app.config["SCHEDULER_LOCK_FILE"] = str(tmp_path / "custom.lock")
    assert scheduler_lock_path(app) == str(tmp_path / "custom.lock")


def test_unwritable_lock_does_not_stop_the_scheduler(app, tmp_path, monkeypatch):
    import scheduler as sch
    try:
        import fcntl  # noqa: F401
    except ImportError:
        return                               # Windows: lock is a no-op anyway
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x")
    app.config["SCHEDULER_LOCK_FILE"] = str(blocker / "scheduler.lock")   # parent is a file
    assert sch._claim_scheduler_lock(app) is True
