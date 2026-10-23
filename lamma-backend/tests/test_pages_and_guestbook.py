"""Audit batch 2: link previews on invitation pages, guestbook scoped to
the live invitation."""

import json

from models import Event, Wish


def _published(session, slug="farhetna", tpl="wedding", payload=None, status="published"):
    ev = Event(slug=slug, event_type=tpl, status=status, payload_json=json.dumps(payload or {
        "couple": {"groom": "Mohamed", "bride": "Farida"},
        "event": {"datetimeIso": "2026-11-01T17:00:00.000Z"},
        "venue": {"name": "Solitaire Hall"},
        "gallery": ["/media/farhetna/gallery-1.jpeg"],
    }))
    session.add(ev); session.commit()
    return ev


def test_invitation_page_has_preview_tags(client, session):
    _published(session)
    res = client.get("/wedding/farhetna")
    assert res.status_code == 200
    html = res.get_data(as_text=True)
    assert "<title>Mohamed &amp; Farida · Wedding</title>" in html
    assert 'og:description" content="Sunday, 1 November 2026 · Solitaire Hall"' in html
    assert 'og:image" content="http://localhost/media/farhetna/gallery-1.jpeg"' in html
    assert html.count("<title>") == 1
    assert 'id="cover"' in html or "bootstrap.js" in html     # still the real template


def test_preview_escapes_host_text(client, session):
    _published(session, payload={"couple": {"groom": '"><script>x</script>', "bride": "B"}})
    html = client.get("/wedding/farhetna").get_data(as_text=True)
    assert "<script>x</script>" not in html


def test_unpublished_or_unknown_is_404_so_nginx_serves_static(client, session):
    _published(session, slug="draft-one", status="awaiting_code")
    assert client.get("/wedding/draft-one").status_code == 404
    assert client.get("/wedding/nope").status_code == 404
    assert client.get("/wedding-noir/farhetna").status_code == 404


def test_sobou_uses_baby_name_and_logo_fallback(client, session):
    _published(session, slug="baby", tpl="sobou",
               payload={"couple": {"groom": "Yassin", "bride": "Family"}})
    html = client.get("/sobou/baby/").get_data(as_text=True)
    assert "<title>Yassin · سبوع</title>" in html
    assert 'og:image" content="http://localhost/logo.jpg"' in html


def test_guestbook_shows_only_the_live_invitations_wishes(client, session):
    old = _published(session, slug="farah", status="deleted")
    session.add(Wish(event_id=old.id, event_slug="farah", name="Old", message="old couple"))
    new = _published(session, slug="farah-2")
    new.slug = "farah"          # simulate the freed slug taken again
    old.slug = "farah-old"      # (slug is unique in the DB)
    session.add(Wish(event_id=new.id, event_slug="farah", name="New", message="hi"))
    session.commit()
    names = [w["name"] for w in client.get("/api/invitations/farah/wishes").get_json()["wishes"]]
    assert names == ["New"]
