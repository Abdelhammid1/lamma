"""Gunicorn entrypoint.

    gunicorn -b 127.0.0.1:8010 -w 2 wsgi:app
"""

from app import app  # noqa: F401
