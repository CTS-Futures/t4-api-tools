"""Tests for ChartDataChange enum — verifies all 16 values and the get() lookup."""

from t4login.definitions.chartdata.chart_data_change import ChartDataChange


def test_all_values_present() -> None:
    assert len(ChartDataChange) == 16


def test_integer_values_match_java() -> None:
    expected = {
        "NONE": 0,
        "Trade": 1,
        "Quote": 2,
        "MarketMode": 3,
        "Settlement": 4,
        "TradeBar": 5,
        "TradeDate": 6,
        "TPO": 7,
        "TickChange": 8,
        "RFQ": 9,
        "HeldSettlement": 10,
        "ClearedVolume": 11,
        "OpenInterest": 12,
        "VWAP": 13,
        "MarketSwitch": 14,
        "MarketDefinition": 15,
    }
    for name, val in expected.items():
        assert ChartDataChange[name].value == val


def test_get_known_values() -> None:
    assert ChartDataChange.get(0) is ChartDataChange.NONE
    assert ChartDataChange.get(1) is ChartDataChange.Trade
    assert ChartDataChange.get(15) is ChartDataChange.MarketDefinition


def test_get_unknown_returns_none() -> None:
    assert ChartDataChange.get(99) is None
    assert ChartDataChange.get(-1) is None


def test_roundtrip() -> None:
    for member in ChartDataChange:
        assert ChartDataChange.get(member.value) is member
