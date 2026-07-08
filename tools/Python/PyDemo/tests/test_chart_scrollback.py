"""Infinite scroll-back history: pure helpers + the compact-js_data payload patch.

The scroll wiring itself needs the GUI, but the merge/paging math and the payload
shrink are pure and testable here.
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Importing chart_window applies the compact-js_data patch (apply_patches()).
from chart.chart_window import (  # noqa: E402
    merge_older_bars, older_window, scroll_buffer_bars)


def _bar(y, mo, d, h, m, s, close=1.0):
    return {"time": datetime(y, mo, d, h, m, s, tzinfo=timezone.utc),
            "open": close, "high": close, "low": close, "close": close, "volume": 1}


# --- merge_older_bars --------------------------------------------------------

def test_merge_prepends_and_counts():
    existing = [_bar(2026, 6, 25, 0, 0, 20), _bar(2026, 6, 25, 0, 0, 30)]
    older = [_bar(2026, 6, 25, 0, 0, 5), _bar(2026, 6, 25, 0, 0, 10)]
    merged, prepended = merge_older_bars(existing, older)
    assert prepended == 2
    secs = [b["time"].second for b in merged]
    assert secs == [5, 10, 20, 30]            # ascending, all present


def test_merge_dedups_boundary_overlap():
    existing = [_bar(2026, 6, 25, 0, 0, 20, close=2.0),
                _bar(2026, 6, 25, 0, 0, 30, close=3.0)]
    # older overlaps the boundary second (20) — must not duplicate it.
    older = [_bar(2026, 6, 25, 0, 0, 10, close=1.0),
             _bar(2026, 6, 25, 0, 0, 20, close=9.9)]
    merged, prepended = merge_older_bars(existing, older)
    assert [b["time"].second for b in merged] == [10, 20, 30]
    assert prepended == 1                      # only second 10 is genuinely new
    # existing bar wins the tie at second 20 (keeps the on-screen value).
    assert merged[1]["close"] == 2.0


def test_merge_empty_older_is_noop():
    existing = [_bar(2026, 6, 25, 0, 0, 20)]
    merged, prepended = merge_older_bars(existing, [])
    assert prepended == 0
    assert merged is existing


# --- older_window ------------------------------------------------------------

def test_older_window_steps_one_chunk_back():
    oldest = datetime(2026, 6, 25, 9, 57, 0, tzinfo=timezone.utc)
    start_dt, start_s, end_s = older_window(oldest, chunk_days=1)
    assert end_s == "2026-06-25T09:57:00"
    assert start_s == "2026-06-24T00:00:00"   # one day back, floored to 00:00
    assert start_dt == datetime(2026, 6, 24, 0, 0, 0, tzinfo=timezone.utc)
    assert start_dt.tzinfo is not None         # tz preserved for the next cursor


def test_older_window_multiday_chunk():
    oldest = datetime(2026, 6, 25, 12, 0, 0, tzinfo=timezone.utc)
    start_dt, start_s, _ = older_window(oldest, chunk_days=3)
    assert start_s == "2026-06-22T00:00:00"


# --- scroll_buffer_bars (interval-scaled trigger) ----------------------------

def test_scroll_buffer_scales_with_interval():
    # 1-day look-ahead = one trading-ish day of bars at each interval.
    assert scroll_buffer_bars(60, 1) == 1440      # 1m  -> 86400/60
    assert scroll_buffer_bars(900, 1) == 96       # 15m -> 86400/900
    assert scroll_buffer_bars(300, 1) == 288      # 5m  -> 86400/300


def test_scroll_buffer_floor_applies_for_coarse_intervals():
    # Daily bars: 1 bar/day * 1 day = 1, floored to 20 (JSDemo parity).
    assert scroll_buffer_bars(86400, 1) == 20
    assert scroll_buffer_bars(86400, 1, floor=5) == 5


def test_scroll_buffer_honours_buffer_days():
    assert scroll_buffer_bars(60, 2) == 2880      # two days of 1m bars
    assert scroll_buffer_bars(60, 0) == 20        # 0 days -> floor


# --- compact js_data patch ---------------------------------------------------

def test_js_data_patch_is_compact():
    import pandas as pd
    import lightweight_charts.util as util
    import lightweight_charts.abstract as abstract

    df = pd.DataFrame([{"time": 1, "value": 2.0}, {"time": 2, "value": 3.0}])
    out = util.js_data(df)
    assert "\n" not in out                      # no indent=2 pretty-printing
    assert abstract.js_data is util.js_data     # both bindings patched
    # Still valid JSON with the expected records.
    import json
    assert json.loads(out) == [{"time": 1, "value": 2.0}, {"time": 2, "value": 3.0}]
