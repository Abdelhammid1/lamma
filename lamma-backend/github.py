"""Server-side GitHub Contents API wrapper.

Mirrors the browser's `js/github-api.js` so the flow is identical but
the PAT lives in `os.environ['GITHUB_TOKEN']` instead of localStorage.
Every backend commit to the media repo goes through this module.

Design notes
- All methods raise `GitHubError` (with `status` and `body`) on any
  unexpected HTTP error, so callers can log a single exception type.
- `get_file` returns `None` on 404 (a *missing* file is a normal state,
  e.g. when checking whether to include `sha` on the first PUT).
- Binary content is passed as `bytes`; text as `str`. The wrapper
  base64-encodes both.
"""

import base64
import json
from typing import Optional, Union
from urllib.parse import quote as _urlquote

import requests
from flask import current_app


API_ROOT = "https://api.github.com"


class GitHubError(RuntimeError):
    """Wraps a non-2xx GitHub API response."""

    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"GitHub {status} on {url}: {body[:200]}")
        self.status = status
        self.body = body
        self.url = url


class GitHubClient:
    """Thin wrapper around the GitHub Contents API. One instance per
    request is fine — no state to share."""

    def __init__(
        self,
        token: Optional[str] = None,
        owner: Optional[str] = None,
        repo: Optional[str] = None,
        branch: Optional[str] = None,
        session: Optional[requests.Session] = None,
    ):
        cfg = current_app.config
        self.token   = token  or cfg["GITHUB_TOKEN"]
        self.owner   = owner  or cfg["MEDIA_OWNER"]
        self.repo    = repo   or cfg["MEDIA_REPO"]
        self.branch  = branch or cfg["MEDIA_BRANCH"]
        self._session = session or requests.Session()

    # ------------------------------------------------------------------ helpers
    def _headers(self) -> dict:
        h = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _contents_url(self, path: str) -> str:
        # Only the path is user-controlled; quote each segment
        safe_path = "/".join(_urlquote(p, safe="") for p in path.split("/") if p)
        return f"{API_ROOT}/repos/{self.owner}/{self.repo}/contents/{safe_path}"

    def _request(self, method: str, url: str, **kw) -> requests.Response:
        return self._session.request(
            method, url,
            headers={**self._headers(), **kw.pop("headers", {})},
            timeout=30,
            **kw,
        )

    # ------------------------------------------------------------------ public

    def get_file(self, path: str) -> Optional[dict]:
        """Fetch a single file. Returns `{sha, size, content_bytes}` or
        `None` on 404."""
        url = f"{self._contents_url(path)}?ref={self.branch}"
        res = self._request("GET", url)
        if res.status_code == 404:
            return None
        if not res.ok:
            raise GitHubError(res.status_code, res.text, url)
        data = res.json()
        b64 = (data.get("content") or "").replace("\n", "")
        return {
            "sha": data["sha"],
            "size": data.get("size", 0),
            "content_bytes": base64.b64decode(b64) if b64 else b"",
        }

    def list_dir(self, path: str) -> Optional[list]:
        """List a directory. Returns `[{name, path, type, sha, size}, ...]`
        or `None` on 404."""
        url = f"{self._contents_url(path)}?ref={self.branch}"
        res = self._request("GET", url)
        if res.status_code == 404:
            return None
        if not res.ok:
            raise GitHubError(res.status_code, res.text, url)
        return res.json()

    # GitHub Contents API in practice returns 422 for base64 payloads
    # over ~35 MB — a 38 MB video file trips it. Anything at or above
    # this threshold takes the Git Data API path (create blob → tree →
    # commit → update ref), which handles up to 100 MB per file. We
    # keep small files on Contents API because it is 1 round-trip
    # instead of 6.
    _LARGE_FILE_THRESHOLD = 20 * 1024 * 1024  # 20 MB raw ≈ 27 MB base64

    def put_file(
        self,
        path: str,
        content: Union[bytes, str],
        message: str,
        sha: Optional[str] = None,
    ) -> dict:
        """Create or update a file. Returns the parsed API response.

        Small files go through the single-shot Contents API. Files at
        or above `_LARGE_FILE_THRESHOLD` are routed through the Git
        Data API instead — otherwise GitHub returns 422.
        """
        if isinstance(content, str):
            payload_bytes = content.encode("utf-8")
        elif isinstance(content, (bytes, bytearray)):
            payload_bytes = bytes(content)
        else:
            raise TypeError("content must be str or bytes")

        if len(payload_bytes) >= self._LARGE_FILE_THRESHOLD:
            return self._put_via_git_data(path, payload_bytes, message)

        body = {
            "message": message,
            "branch":  self.branch,
            "content": base64.b64encode(payload_bytes).decode("ascii"),
        }
        if sha:
            body["sha"] = sha

        url = self._contents_url(path)
        res = self._request("PUT", url, json=body)
        if not res.ok:
            raise GitHubError(res.status_code, res.text, url)
        return res.json()

    def _put_via_git_data(self, path: str, payload_bytes: bytes, message: str) -> dict:
        """Commit a single file through the Git Data API — the only path
        that survives files above ~35 MB. Six calls (blob, ref, commit,
        tree, commit, patch-ref) but no size wall until 100 MB.

        Returns a shape mimicking the Contents API `PUT` response so
        callers can read `content.sha` / `commit.sha` uniformly.
        """
        base = f"{API_ROOT}/repos/{self.owner}/{self.repo}"

        # 1. Upload the blob (returns a sha we reference from the tree).
        blob_res = self._request(
            "POST", f"{base}/git/blobs",
            json={
                "content":  base64.b64encode(payload_bytes).decode("ascii"),
                "encoding": "base64",
            },
        )
        if not blob_res.ok:
            raise GitHubError(blob_res.status_code, blob_res.text, f"{base}/git/blobs")
        blob_sha = blob_res.json()["sha"]

        # 2. Current ref (points at the head commit).
        ref_url = f"{base}/git/ref/heads/{self.branch}"
        ref_res = self._request("GET", ref_url)
        if not ref_res.ok:
            raise GitHubError(ref_res.status_code, ref_res.text, ref_url)
        parent_commit_sha = ref_res.json()["object"]["sha"]

        # 3. Parent commit → parent tree sha (base for the new tree).
        commit_url = f"{base}/git/commits/{parent_commit_sha}"
        parent_res = self._request("GET", commit_url)
        if not parent_res.ok:
            raise GitHubError(parent_res.status_code, parent_res.text, commit_url)
        parent_tree_sha = parent_res.json()["tree"]["sha"]

        # 4. New tree with our one blob layered onto the parent tree.
        tree_res = self._request(
            "POST", f"{base}/git/trees",
            json={
                "base_tree": parent_tree_sha,
                "tree": [{
                    "path": path,
                    "mode": "100644",
                    "type": "blob",
                    "sha":  blob_sha,
                }],
            },
        )
        if not tree_res.ok:
            raise GitHubError(tree_res.status_code, tree_res.text, f"{base}/git/trees")
        new_tree_sha = tree_res.json()["sha"]

        # 5. Commit the new tree with the parent as its parent.
        new_commit_res = self._request(
            "POST", f"{base}/git/commits",
            json={
                "message": message,
                "tree":    new_tree_sha,
                "parents": [parent_commit_sha],
            },
        )
        if not new_commit_res.ok:
            raise GitHubError(new_commit_res.status_code, new_commit_res.text, f"{base}/git/commits")
        new_commit_sha = new_commit_res.json()["sha"]

        # 6. Fast-forward the branch to the new commit.
        patch_url = f"{base}/git/refs/heads/{self.branch}"
        patch_res = self._request("PATCH", patch_url, json={"sha": new_commit_sha})
        if not patch_res.ok:
            raise GitHubError(patch_res.status_code, patch_res.text, patch_url)

        return {
            "content": {"sha": blob_sha, "path": path},
            "commit":  {"sha": new_commit_sha},
        }

    def delete_file(self, path: str, sha: str, message: str) -> dict:
        """Remove a file. `sha` is mandatory (from a prior get_file)."""
        body = {"message": message, "branch": self.branch, "sha": sha}
        url = self._contents_url(path)
        res = self._request(
            "DELETE", url,
            data=json.dumps(body),
            headers={"Content-Type": "application/json"},
        )
        if not res.ok:
            raise GitHubError(res.status_code, res.text, url)
        return res.json()
