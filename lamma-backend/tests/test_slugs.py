"""Unit tests for the pure slug validation logic (`slugs.py`)."""

import pytest

from slugs import (
    COMPANY_RESERVED,
    SITE_RESERVED,
    SlugError,
    check_format,
    check_reserved,
    normalize,
    validate,
)


# ---------- normalize ----------

@pytest.mark.parametrize("raw, expected", [
    ("Medo",           "medo"),
    ("  Sara  ",       "sara"),
    ("MOM-2026",       "mom-2026"),
    (None,             ""),
    ("",               ""),
])
def test_normalize(raw, expected):
    assert normalize(raw) == expected


# ---------- check_format ----------

@pytest.mark.parametrize("slug", ["medo", "sara", "mona", "mom-2026", "a1", "test-name", "a" * 40])
def test_check_format_accepts_valid(slug):
    check_format(slug)                    # should not raise


@pytest.mark.parametrize("slug, reason", [
    ("",             "empty"),
    ("a",            "too_short"),
    ("a" * 41,       "too_long"),
    ("-leading",     "bad_format"),
    ("trailing-",    "bad_format"),
    ("has space",    "bad_format"),
    ("HAS_UPPER",    "bad_format"),      # only lowercase allowed
    ("has_under",    "bad_format"),
    ("مِيدو",         "bad_format"),      # non-ASCII rejected
    ("hi!",          "bad_format"),
])
def test_check_format_rejects(slug, reason):
    with pytest.raises(SlugError) as excinfo:
        check_format(slug)
    assert excinfo.value.reason == reason


# ---------- check_reserved ----------

def test_reserved_lists_are_disjoint():
    assert COMPANY_RESERVED.isdisjoint(SITE_RESERVED)


@pytest.mark.parametrize("slug", [
    "admin", "www", "marsoud", "lexoffice", "ftp",     # company subdomains
    "birthday", "wedding", "create", "terms",          # site-owned paths
])
def test_check_reserved_rejects(slug):
    with pytest.raises(SlugError) as excinfo:
        check_reserved(slug)
    assert excinfo.value.reason == "reserved"


def test_check_reserved_allows_custom_names():
    for slug in ("medo", "sara-b", "mom-day"):
        check_reserved(slug)


# ---------- validate (aggregate, no DB) ----------

def test_validate_normalizes_and_passes():
    assert validate("  Medo  ") == "medo"


def test_validate_reports_first_failure_reason():
    with pytest.raises(SlugError) as excinfo:
        validate("Admin")     # normalizes to 'admin', which is reserved
    assert excinfo.value.reason == "reserved"

    with pytest.raises(SlugError) as excinfo:
        validate("has space")
    assert excinfo.value.reason == "bad_format"
