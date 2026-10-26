"""Every template folder must be registered everywhere a template type is
listed. Adding a template used to mean editing ~17 hand-written lists;
missing one broke that template in one place only (no preview, no
dashboard link, no nginx route…). This fails on the first list that
forgets a folder."""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def template_folders():
    """Folders at the repo root that are templates (own index.html,
    config.js and js/bootstrap.js). The classic birthday is birthday.html."""
    return sorted(
        p.name for p in REPO.iterdir()
        if p.is_dir() and (p / "index.html").is_file() and (p / "config.js").is_file()
        and (p / "js" / "bootstrap.js").is_file()
    )


def read(rel):
    return (REPO / rel).read_text(encoding="utf-8")


def test_the_scan_finds_the_templates():
    found = template_folders()
    assert {"wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard", "engagement",
            "qiraya", "sobou", "birthday-elegant"} <= set(found), found


@pytest.mark.parametrize("tpl", template_folders())
def test_template_is_registered_everywhere(tpl):
    from blueprints.pages import TEMPLATES, _KIND
    from blueprints.public import VALID_EVENT_TYPES
    from payload_schema import BIRTHDAY_TYPES, COUPLE_TYPES

    missing = []
    if tpl not in VALID_EVENT_TYPES:                 missing.append("public.VALID_EVENT_TYPES")
    if tpl not in TEMPLATES or tpl not in _KIND:     missing.append("pages.TEMPLATES/_KIND")
    if tpl not in COUPLE_TYPES | BIRTHDAY_TYPES:     missing.append("payload_schema types")

    quoted = f'"{tpl}"'
    checks = {
        "_redirects":                               f"/{tpl}/*",
        "lamma-backend/deploy/install.sh":          f"|{tpl}|",
        "lamma-backend/deploy/nginx.conf.sample":   f"|{tpl}|",
        "lamma-backend/blueprints/pages.py":        f"'{tpl}'" if "-" in tpl else tpl,
        "lamma-backend/templates/user/dashboard.html": f"'{tpl}'",
        "lamma-backend/templates/admin/events.html":   f"type={tpl}\"",
        "js/create-form.js":                        quoted,
        "create.html":                              f'data-type="{tpl}"',
        "index.html":                               f'id: "{tpl}"',
        "js/loader.js":                             quoted,
        "tools/dev_server.py":                      quoted,
    }
    for rel, needle in checks.items():
        text = read(rel)
        if rel in ("lamma-backend/deploy/install.sh", "lamma-backend/deploy/nginx.conf.sample"):
            m = re.search(r"location ~ \^/\(([^)]*)\)", text)
            ok = m is not None and tpl in m.group(1).split("|")
        else:
            ok = needle in text
        if not ok:
            missing.append(rel)
    assert not missing, f"{tpl} is not registered in: {', '.join(missing)}"
