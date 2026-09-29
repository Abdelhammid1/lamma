"""Unit tests for activation code generation + validation."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from codes import (
    ActivationError,
    generate_code,
    make_expiry,
    normalize_code,
    validate_code_for_event,
)


# ---------- generate_code ----------

def test_generate_code_format():
    for _ in range(20):
        code = generate_code()
        assert len(code) == 14                          # 12 chars + 2 hyphens
        assert code[4] == "-" and code[9] == "-"
        raw = code.replace("-", "")
        assert raw.isalnum() and raw.isupper()
        # Ambiguous characters must NOT appear
        assert "O" not in raw and "0" not in raw
        assert "I" not in raw and "1" not in raw
        assert "L" not in raw


def test_generate_code_is_random():
    seen = {generate_code() for _ in range(100)}
    assert len(seen) == 100        # extremely likely all distinct


# ---------- normalize_code ----------

@pytest.mark.parametrize("raw, expected", [
    ("ah3f-9k2p-xzlb",   "AH3F-9K2P-XZLB"),
    ("AH3F9K2PXZLB",     "AH3F-9K2P-XZLB"),
    ("  ah3f 9k2p xzlb ", "AH3F-9K2P-XZLB"),
    ("",                 ""),
    (None,               ""),
    ("SHORT",            "SHORT"),
])
def test_normalize_code(raw, expected):
    assert normalize_code(raw) == expected


# ---------- validate_code_for_event ----------

def _fake_code(**overrides):
    defaults = dict(used=False, expires_at=None, event_id=None)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_validate_missing_code_raises():
    with pytest.raises(ActivationError) as e:
        validate_code_for_event(None, "any-event-id")
    assert e.value.reason == "not_found"


def test_validate_used_code_raises():
    with pytest.raises(ActivationError) as e:
        validate_code_for_event(_fake_code(used=True), "e1")
    assert e.value.reason == "used"


def test_validate_expired_code_raises():
    past = datetime.utcnow() - timedelta(hours=1)
    with pytest.raises(ActivationError) as e:
        validate_code_for_event(_fake_code(expires_at=past), "e1")
    assert e.value.reason == "expired"


def test_validate_wrong_event_raises():
    with pytest.raises(ActivationError) as e:
        validate_code_for_event(_fake_code(event_id="other-id"), "my-id")
    assert e.value.reason == "wrong_event"


def test_validate_universal_code_allows_any_event():
    # event_id=None means "not bound to a specific event"
    validate_code_for_event(_fake_code(event_id=None), "any-id")


def test_validate_correct_event_binds_ok():
    validate_code_for_event(_fake_code(event_id="e1"), "e1")


# ---------- make_expiry ----------

def test_make_expiry_none_returns_none():
    assert make_expiry(None) is None
    assert make_expiry(0)    is None
    assert make_expiry(-1)   is None


def test_make_expiry_hours_returns_future():
    now = datetime.utcnow()
    dt = make_expiry(48)
    assert dt is not None
    assert 47 * 3600 < (dt - now).total_seconds() < 49 * 3600
