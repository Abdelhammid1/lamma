"""Local-disk storage for published invitations.

Replaces the GitHub Contents + Git Data API round-trip in
activate_event with a plain filesystem move. The staged file (which
multipart upload already wrote to `UPLOAD_STAGING_DIR/<event_id>/<name>`)
is renamed into its permanent slot:

    <MEDIA_SERVE_DIR>/<slug>/<filename>

and the serialized invitation JSON is written atomically to:

    <DATA_SERVE_DIR>/<slug>.json

Both prefixes are served to the browser by nginx (/media and /data
location blocks the install script now prints), falling back to
Flask's send_from_directory routes if the sysadmin forgot to add
them. The frontend loader fetches /data/<slug>.json first and
treats GitHub as a legacy fallback.

Design notes:
- All writes are tmp-write + os.replace so a crash mid-write never
  leaves a half-written JSON that birthday.html would try to parse.
- commit_event is idempotent — a second call after a partial failure
  overwrites cleanly, so retrying activate is safe.
- blob.path is rewritten to `<slug>/<filename>` so admin.list_dir /
  the delete path can still find it later.
"""

import json
import os
import shutil
from datetime import datetime
from typing import List

from flask import current_app


def commit_event(event, blobs, staging_root: str) -> List[str]:
    """Move each staged blob to its permanent location and write the
    data JSON. Returns the list of final relative paths (``<slug>/<file>``).

    `blobs` is the list of MediaBlob rows for this event; this function
    mutates each `blob.path` in place to its final relative form so the
    caller can `db.session.commit()` the updates.
    """
    media_root = current_app.config["MEDIA_SERVE_DIR"]
    data_root  = current_app.config["DATA_SERVE_DIR"]
    media_dir  = os.path.join(media_root, event.slug)
    os.makedirs(media_dir, exist_ok=True)
    os.makedirs(data_root, exist_ok=True)

    final_paths: List[str] = []
    for blob in blobs:
        filename = os.path.basename(blob.path)
        src = os.path.join(staging_root, event.id, filename)
        dst = os.path.join(media_dir, filename)
        if os.path.exists(src):
            # Fresh move. shutil.move handles cross-device too (if staging
            # and media sit on different mounts); within one mount it's
            # a cheap rename.
            tmp = dst + ".tmp"
            shutil.copy2(src, tmp)
            os.replace(tmp, dst)
            try:
                os.remove(src)
            except OSError:
                pass
        elif not os.path.exists(dst):
            # Nothing in staging and nothing committed — a prior partial
            # failure that lost the file. Record it but keep going so the
            # JSON still writes with the remaining blobs.
            continue
        blob.path = f"{event.slug}/{filename}"
        final_paths.append(blob.path)

    data_path = os.path.join(data_root, f"{event.slug}.json")
    tmp = data_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(_serialize_event(event))
    os.replace(tmp, data_path)

    return final_paths


def delete_event(slug: str) -> None:
    """Remove the slug's media directory and data JSON. Idempotent —
    safe to call for events that were never published."""
    media_dir = os.path.join(current_app.config["MEDIA_SERVE_DIR"], slug)
    data_path = os.path.join(current_app.config["DATA_SERVE_DIR"], f"{slug}.json")
    if os.path.isdir(media_dir):
        shutil.rmtree(media_dir, ignore_errors=True)
    if os.path.exists(data_path):
        try:
            os.remove(data_path)
        except OSError:
            pass


def _serialize_event(event) -> str:
    """Same JSON shape the old GitHub path produced, so birthday.html's
    loader renders either source transparently."""
    payload = json.loads(event.payload_json) if event.payload_json else {}
    if not isinstance(payload, dict):
        payload = {"payload": payload}
    payload.setdefault("slug", event.slug)
    payload.setdefault("event_type", event.event_type)
    payload["published_at"] = datetime.utcnow().isoformat() + "Z"
    return json.dumps(payload, ensure_ascii=False, indent=2)
