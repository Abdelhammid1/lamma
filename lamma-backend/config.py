"""Environment-driven configuration. Each attribute reads an env var with
a sensible default for local dev; production values come from systemd's
EnvironmentFile."""

import os


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


class Config:
    # --- Core Flask ---
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-me")
    JSON_SORT_KEYS = False
    # Headroom over the per-file ceiling in uploads.py (100 MB) +
    # multipart envelope + nginx client_max_body_size (110m). Werkzeug
    # cuts the request off at exactly this many bytes, so this must
    # be at least as big as the biggest file we accept.
    MAX_CONTENT_LENGTH = 110 * 1024 * 1024

    # --- Database ---
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        "sqlite:///" + os.path.abspath(
            os.path.join(os.path.dirname(__file__), "instance", "app.db")
        ),
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- GitHub proxy (Stage 3) ---
    GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
    MEDIA_OWNER   = os.environ.get("MEDIA_OWNER", "zyadwael")
    MEDIA_REPO    = os.environ.get("MEDIA_REPO", "birthday-media")
    MEDIA_BRANCH  = os.environ.get("MEDIA_BRANCH", "main")

    # --- Public domain (for building public URLs) ---
    PUBLIC_DOMAIN = os.environ.get("PUBLIC_DOMAIN", "manasety.ai")

    # --- Uploads staging ---
    UPLOAD_STAGING_DIR = os.environ.get(
        "UPLOAD_STAGING_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "instance", "uploads")),
    )

    # --- Rate limits (Stage 5 — placeholders for now) ---
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")

    # --- Feature flags ---
    SCHEDULER_ENABLED = _bool("SCHEDULER_ENABLED", default=True)


class TestConfig(Config):
    import tempfile
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test"
    # Cross-platform temp dir (works on Windows too)
    UPLOAD_STAGING_DIR = os.path.join(tempfile.gettempdir(), "lamma-test-uploads")
    SCHEDULER_ENABLED = False
    RATELIMIT_ENABLED = False
