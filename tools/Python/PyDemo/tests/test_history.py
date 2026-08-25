"""Unit tests for chart.history JSON parsing / scale calibration / interval map.

Network paths (binary/JSON fetch) are not exercised here; only the pure parsing
and mapping helpers are.
"""

import os
import sys
from datetime import timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart import history  # noqa: E402


def test_interval_to_t4_table():
    assert history.interval_to_t4(15) == ("Second", 15)
    assert history.interval_to_t4(60) == ("Minute", 1)
    assert history.interval_to_t4(300) == ("Minute", 5)
    assert history.interval_to_t4(3600) == ("Hour", 1)
    assert history.interval_to_t4(86400) == ("Day", 1)


def test_interval_to_t4_derived():
    assert history.interval_to_t4(120) == ("Minute", 2)
    assert history.interval_to_t4(7200) == ("Hour", 2)
    assert history.interval_to_t4(45) == ("Second", 45)


def test_calibrate_scale_power_of_ten():
    assert history.calibrate_scale(5800000.0, 5800.0) == 1000.0
    assert history.calibrate_scale(5800.0, 5800.0) == 1.0


def test_calibrate_scale_implausible_returns_none():
    assert history.calibrate_scale(5800000000000.0, 5800.0) is None  # exp > 8
    assert history.calibrate_scale(0, 5800.0) is None


def _parse(rows, live_price=None):
    # _parse_json_bars is an instance method but uses no instance state beyond tz;
    # build a bare object to call it without constructing a ChartClient.
    obj = history.ChartHistory.__new__(history.ChartHistory)
    obj._tz = 0.0
    return obj._parse_json_bars(rows, live_price)


def test_parse_json_bars_basic():
    rows = [
        {"time": "2024-01-15T09:30:00", "openPrice": 100, "highPrice": 110,
         "lowPrice": 95, "closePrice": 105, "volume": 50},
        {"time": "2024-01-15T09:31:00", "openPrice": 105, "highPrice": 108,
         "lowPrice": 104, "closePrice": 107, "volume": 20},
    ]
    bars = _parse(rows)
    assert len(bars) == 2
    assert bars[0]["open"] == 100.0
    assert bars[0]["close"] == 105.0
    assert bars[0]["volume"] == 50
    assert bars[0]["time"].tzinfo == timezone.utc
    assert bars[0]["time"].hour == 9 and bars[0]["time"].minute == 30


def test_parse_json_bars_applies_calibration():
    rows = [
        {"time": "2024-01-15T09:30:00", "openPrice": 5800000, "highPrice": 5810000,
         "lowPrice": 5790000, "closePrice": 5805000, "volume": 1},
    ]
    bars = _parse(rows, live_price=5805.0)
    assert bars[0]["close"] == 5805.0
    assert bars[0]["open"] == 5800.0


def test_parse_json_bars_wrapped_in_dict_key():
    raw = {"bars": [
        {"time": "2024-01-15T09:30:00", "open": 1, "high": 2, "low": 0.5,
         "close": 1.5, "volume": 3},
    ]}
    obj = history.ChartHistory.__new__(history.ChartHistory)
    obj._tz = 0.0
    bars = obj._parse_json_bars(raw, None)
    assert len(bars) == 1
    assert bars[0]["high"] == 2.0


def test_parse_json_bars_empty():
    assert _parse([]) == []
    assert _parse({"unexpected": 1}) == []
