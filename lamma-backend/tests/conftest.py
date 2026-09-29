"""Shared pytest fixtures — an app + a database using in-memory SQLite."""

import os
import sys

import pytest

# Make the repo root importable when pytest is invoked from anywhere.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app import create_app       # noqa: E402
from config import TestConfig    # noqa: E402
from models import db            # noqa: E402


@pytest.fixture
def app():
    app = create_app(TestConfig)
    yield app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def session(app):
    """Give tests direct DB access when they need to seed rows."""
    with app.app_context():
        yield db.session
