"""Keep every `?v=` cache token equal to a hash of the file it points to.

Browsers cache the site's JS/CSS. The fix has been a hand-bumped
`?v=N` on each reference — and a forgotten bump served old code, which
looked exactly like "my edits don't apply". This rewrites every existing
`?v=` token to the first 8 hex chars of the target file's SHA-256, so a
token changes exactly when the file does.

    python tools/cache_tokens.py           # rewrite stale tokens
    python tools/cache_tokens.py --check   # CI: exit 1 if any is stale

Only references that ALREADY carry `?v=` are touched. Adding a token to
an unversioned import would give the same module two URLs, and the
browser would load it twice — the templates share one mutable CONFIG
module, so a second copy silently splits state. For the same reason,
--check also fails when one JS file is referenced both with and without
a token (or with two different tokens).

Tokens inside a file are part of that file's hash, so a change deep in
an import chain (schedule.js) bubbles up to bootstrap.js and then to
index.html. The rewrite repeats until nothing changes.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"lamma-backend", "node_modules", "tools", ".git", ".github"}
SCAN_EXT = {".html", ".js", ".css"}

# "<path>.<ext>?v=<token>" inside quotes or url(...)
_VERSIONED = re.compile(
    r"""(?P<q>["'(])(?P<path>[A-Za-z0-9_./-]+\.(?:js|css|png|jpe?g|svg|webp|gif))\?v=(?P<tok>[A-Za-z0-9]+)(?=["')])"""
)
# Any quoted local .js reference, versioned or not (for the consistency check).
_ANY_JS = re.compile(r"""["'](?P<path>(?:\.\.?/|/)?[A-Za-z0-9_./-]+\.js)(?:\?v=(?P<tok>[A-Za-z0-9]+))?["']""")


def site_files():
    for p in REPO.rglob("*"):
        if p.suffix in SCAN_EXT and p.is_file() and not (set(p.relative_to(REPO).parts[:-1]) & SKIP_DIRS):
            yield p


def resolve(ref: str, source: Path) -> Path | None:
    if ref.startswith(("http:", "https:", "//")):
        return None
    target = (REPO / ref.lstrip("/")) if ref.startswith("/") else (source.parent / ref)
    target = target.resolve()
    try:
        target.relative_to(REPO)
    except ValueError:
        return None
    return target if target.is_file() else None


def token_for(path: Path) -> str:
    # Line endings normalised: a Windows checkout (core.autocrlf) and the
    # Linux CI checkout must agree on the hash of the same file.
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()[:8]


def one_pass(write: bool) -> list[str]:
    stale = []
    for src in site_files():
        text = src.read_text(encoding="utf-8", errors="surrogateescape")

        def fix(m):
            target = resolve(m.group("path"), src)
            if target is None:
                return m.group(0)
            want = token_for(target)
            if m.group("tok") != want:
                stale.append(f"{src.relative_to(REPO).as_posix()}: {m.group('path')}?v={m.group('tok')} -> {want}")
            return f"{m.group('q')}{m.group('path')}?v={want}"

        new = _VERSIONED.sub(fix, text)
        if write and new != text:
            src.write_text(new, encoding="utf-8", errors="surrogateescape", newline="")
    return stale


def mixed_references() -> list[str]:
    """JS files reached through more than one URL (load twice)."""
    seen: dict[Path, set[str]] = defaultdict(set)
    where: dict[Path, set[str]] = defaultdict(set)
    for src in site_files():
        text = src.read_text(encoding="utf-8", errors="surrogateescape")
        for m in _ANY_JS.finditer(text):
            target = resolve(m.group("path"), src)
            if target is None:
                continue
            seen[target].add(m.group("tok") or "<none>")
            where[target].add(src.relative_to(REPO).as_posix())
    return [
        f"{t.relative_to(REPO).as_posix()} is referenced as ?v={sorted(v)} from {sorted(where[t])}"
        for t, v in seen.items() if len(v) > 1
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report stale tokens, change nothing")
    args = ap.parse_args()

    if args.check:
        problems = one_pass(write=False) + mixed_references()
        for p in problems:
            print(p)
        if problems:
            print("\nRun: python tools/cache_tokens.py")
            return 1
        print("cache tokens: all current")
        return 0

    total = 0
    for _ in range(10):                     # bubble changes up import chains
        changed = one_pass(write=True)
        total += len(changed)
        if not changed:
            break
    for p in mixed_references():
        print("WARNING:", p)
    print(f"cache tokens: {total} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
