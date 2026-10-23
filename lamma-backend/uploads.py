"""File upload staging.

Uploaded files sit on the backend's local disk under
`instance/uploads/<event_id>/<path>` until the event is activated
(Stage 3), then they're moved into MEDIA_SERVE_DIR. Anti-abuse job in Stage 5 also purges files for unactivated
events after 48 h.
"""

import hashlib
import os
import re
from contextlib import contextmanager

from flask import current_app


# What MIME types we accept from the browser. Everything outside this
# short list is rejected up-front — the goal is to prevent the media
# folder becoming a general file drop.
ALLOWED_IMAGE_MIME = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
ALLOWED_VIDEO_MIME = frozenset({"video/mp4", "video/webm", "video/quicktime"})
# iOS Safari sometimes reports m4a as `audio/x-m4a` or `audio/mp4`; cover
# both so a user picking an mp3/m4a/ogg from the camera roll or Files app
# doesn't fail the Publish step with a cryptic "bad_type".
ALLOWED_AUDIO_MIME = frozenset({
    "audio/mpeg", "audio/mp3",
    "audio/mp4", "audio/x-m4a", "audio/aac",
    "audio/ogg", "audio/webm",
    "audio/wav", "audio/x-wav",
})
ALLOWED_MIME       = ALLOWED_IMAGE_MIME | ALLOWED_VIDEO_MIME | ALLOWED_AUDIO_MIME

# Max any single file may be (the create form warns above 250 MB).
# nginx's client_max_body_size must stay a little above this.
MAX_FILE_BYTES     = 300 * 1024 * 1024

# Max sum of files per event. 6 photos × 35 MB + 1 video × 35 MB +
# audio = ~260 MB; a 300 MB cap prevents one event eating the whole
# staging disk.
MAX_EVENT_BYTES    = 1024 * 1024 * 1024


# Only keep basenames matching this — strips paths, weird chars, etc.
_SAFE_NAME_RE      = re.compile(r"[^A-Za-z0-9._-]+")

# Extensions we actually serve from /media/<slug>/<file>. The MIME
# allowlist above gates the Content-Type the client claims, but a
# determined bad actor can POST image/jpeg while naming the file
# `pwn.html` — Werkzeug keeps the client-supplied name. Mapping over
# a strict extension allowlist here means `pwn.html` never lands in
# staging at all, so `commit_event` can't move it into the public
# serve dir. Keep this in sync with _MEDIA_EXT_MIME in app.py.
_SAFE_EXTS = frozenset({
    "jpg", "jpeg", "png", "gif", "webp",
    "mp4", "mov", "webm",
    "mp3", "m4a", "aac", "ogg", "wav",
})


_CHUNK = 1024 * 1024


def _file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


@contextmanager
def event_upload_lock(event_id: str):
    """Serialise uploads to one event across gunicorn workers and threads.

    The per-event quota is "bytes already stored + this file <= limit";
    two uploads checking at once could both pass and together exceed it.
    Callers hold this around the whole check → write → record sequence.
    flock is per open file, so threads of one worker also exclude each
    other. Without fcntl (Windows dev) it is a no-op."""
    try:
        import fcntl
    except ImportError:
        yield
        return
    lock_dir = os.path.join(current_app.config["UPLOAD_STAGING_DIR"], ".locks")
    os.makedirs(lock_dir, exist_ok=True)
    with open(os.path.join(lock_dir, f"{event_id}.lock"), "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


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


def _ext_is_safe(filename: str) -> bool:
    """True iff the lowercased final extension is in the serve allowlist.
    Files without a recognizable extension (`image`, `foo.`) are rejected."""
    if "." not in filename:
        return False
    return filename.rsplit(".", 1)[-1].lower() in _SAFE_EXTS


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
        raise UploadError("bad_type", "Only images, videos and audio are allowed.")

    filename = safe_filename(file_storage.filename)
    # Second gate: the Content-Type is client-supplied, so a hostile
    # caller can send image/jpeg with filename `pwn.html`. The serve
    # route (app.py) also blocks this, but rejecting at staging means
    # a bad extension can't even sit on disk waiting for a template
    # bug or a nginx config regression to let it through.
    if not _ext_is_safe(filename):
        raise UploadError(
            "bad_ext",
            "File extension is not allowed. Use jpg, png, webp, gif, mp4, mov, webm, mp3, m4a or ogg.",
        )

    # Stream to a temp file in 1 MB chunks, hashing and counting as we
    # go. Reading the whole upload into memory (as before) held up to
    # 300 MB per request in RAM — two big uploads at once could starve
    # the server. Callers hold event_upload_lock, so `existing` can't
    # change under us.
    existing = total_bytes_for_event(event_id)
    dest_dir = _staging_dir_for(event_id)
    tmp_path = os.path.join(dest_dir, f".upload-{os.getpid()}-{id(file_storage)}.part")
    hasher = hashlib.sha256()
    size = 0
    try:
        with open(tmp_path, "wb") as out:
            while True:
                chunk = file_storage.stream.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise UploadError(
                        "too_large",
                        f"File is too large (max {MAX_FILE_BYTES // (1024 * 1024)} MB).",
                    )
                if existing + size > MAX_EVENT_BYTES:
                    raise UploadError(
                        "event_quota",
                        f"This event's media limit is {MAX_EVENT_BYTES // (1024 * 1024)} MB.",
                    )
                hasher.update(chunk)
                out.write(chunk)
        if size == 0:
            raise UploadError("empty", "The uploaded file is empty.")
        content_hash = hasher.hexdigest()

        dest = os.path.join(dest_dir, filename)
        # Same name already staged: same bytes → reuse it; different
        # bytes → suffix the name with a short hash.
        if os.path.exists(dest):
            if _file_sha256(dest) == content_hash:
                os.remove(tmp_path)
                return {
                    "path": f"{event_id}/{filename}",
                    "size_bytes": size,
                    "content_hash": content_hash,
                    "filename": filename,
                }
            stem, ext = os.path.splitext(filename)
            filename = f"{stem}-{content_hash[:8]}{ext}"
            dest = os.path.join(dest_dir, filename)
        os.replace(tmp_path, dest)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    return {
        "path": f"{event_id}/{filename}",
        "size_bytes": size,
        "content_hash": content_hash,
        "filename": filename,
    }
