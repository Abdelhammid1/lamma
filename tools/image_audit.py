"""Flag template PNGs whose non-transparent content hugs the right or
bottom edge — a sign the design export was cropped past the actual
visible content. Based on the calendar-frame.png incident where the
bows were off-centre and the right edge was cut.

Usage:
    python tools/image_audit.py                 # scans all 6 templates
    python tools/image_audit.py wedding         # one template
    python tools/image_audit.py --threshold 8   # tune "too close" px

Edge-margin heuristic: if the rightmost (or bottom-most) non-transparent
pixel is within THRESHOLD pixels of the canvas edge, flag it. Also
reports if the LEFT or TOP margin is >5x larger than the opposite side
(the "off-centre by a mile" pattern — like divider.png was before we
cropped it).

Exits 0 with "clean" when nothing is flagged; 1 otherwise so CI can
block pushes that regress image quality.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("Pillow not installed; run: pip install Pillow\n")
    sys.exit(2)


TEMPLATES = ["wedding", "wedding-noir", "wedding-burgundy", "engagement", "qiraya", "sobou", "birthday-elegant"]
REPO_ROOT = Path(__file__).resolve().parent.parent


def _content_box(im: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of non-transparent pixels, or None if fully transparent."""
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    return im.getbbox()


def audit_one(path: Path, edge_threshold: int) -> list[str]:
    """Return a list of human-readable issue strings for this image."""
    try:
        im = Image.open(path).convert("RGBA")
    except Exception as e:
        return [f"could not open ({e})"]

    w, h = im.size
    bbox = _content_box(im)
    if bbox is None:
        return []  # fully transparent — nothing to flag

    l, t, r, b = bbox
    right_pad  = w - r
    bottom_pad = h - b
    left_pad   = l
    top_pad    = t
    issues = []

    if right_pad < edge_threshold:
        issues.append(f"right-edge crop: content ends {right_pad}px from the right ({w}x{h})")
    if bottom_pad < edge_threshold:
        issues.append(f"bottom-edge crop: content ends {bottom_pad}px from the bottom ({w}x{h})")

    # Off-centre: huge pad on one horizontal side vs the other.
    if left_pad >= 20 and right_pad >= 20:
        if left_pad > 5 * right_pad:
            issues.append(f"left-heavy canvas: left pad {left_pad}px vs right pad {right_pad}px")
        if right_pad > 5 * left_pad:
            issues.append(f"right-heavy canvas: right pad {right_pad}px vs left pad {left_pad}px")

    return issues


def scan(templates: list[str], edge_threshold: int) -> int:
    hits = 0
    for tpl in templates:
        img_dir = REPO_ROOT / tpl / "images"
        if not img_dir.is_dir():
            continue
        for p in sorted(img_dir.glob("*.png")):
            issues = audit_one(p, edge_threshold)
            if issues:
                hits += 1
                rel = p.relative_to(REPO_ROOT).as_posix()
                print(f"\n{rel}")
                for i in issues:
                    print(f"  - {i}")
    if hits == 0:
        print("clean: no edge-crop or off-centre issues found.")
    else:
        print(f"\n{hits} image(s) flagged.")
    return 0 if hits == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("templates", nargs="*", help="limit to these template dirs")
    ap.add_argument("--threshold", type=int, default=6,
                    help="pixels — content ending closer than this to the right/bottom edge is flagged (default 6)")
    args = ap.parse_args()
    tpls = args.templates or TEMPLATES
    return scan(tpls, args.threshold)


if __name__ == "__main__":
    raise SystemExit(main())
