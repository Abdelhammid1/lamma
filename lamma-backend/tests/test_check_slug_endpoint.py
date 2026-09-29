"""Integration tests for POST /api/check-slug."""

from datetime import datetime

from models import Event, db


def _post(client, slug):
    return client.post("/api/check-slug", json={"slug": slug})


def test_available_slug(client):
    res = _post(client, "medo")
    assert res.status_code == 200
    body = res.get_json()
    assert body == {"available": True, "slug": "medo"}


def test_reserved_slug(client):
    res = _post(client, "admin")
    assert res.status_code == 200
    body = res.get_json()
    assert body["available"] is False
    assert body["reason"] == "reserved"


def test_bad_format_slug(client):
    res = _post(client, "has space")
    body = res.get_json()
    assert body["available"] is False
    assert body["reason"] == "bad_format"


def test_normalizes_before_checking(client):
    """UPPERCASE and whitespace should not slip past — a stray capital
    should be normalized to lowercase then checked."""
    res = _post(client, "  Medo  ")
    assert res.get_json() == {"available": True, "slug": "medo"}


def test_taken_by_published_event(client, session):
    session.add(Event(slug="mona", event_type="birthday", status="published",
                      created_at=datetime.utcnow()))
    session.commit()

    body = _post(client, "mona").get_json()
    assert body["available"] is False
    assert body["reason"] == "taken"


def test_taken_by_awaiting_code_event(client, session):
    session.add(Event(slug="hala", event_type="birthday", status="awaiting_code",
                      created_at=datetime.utcnow()))
    session.commit()

    body = _post(client, "hala").get_json()
    assert body["available"] is False
    assert body["reason"] == "taken"


def test_draft_event_does_not_hold_slug(client, session):
    """A draft that never activated shouldn't lock the slug — cleanup
    cron will expire it, and in the meantime someone else can grab it."""
    session.add(Event(slug="reem", event_type="birthday", status="draft",
                      created_at=datetime.utcnow()))
    session.commit()

    body = _post(client, "reem").get_json()
    assert body["available"] is True


def test_missing_body(client):
    res = client.post("/api/check-slug")   # no body at all
    body = res.get_json()
    assert body["available"] is False
    assert body["reason"] == "empty"


def test_empty_slug_field(client):
    res = _post(client, "")
    body = res.get_json()
    assert body["available"] is False
    assert body["reason"] == "empty"


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}
