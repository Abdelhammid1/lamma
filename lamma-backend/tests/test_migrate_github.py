"""flask migrate-github: copy old GitHub-hosted invitations onto the server."""

import json

from migrate_github import apply_plan, plan_invitation
from models import Event, MediaBlob

RAW = "https://raw.githubusercontent.com/zyadwael/birthday-media/main"
CDN = "https://cdn.jsdelivr.net/gh/zyadwael/birthday-media@main"

REPO = {
    # old format: repo-relative paths
    f"{RAW}/data/ranon.json": json.dumps({
        "slug": "ranon", "name": "Rana",
        "quiz": [{"question": "q", "options": ["a", "b"], "correctIndex": 1}],
        "memories": [{"path": "media/ranon/photo-1.jpeg", "dateLabel": "15/9/2026"}],
        "videoPath": "media/ranon/video-1.mov",
        "letterAr": "لصديقة عمري 💝",
    }).encode(),
    f"{RAW}/media/ranon/photo-1.jpeg": b"jpeg-bytes",
    f"{RAW}/media/ranon/video-1.mov": b"mov-bytes",
    # newer format: full CDN links, plus a YouTube link that stays as-is
    f"{RAW}/birthday/data/yamen.json": json.dumps({
        "slug": "yamen", "event_type": "birthday", "name": "Yamen",
        "memories": [{"url": f"{CDN}/birthday/media/yamen/photo-1.jpg", "dateLabel": ""}],
        "videoUrl": "https://youtube.com/watch?v=x", "musicUrl": "",
        "published_at": "2026-10-03T08:14:31Z",
    }).encode(),
    f"{RAW}/birthday/media/yamen/photo-1.jpg": b"jpg-bytes",
}


def fake_fetch(url):
    return REPO.get(url)


def test_old_format_is_copied_and_relinked(app, session, tmp_path):
    app.config["MEDIA_SERVE_DIR"] = str(tmp_path / "media")
    app.config["DATA_SERVE_DIR"] = str(tmp_path / "data")
    plan = plan_invitation("ranon", fake_fetch)
    assert plan["source"] == "data/ranon.json"
    assert plan["payload"]["memories"] == [{"dateLabel": "15/9/2026", "url": "/media/ranon/photo-1.jpeg"}]
    assert plan["payload"]["videoUrl"] == "/media/ranon/video-1.mov"
    assert "videoPath" not in plan["payload"]

    ev = apply_plan(plan, fake_fetch)
    assert ev.status == "published" and ev.user_id is None
    assert (tmp_path / "media" / "ranon" / "video-1.mov").read_bytes() == b"mov-bytes"
    published = json.loads((tmp_path / "data" / "ranon.json").read_text(encoding="utf-8"))
    assert published["name"] == "Rana" and published["letterAr"] == "لصديقة عمري 💝"
    assert session.query(MediaBlob).filter_by(event_id=ev.id).count() == 2


def test_new_format_keeps_outside_links(app, session, tmp_path):
    app.config["MEDIA_SERVE_DIR"] = str(tmp_path / "media")
    app.config["DATA_SERVE_DIR"] = str(tmp_path / "data")
    plan = plan_invitation("yamen", fake_fetch)
    assert plan["payload"]["memories"][0]["url"] == "/media/yamen/photo-1.jpg"
    assert plan["payload"]["videoUrl"] == "https://youtube.com/watch?v=x"
    assert "published_at" not in plan["payload"]
    apply_plan(plan, fake_fetch)
    assert session.query(Event).filter_by(slug="yamen").one().event_type == "birthday"


def test_cli_dry_run_changes_nothing_and_skips_existing(app, session, monkeypatch):
    import migrate_github
    monkeypatch.setattr(migrate_github, "_http_get", fake_fetch)
    runner = app.test_cli_runner()
    out = runner.invoke(args=["migrate-github", "ranon"]).output
    assert "2 file(s)" in out and "Dry run" in out
    assert session.query(Event).filter_by(slug="ranon").count() == 0
    session.add(Event(slug="ranon", event_type="birthday", status="published"))
    session.commit()
    out = runner.invoke(args=["migrate-github", "ranon", "--apply"]).output
    assert "already on the server" in out
