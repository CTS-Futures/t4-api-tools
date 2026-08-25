"""Tests for ChartWindow._bars_df: sort + second-unique de-duplication.

lightweight-charts truncates bar time to whole seconds and rejects a setData
array that is not strictly ascending / unique, so _bars_df must guarantee that.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart.chart_window import ChartWindow  # noqa: E402


def _dt(s):
    return datetime(2024, 1, 15, 9, 30, s, tzinfo=timezone.utc)


def _series(n):
    """n bars at distinct, ascending 15s timestamps; close == index (0..n-1)."""
    base = datetime(2024, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
    return [
        {"time": base + timedelta(seconds=15 * i),
         "open": i, "high": i, "low": i, "close": i, "volume": 1}
        for i in range(n)
    ]


def test_empty_returns_empty_with_columns():
    df = ChartWindow._bars_df([])
    assert list(df.columns) == ["time", "open", "high", "low", "close", "volume"]
    assert df.empty


def test_sorts_by_time():
    bars = [
        {"time": _dt(30), "open": 3, "high": 3, "low": 3, "close": 3, "volume": 1},
        {"time": _dt(10), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
        {"time": _dt(20), "open": 2, "high": 2, "low": 2, "close": 2, "volume": 1},
    ]
    df = ChartWindow._bars_df(bars)
    assert [t.second for t in df["time"]] == [10, 20, 30]


def test_drops_second_duplicates_keeping_last():
    bars = [
        {"time": _dt(10), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
        {"time": _dt(10), "open": 9, "high": 9, "low": 9, "close": 9, "volume": 5},  # dup second
        {"time": _dt(20), "open": 2, "high": 2, "low": 2, "close": 2, "volume": 1},
    ]
    df = ChartWindow._bars_df(bars)
    assert len(df) == 2
    # The kept row at second 10 is the last one (close 9, volume 5).
    row = df[df["time"].apply(lambda t: t.second) == 10].iloc[0]
    assert row["close"] == 9
    assert row["volume"] == 5


def test_max_bars_caps_to_most_recent():
    # 5000 bars capped to 2000 -> keep the newest 2000 (close 3000..4999).
    df = ChartWindow._bars_df(_series(5000), max_bars=2000)
    assert len(df) == 2000
    assert df["close"].iloc[0] == 3000     # earliest kept bar
    assert df["close"].iloc[-1] == 4999    # most-recent bar preserved


def test_max_bars_none_keeps_all():
    df = ChartWindow._bars_df(_series(500), max_bars=None)
    assert len(df) == 500


def test_max_bars_no_effect_when_under_cap():
    df = ChartWindow._bars_df(_series(100), max_bars=3000)
    assert len(df) == 100


def test_timestamps_strictly_ascending_at_second_resolution():
    bars = [
        {"time": _dt(s % 60), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}
        for s in (10, 10, 20, 20, 30)
    ]
    df = ChartWindow._bars_df(bars)
    import pandas as pd
    secs = (pd.to_datetime(df["time"]).astype("int64") // 10 ** 9).tolist()
    assert secs == sorted(secs)
    assert len(secs) == len(set(secs))
