"""Rate limiting for the public API.

Flask-Limiter with in-memory storage by default (single-worker OK).
For a multi-worker gunicorn setup, point `RATELIMIT_STORAGE_URI` at
Redis so limits are shared across workers.

Tests disable limits entirely via `TestConfig.RATELIMIT_ENABLED = False`.
"""

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


limiter = Limiter(key_func=get_remote_address, default_limits=[])


def init_limiter(app) -> None:
    """Attach the limiter to the given app."""
    limiter.init_app(app)
