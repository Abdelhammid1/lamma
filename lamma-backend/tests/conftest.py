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


def sign_in_host(client, email="host@example.com", password="s3cret-pass"):
    """Sign `client` up (and so in) as a host — publishing requires one."""
    res = client.post("/user/signup", data={"email": email, "password": password},
                      headers={"Origin": "http://localhost"})
    assert res.status_code in (302, 303), res.status_code
    return client


@pytest.fixture
def session(app):
    """Give tests direct DB access when they need to seed rows."""
    with app.app_context():
        yield db.session
