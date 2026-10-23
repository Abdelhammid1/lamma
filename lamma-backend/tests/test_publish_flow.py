"""Batch 1 of the audit: retry after a bad code, activate from the
dashboard, and admin password links."""

import hashlib
import json
from datetime import datetime, timedelta

import pytest

from auth import hash_password
from models import ActivationCode, Admin, Event, MediaBlob, User, db

_ORIGIN = {"Origin": "http://localhost"}


@pytest.fixture
def host(client, session):
    res = client.post("/user/signup", data={"email": "host@example.com",
                                            "password": "s3cret-pass"},
                      headers=_ORIGIN)
    assert res.status_code in (302, 303)
    return session.query(User).filter_by(email="host@example.com").one()


def _code(session, event_id=None, **kw):
    row = ActivationCode(code="AAAA-BBBB-CCCC", event_id=event_id, **kw)
    session.add(row); session.commit()
    return row


# --- #1: check the code before publishing; retry resumes -------------------

def test_check_code_valid_unbound(client, session):
    _code(session)
    res = client.post("/api/check-code", json={"code": "aaaabbbbcccc"})
    assert res.get_json() == {"valid": True}


def test_check_code_unknown(client):
    res = client.post("/api/check-code", json={"code": "ZZZZ-ZZZZ-ZZZZ"})
    body = res.get_json()
    assert body["valid"] is False and body["reason"] == "not_found"


def test_check_code_used_and_bound_elsewhere(client, session):
    ev = Event(slug="other", event_type="wedding", status="awaiting_code")
    session.add(ev); session.commit()
    _code(session, event_id=ev.id)
    res = client.post("/api/check-code", json={"code": "AAAA-BBBB-CCCC"})
    assert res.get_json()["reason"] == "wrong_event"
    session.get(ActivationCode, "AAAA-BBBB-CCCC").used = True
    session.commit()
    res = client.post("/api/check-code", json={"code": "AAAA-BBBB-CCCC"})
    assert res.get_json()["reason"] == "used"


def test_retry_resumes_own_unfinished_event(client, session, host):
    first = client.post("/api/events", json={"slug": "farah", "event_type": "wedding",
                                              "payload_json": {"v": 1}})
    assert first.status_code == 201
    eid = first.get_json()["event_id"]
    session.add(MediaBlob(event_id=eid, path=f"{eid}/old.jpg", size_bytes=1, content_hash="x" * 64))
    session.commit()

    again = client.post("/api/events", json={"slug": "farah", "event_type": "wedding",
                                              "payload_json": {"v": 2}})
    assert again.status_code == 200
    body = again.get_json()
    assert body["event_id"] == eid and body["resumed"] is True
    ev = session.get(Event, eid)
    assert json.loads(ev.payload_json) == {"v": 2}
    assert session.query(MediaBlob).filter_by(event_id=eid).count() == 0


def test_someone_elses_unfinished_name_is_still_taken(client, session, host):
    session.add(Event(slug="farah", event_type="wedding", status="awaiting_code"))
    session.commit()
    res = client.post("/api/events", json={"slug": "farah", "event_type": "wedding"})
    assert res.status_code == 400
    assert res.get_json()["error"] == "taken"


# --- #2: activate from the dashboard ---------------------------------------

def test_dashboard_offers_activate_with_time_left(client, session, host):
    ev = Event(slug="farah", event_type="wedding", status="awaiting_code",
               user_id=host.id, created_at=datetime.utcnow() - timedelta(hours=10))
    session.add(ev); session.commit()
    html = client.get("/user/").get_data(as_text=True)
    assert 'class="activate-form"' in html
    assert "within 37 h" in html or "within 38 h" in html


def test_dashboard_marks_expired(client, session, host):
    session.add(Event(slug="farah", event_type="wedding", status="expired", user_id=host.id))
    session.commit()
    html = client.get("/user/").get_data(as_text=True)
    assert "Expired" in html and 'class="activate-form"' not in html


# --- #3: admin password links -----------------------------------------------

def test_admin_password_link_sets_and_resets(client, session):
    session.add(Admin(email="me@example.com", password_hash=hash_password("s3cret-pass")))
    user = User(email="guest-host@example.com", password_hash=hash_password("old-pass-123"))
    session.add(user); session.commit()
    client.post("/admin/login", data={"email": "me@example.com", "password": "s3cret-pass"})

    res = client.post(f"/admin/users/{user.id}/claim-link", headers=_ORIGIN)
    assert res.status_code == 200
    html = res.get_data(as_text=True)
    token = html.split("/user/claim/")[1].split("<")[0].strip()
    assert session.get(User, user.id).claim_token_hash == hashlib.sha256(token.encode()).hexdigest()

    client.post("/admin/logout", headers=_ORIGIN)
    res = client.post(f"/user/claim/{token}", data={"password": "new-pass-456"}, headers=_ORIGIN)
    assert res.status_code in (302, 303)
    from auth import verify_password
    assert verify_password("new-pass-456", session.get(User, user.id).password_hash)
