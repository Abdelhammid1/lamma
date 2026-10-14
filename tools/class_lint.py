"""Per-template JS/HTML → CSS class consistency check.

Pulls every CSS class name referenced from JS and HTML in a template
dir and reports any that have no matching rule in that template's CSS
files. Catches the kind of drift the user flagged in wedding-noir
(calendar / gallery / guestbook / rsvp state classes that the JS kept
writing after the CSS was renamed).

Usage:
    python tools/class_lint.py                  # scan all 6 templates
    python tools/class_lint.py wedding-noir     # one template
    python tools/class_lint.py --strict         # non-zero exit on any miss

Sources (per template):
  - *.js / *.mjs             — regex over className =, classList.add/remove/toggle,
                                classList.replace, and class="…" string literals
  - *.html                   — regex over class="…" and class='…' attrs
Target:
  - *.css                    — all selector tokens starting with "."

Known-good allowlist (classes we won't flag even if the CSS doesn't
define them, because they're state-only, test hooks, or framework
classes) lives in CLASS_WHITELIST below.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TEMPLATES = ["wedding", "wedding-noir", "engagement", "qiraya", "sobou", "birthday-elegant"]
REPO_ROOT = Path(__file__).resolve().parent.parent

# Classes we never flag even if the template CSS doesn't define them.
# Keep this list focused — the whole point of the audit is to catch drift.
CLASS_WHITELIST: set[str] = {
    # DOM / state utilities set by multiple modules.
    "hidden", "sr-only", "invalid",
    "entered", "revealed", "is-visible", "opened", "in-view", "on", "off",
    # Section-level identifier hooks (used by section-navigation + reveal.js
    # observers, not necessarily by any style rule).
    "announcement", "contacts", "details", "dress-code", "dress_code",
    "event-info", "gallery", "guestbook", "pill-form", "schedule", "story",
    "venue", "wish-list",
}

# ---- extractors --------------------------------------------------------------

_JS_CLASSNAME_ASSIGN = re.compile(r"""\.className\s*=\s*(['"])([^'"]*?)\1""")
_JS_CLASSLIST_METHOD = re.compile(r"""\.classList\.(?:add|remove|toggle|replace)\(\s*(['"])([^'"]*?)\1(?:\s*,\s*(['"])([^'"]*?)\3)?""")
# Classes referenced from inline HTML snippets embedded in JS template
# strings (`class="..."` or `class='...'`).
_JS_TEMPLATE_CLASS   = re.compile(r"""class\s*=\s*(['"])([^'"]*?)\1""")
_HTML_CLASS_ATTR     = re.compile(r"""class\s*=\s*(['"])([^'"]*?)\1""")
_CSS_SELECTOR_CLASS  = re.compile(r"\.([A-Za-z_][A-Za-z0-9_-]*)")

_TPL_EXPR_CHARS = set("${}?()[]")


def _tokens_from_classlist(text: str) -> set[str]:
    out: set[str] = set()
    for part in text.split():
        # Skip tokens that are actually template-literal fragments like
        # "cal-cell${isEvent" or "tl-${state}" or just "?". We can't
        # resolve them statically, so flagging them would be noise.
        if not part:
            continue
        if any(ch in _TPL_EXPR_CHARS for ch in part):
            continue
        out.add(part)
    return out


def extract_js_classes(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    out: set[str] = set()
    for m in _JS_CLASSNAME_ASSIGN.finditer(text):
        out |= _tokens_from_classlist(m.group(2))
    for m in _JS_CLASSLIST_METHOD.finditer(text):
        out.add(m.group(2))
        if m.group(4): out.add(m.group(4))
    for m in _JS_TEMPLATE_CLASS.finditer(text):
        out |= _tokens_from_classlist(m.group(2))
    return out


def extract_html_classes(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    out: set[str] = set()
    for m in _HTML_CLASS_ATTR.finditer(text):
        out |= _tokens_from_classlist(m.group(2))
    return out


def extract_css_classes(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    return set(_CSS_SELECTOR_CLASS.findall(text))


# ---- scanner -----------------------------------------------------------------

_IGNORE_DIRS = {"node_modules", "dist", "build", ".cache", "coverage"}


def _iter_template_files(tpl_dir: Path):
    """Yield only files we author: HTML at the template root, plus js/
    and css/ files one level deep. Skips vendored or build-output trees
    so false positives from a dropped-in node_modules can't appear."""
    for p in tpl_dir.glob("*.html"):
        yield p
    for sub in ("js", "css"):
        subdir = tpl_dir / sub
        if not subdir.is_dir():
            continue
        for p in subdir.iterdir():
            if p.is_dir() and p.name in _IGNORE_DIRS:
                continue
            if p.is_file():
                yield p


def scan_template(tpl_dir: Path) -> dict:
    used: dict[str, set[Path]] = {}
    defined: set[str] = set()

    def _add_used(cls_set: set[str], src: Path):
        for c in cls_set:
            used.setdefault(c, set()).add(src)

    for p in _iter_template_files(tpl_dir):
        suf = p.suffix.lower()
        if suf in {".js", ".mjs"}:
            _add_used(extract_js_classes(p), p)
        elif suf == ".html":
            _add_used(extract_html_classes(p), p)
        elif suf == ".css":
            defined |= extract_css_classes(p)

    # Also treat classes defined in root-level CSS (if any) as satisfied —
    # the template may inherit from shared styles. Not applicable in this
    # repo today but future-proofing one line.
    missing = sorted(
        c for c in used
        if c not in defined and c not in CLASS_WHITELIST
    )
    return {
        "defined_count": len(defined),
        "used_count":    len(used),
        "missing":       missing,
        "used":          used,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("templates", nargs="*")
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 if any template has missing classes (for CI/hooks)")
    args = ap.parse_args()

    tpls = args.templates or TEMPLATES
    any_miss = False
    for tpl in tpls:
        tpl_dir = REPO_ROOT / tpl
        if not tpl_dir.is_dir():
            print(f"SKIP {tpl} (no such dir)")
            continue
        r = scan_template(tpl_dir)
        print(f"\n=== {tpl} ===")
        print(f"  defined: {r['defined_count']}  used: {r['used_count']}  missing: {len(r['missing'])}")
        for c in r["missing"]:
            srcs = sorted(str(p.relative_to(REPO_ROOT).as_posix()) for p in r["used"][c])
            print(f"  . {c}   (used in: {', '.join(srcs)})")
        if r["missing"]:
            any_miss = True

    if any_miss:
        print("\nSome classes are used but have no matching CSS rule in their template.")
        print("Either add them to the template CSS, remove them from the JS/HTML, or add them to CLASS_WHITELIST in tools/class_lint.py.")
    return 1 if (args.strict and any_miss) else 0


if __name__ == "__main__":
    raise SystemExit(main())
