"""File upload staging.

Uploaded files sit on the backend's local disk under
`instance/uploads/<event_id>/<path>` until the event is activated
(Stage 3), then they're committed to GitHub and the local files
deleted. Anti-abuse job in Stage 5 also purges files for unactivated
events after 48 h.
"""

import hashlib
import os
import re

from flask import current_app


# What MIME types we accept from the browser. Everything outside this
# short list is rejected up-front — the goal is to prevent the media
# folder becoming a general file drop.
ALLOWED_IMAGE_MIME = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
ALLOWED_VIDEO_MIME = frozenset({"video/mp4", "video/webm", "video/quicktime"})
ALLOWED_MIME       = ALLOWED_IMAGE_MIME | ALLOWED_VIDEO_MIME

# Max any single file may be. Frontend warns above 25 MB; server refuses
# above 50 MB. Nginx client_max_body_size should be >= 55 MB.
MAX_FILE_BYTES     = 50 * 1024 * 1024

# Max sum of files per event. Prevents a single event exhausting the
# staging disk.
MAX_EVENT_BYTES    = 300 * 1024 * 1024


# Only keep basenames matching this — strips paths, weird chars, etc.
_SAFE_NAME_RE      = re.compile(r"[^A-Za-z0-9._-]+")


class UploadError(ValueError):
    """Raised on any staging failure. `reason` is a short code and
    `message` is a user-facing sentence."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def safe_filename(raw: str) -> str:
    """Strip everything except letters/digits/dot/dash/underscore.
    Returns a non-empty name (falls back to 'file' if input was garbage)."""
    if not raw:
        return "file"
    base = os.path.basename(raw)                  # remove any path
    cleaned = _SAFE_NAME_RE.sub("-", base).strip("-._")
    return cleaned or "file"


def _staging_dir_for(event_id: str) -> str:
    root = current_app.config["UPLOAD_STAGING_DIR"]
    d = os.path.join(root, event_id)
    os.makedirs(d, exist_ok=True)
    return d


def total_bytes_for_event(event_id: str) -> int:
    """Sum of on-disk sizes for a given event's staged files. 0 if none."""
    d = os.path.join(current_app.config["UPLOAD_STAGING_DIR"], event_id)
    if not os.path.isdir(d):
        return 0
    return sum(
        os.path.getsize(os.path.join(d, f))
        for f in os.listdir(d)
        if os.path.isfile(os.path.join(d, f))
    )


def stage_upload(event_id: str, file_storage) -> dict:
    """Persist an uploaded file to disk and return metadata.

    `file_storage` is the werkzeug FileStorage from `request.files['file']`.
    Returns `{path, size_bytes, content_hash, filename}` on success.
    Raises `UploadError` on any validation failure.
    """
    if file_storage is None or not file_storage.filename:
        raise UploadError("no_file", "No file was uploaded.")

    mime = (file_storage.mimetype or "").lower()
    if mime not in ALLOWED_MIME:
        raise UploadError("bad_type", "Only images and videos are allowed.")

    filename = safe_filename(file_storage.filename)

    # Read once to a temp buffer so we can measure + hash + reject
    # oversize files without leaving a half-written file behind.
    data = file_storage.read()
    size = len(data)

    if size == 0:
        raise UploadError("empty", "The uploaded file is empty.")
    if size > MAX_FILE_BYTES:
        raise UploadError(
            "too_large",
            f"File is too large (max {MAX_FILE_BYTES // (1024 * 1024)} MB).",
        )

    # Per-event cap check (existing files + this one)
    existing = total_bytes_for_event(event_id)
    if existing + size > MAX_EVENT_BYTES:
        raise UploadError(
            "event_quota",
            f"This event's media limit is {MAX_EVENT_BYTES // (1024 * 1024)} MB.",
        )

    content_hash = hashlib.sha256(data).hexdigest()

    # If the exact bytes were already uploaded under a different name,
    # reuse — cheap dedupe.
    dest_dir = _staging_dir_for(event_id)
    dest = os.path.join(dest_dir, filename)

    # Avoid collisions: if the same filename exists with DIFFERENT bytes,
    # prefix with a short hash. If it exists with the same bytes, no-op.
    if os.path.exists(dest):
        with open(dest, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() == content_hash:
                return {
                    "path": f"{event_id}/{filename}",
                    "size_bytes": size,
                    "content_hash": content_hash,
                    "filename": filename,
                }
        stem, ext = os.path.splitext(filename)
        filename = f"{stem}-{content_hash[:8]}{ext}"
        dest = os.path.join(dest_dir, filename)

    with open(dest, "wb") as f:
        f.write(data)

    return {
        "path": f"{event_id}/{filename}",
        "size_bytes": size,
        "content_hash": content_hash,
        "filename": filename,
    }
