"""Move invitations published to the old GitHub media repo onto this server.

Before the backend stored invitations itself, they were committed to
github.com/<MEDIA_OWNER>/<MEDIA_REPO> (data JSON + photos/videos) and the
site read them from raw.githubusercontent.com / jsDelivr. This copies
chosen invitations into the normal local storage so the GitHub fallback
can be removed:

    flask --app app migrate-github ranon yamen            # dry run: print the plan
    flask --app app migrate-github ranon yamen --apply    # do it

For each slug it downloads the data JSON and every file it points to into
MEDIA_SERVE_DIR/<slug>/, rewrites the links to /media/<slug>/<file>,
creates a published Event (no owner) with MediaBlob rows, and writes
DATA_SERVE_DIR/<slug>.json. A slug that already has an Event is skipped,
so running it twice is safe. Nothing on GitHub is changed or deleted.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Callable

import click
import requests
from flask import current_app
from flask.cli import with_appcontext

from models import Event, MediaBlob, db
from uploads import safe_filename

# Where the old frontend looked, in order (js/loader.js).
DATA_LOCATIONS = ("data/{slug}.json", "birthday/data/{slug}.json", "wedding/data/{slug}.json")


def _bases() -> tuple[str, list[str]]:
    owner = current_app.config["MEDIA_OWNER"]
    repo = current_app.config["MEDIA_REPO"]
    branch = current_app.config["MEDIA_BRANCH"]
    raw = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}"
    prefixes = [raw + "/", f"https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/"]
    return raw, prefixes


def _http_get(url: str) -> bytes | None:
    r = requests.get(url, timeout=120)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content


def _repo_path(ref: str, prefixes: list[str]) -> str | None:
    """Repo-relative path for a media reference, or None when the file
    isn't in the media repo (a YouTube link, say) and stays as-is."""
    if not isinstance(ref, str) or not ref.strip():
        return None
    ref = ref.strip()
    for p in prefixes:
        if ref.startswith(p):
            return ref[len(p):]
    if "://" in ref or ref.startswith("/"):
        return None
    return ref                       # old style: "media/ranon/photo-1.jpeg"


def plan_invitation(slug: str, fetch: Callable[[str], bytes | None]) -> dict:
    """Fetch one invitation's JSON and work out the files to copy and
    the rewritten payload. Pure apart from `fetch` (tests pass a fake)."""
    raw, prefixes = _bases()
    data, source = None, None
    for loc in DATA_LOCATIONS:
        path = loc.format(slug=slug)
        body = fetch(f"{raw}/{path}")
        if body is not None:
            data, source = json.loads(body.decode("utf-8")), path
            break
    if data is None:
        raise click.ClickException(f"{slug}: no data JSON in the media repo")

    files: list[tuple[str, str]] = []          # (repo path, local filename)
    used_names: set[str] = set()

    def localise(ref):
        repo_path = _repo_path(ref, prefixes)
        if repo_path is None:
            return ref
        name = safe_filename(repo_path.rsplit("/", 1)[-1])
        while name in used_names:
            stem, ext = os.path.splitext(name)
            name = f"{stem}-x{ext}"
        used_names.add(name)
        files.append((repo_path, name))
        return f"/media/{slug}/{name}"

    payload = {k: v for k, v in data.items() if k not in ("published_at",)}
    if isinstance(payload.get("memories"), list):
        mems = []
        for m in payload["memories"]:
            if not isinstance(m, dict):
                continue
            ref = m.get("url") or m.get("path")
            m2 = {k: v for k, v in m.items() if k != "path"}
            m2["url"] = localise(ref) if ref else ""
            mems.append(m2)
        payload["memories"] = mems
    for url_key, path_key in (("videoUrl", "videoPath"), ("musicUrl", "musicPath")):
        ref = payload.get(url_key) or payload.get(path_key)
        payload.pop(path_key, None)
        if ref:
            payload[url_key] = localise(ref)
    payload["slug"] = slug
    payload.setdefault("event_type", "birthday")
    return {"slug": slug, "source": source, "payload": payload, "files": files}


def apply_plan(plan: dict, fetch: Callable[[str], bytes | None]) -> Event:
    raw, _ = _bases()
    slug = plan["slug"]
    media_dir = os.path.join(current_app.config["MEDIA_SERVE_DIR"], slug)
    os.makedirs(media_dir, exist_ok=True)
    import hashlib
    blobs = []
    for repo_path, name in plan["files"]:
        body = fetch(f"{raw}/{repo_path}")
        if body is None:
            raise click.ClickException(f"{slug}: {repo_path} is missing from the media repo")
        dst = os.path.join(media_dir, name)
        with open(dst + ".tmp", "wb") as f:
            f.write(body)
        os.replace(dst + ".tmp", dst)
        blobs.append((f"{slug}/{name}", len(body), hashlib.sha256(body).hexdigest()))

    event = Event(
        slug=slug,
        event_type=plan["payload"]["event_type"],
        status="published",
        payload_json=json.dumps(plan["payload"], ensure_ascii=False),
        activated_at=datetime.utcnow(),
    )
    db.session.add(event)
    db.session.flush()
    for path, size, digest in blobs:
        db.session.add(MediaBlob(event_id=event.id, path=path, size_bytes=size, content_hash=digest))
    db.session.commit()

    from storage import rewrite_data_json
    rewrite_data_json(event)
    return event


@click.command("migrate-github")
@click.argument("slugs", nargs=-1, required=True)
@click.option("--apply", "do_apply", is_flag=True, help="Actually copy and create (default: dry run).")
@with_appcontext
def migrate_github(slugs: tuple[str, ...], do_apply: bool) -> None:
    """Copy invitations from the old GitHub media repo to this server."""
    from payload_schema import validate_payload
    for slug in slugs:
        slug = slug.strip().lower()
        if db.session.query(Event).filter_by(slug=slug).first():
            click.echo(f"{slug}: already on the server — skipped")
            continue
        plan = plan_invitation(slug, _http_get)
        problems = validate_payload(plan["payload"]["event_type"], plan["payload"])
        click.echo(f"{slug}: from {plan['source']}, {len(plan['files'])} file(s)")
        for repo_path, name in plan["files"]:
            click.echo(f"    {repo_path}  ->  /media/{slug}/{name}")
        if problems:
            click.echo(f"    data problems: {problems}")
            continue
        if do_apply:
            apply_plan(plan, _http_get)
            click.echo(f"    done: /data/{slug}.json written")
    if not do_apply:
        click.echo("\nDry run — nothing changed. Add --apply to copy.")
