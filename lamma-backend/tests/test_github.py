"""Unit tests for the GitHub Contents API wrapper.

Uses a fake `requests.Session` — no network calls, no real repo, no
GitHub PAT required.
"""

import base64
from unittest.mock import MagicMock

import pytest

from github import GitHubClient, GitHubError


class FakeResponse:
    def __init__(self, status_code: int, json_body=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._json = json_body or {}
        self.text = text or (str(json_body) if json_body else "")

    def json(self):
        return self._json


def _fake_session(response: FakeResponse) -> MagicMock:
    s = MagicMock()
    s.request.return_value = response
    return s


# ---------- get_file ----------

def test_get_file_ok(app):
    b64 = base64.b64encode(b"hello world").decode()
    with app.app_context():
        gh = GitHubClient(session=_fake_session(FakeResponse(
            200, {"sha": "abc", "size": 11, "content": b64},
        )))
        f = gh.get_file("data/medo.json")
    assert f == {"sha": "abc", "size": 11, "content_bytes": b"hello world"}


def test_get_file_returns_none_on_404(app):
    with app.app_context():
        gh = GitHubClient(session=_fake_session(FakeResponse(404, {"message": "Not Found"})))
        assert gh.get_file("nope.txt") is None


def test_get_file_raises_on_500(app):
    with app.app_context():
        gh = GitHubClient(session=_fake_session(FakeResponse(500, {}, "boom")))
        with pytest.raises(GitHubError) as exc:
            gh.get_file("x.txt")
    assert exc.value.status == 500


# ---------- put_file ----------

def test_put_file_encodes_string_as_utf8_base64(app):
    session = _fake_session(FakeResponse(201, {"content": {"sha": "z"}}))
    with app.app_context():
        gh = GitHubClient(session=session)
        gh.put_file("data/medo.json", "أهلاً world", message="publish medo")

    call = session.request.call_args
    assert call.kwargs["json"]["content"] == base64.b64encode("أهلاً world".encode("utf-8")).decode()
    assert call.args[0] == "PUT"
    assert call.kwargs["json"]["message"] == "publish medo"
    assert "sha" not in call.kwargs["json"]


def test_put_file_encodes_bytes(app):
    session = _fake_session(FakeResponse(201, {"content": {"sha": "z"}}))
    with app.app_context():
        gh = GitHubClient(session=session)
        gh.put_file("m/1.jpg", b"\xff\xd8binary", message="add", sha="existing-sha")

    body = session.request.call_args.kwargs["json"]
    assert body["content"] == base64.b64encode(b"\xff\xd8binary").decode()
    assert body["sha"] == "existing-sha"


def test_put_file_raises_on_conflict(app):
    with app.app_context():
        gh = GitHubClient(session=_fake_session(FakeResponse(409, {}, "conflict")))
        with pytest.raises(GitHubError):
            gh.put_file("x.json", "y", message="z")


# ---------- delete_file ----------

def test_delete_file_sends_sha(app):
    session = _fake_session(FakeResponse(200, {"commit": {"sha": "d"}}))
    with app.app_context():
        gh = GitHubClient(session=session)
        gh.delete_file("data/medo.json", "abc", "delete medo")

    call = session.request.call_args
    assert call.args[0] == "DELETE"
    import json as _json
    body = _json.loads(call.kwargs["data"])
    assert body["sha"] == "abc"
    assert body["message"] == "delete medo"


# ---------- URL construction ----------

def test_contents_url_escapes_special_chars(app):
    with app.app_context():
        gh = GitHubClient(session=_fake_session(FakeResponse(200, {"sha": "s", "size": 0, "content": ""})))
        gh.get_file("data/some name.json")
    called_url = gh._session.request.call_args.args[1]
    assert "some%20name" in called_url


def test_headers_include_bearer_when_token_set(app):
    with app.app_context():
        gh = GitHubClient(token="ghp_fake", session=_fake_session(FakeResponse(200, {"sha": "s", "size": 0, "content": ""})))
        gh.get_file("x")
    headers = gh._session.request.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer ghp_fake"
