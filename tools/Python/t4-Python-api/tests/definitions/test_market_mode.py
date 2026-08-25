"""Tests for MarketMode enum — verifies all 16 values and the safe get() lookup."""

from t4login.definitions.market_mode import MarketMode


def test_value_count_and_range() -> None:
    assert len(MarketMode) == 16
    assert MarketMode.Undefined.value == 0
    assert MarketMode.TrialExpired.value == 15


def test_known_values_roundtrip() -> None:
    for mode in MarketMode:
        assert MarketMode.get(mode.value) is mode


def test_get_unknown_returns_undefined() -> None:
    assert MarketMode.get(99) is MarketMode.Undefined
    assert MarketMode.get(-1) is MarketMode.Undefined
