"""Server-side payload check (audit batch 4)."""

import json

from payload_schema import validate_payload
from tests.conftest import sign_in_host

WEDDING = {
    "couple": {"groom": "Omar", "bride": "Laila", "eventType": "Wedding"},
    "event": {"datetimeIso": "2026-12-12T17:00:00.000Z", "welcomeTime": "6:30 PM"},
    "venue": {"name": "Solitaire Hall", "mapsEmbedSrc": "https://maps.app.goo.gl/x"},
    "blessing": "Our joy is complete with you",
    "dressCode": {"label": "Pink", "colors": ["#f7d9e1", "#a13b58"]},
    "gallery": ["/media/omar-laila/gallery-1-couple.jpg"],
    "schedule": [{"time": "18:30", "label": "Welcome"}],
    "contacts": [{"name": "Ali", "role": "Brother", "phone": "+20100"}],
    "music": "/media/omar-laila/music-our-song.wav",
}
BIRTHDAY = {
    "name": "Medo",
    "quiz": [{"question": "q?", "options": ["a", "b", "c"], "correctIndex": 1}],
    "memories": [{"url": "/media/medo/photo-1-a.jpg", "dateLabel": "NOV 2024"}],
    "videoUrl": "https://youtube.com/watch?v=x", "musicUrl": "",
}


def test_what_the_form_produces_passes():
    assert validate_payload("wedding", WEDDING) == []
    assert validate_payload("birthday", BIRTHDAY) == []
    assert validate_payload("wedding", json.dumps(WEDDING)) == []


def test_typed_address_and_legacy_relative_paths_pass():
    p = {**WEDDING, "venue": {"mapsEmbedSrc": "Solitaire Hall, Maadi"},
         "gallery": ["media/old/x.jpg"]}
    assert validate_payload("wedding", p) == []


def test_blob_links_are_refused_once_each():
    p = {**WEDDING, "music": "blob:https://lamma.manasety.ai/abc"}
    errs = validate_payload("wedding", p)
    assert len(errs) == 1 and "blob:" in errs[0]


def test_dangerous_links_and_bad_shapes():
    p = {**WEDDING,
         "gallery": ["javascript:alert(1)"],
         "venue": {"mapsEmbedSrc": "data:text/html,<b>x</b>"},
         "schedule": "18:30 dinner",
         "dressCode": {"colors": ["red"]}}
    errs = " | ".join(validate_payload("wedding", p))
    assert "gallery[0]" in errs and "venue.mapsEmbedSrc" in errs
    assert "schedule must be a list" in errs and "dressCode.colors[0]" in errs


def test_limits():
    p = {**WEDDING, "gallery": ["/media/a/x.jpg"] * 13, "blessing": "x" * 6000}
    errs = " | ".join(validate_payload("wedding", p))
    assert "gallery has 13 items" in errs and "blessing is too long" in errs


def test_create_endpoint_refuses_bad_payload(client):
    sign_in_host(client)
    res = client.post("/api/events", json={"slug": "bad-one", "event_type": "wedding",
                                            "payload_json": {**WEDDING, "gallery": "nope"}})
    assert res.status_code == 400
    assert res.get_json()["error"] == "bad_payload"
    ok = client.post("/api/events", json={"slug": "good-one", "event_type": "wedding",
                                           "payload_json": WEDDING})
    assert ok.status_code == 201
