"""Unit tests for chart.aggregator (TickStore + CandleAggregator)."""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart.aggregator import CandleAggregator, TickStore  # noqa: E402


def _epoch(y, mo, d, h, mi, s):
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp()


def test_tickstore_ring_buffer_bounded():
    store = TickStore(capacity=3)
    for i in range(5):
        store.push("ES", {"price": i})
    ticks = store.get("ES")
    assert len(ticks) == 3
    assert [t["price"] for t in ticks] == [2, 3, 4]


def test_tickstore_clear():
    store = TickStore()
    store.push("ES", {"price": 1})
    store.push("CL", {"price": 2})
    store.clear("ES")
    assert store.get("ES") == []
    assert len(store.get("CL")) == 1
    store.clear()
    assert store.get("CL") == []


def test_single_bucket_ohlc():
    agg = CandleAggregator(interval_seconds=60)
    t0 = _epoch(2024, 1, 15, 9, 30, 0)
    agg.add_tick(100.0, 1, t0 + 1)
    agg.add_tick(105.0, 2, t0 + 10)
    agg.add_tick(95.0, 1, t0 + 20)
    bar = agg.add_tick(102.0, 3, t0 + 59)
    assert bar["open"] == 100.0
    assert bar["high"] == 105.0
    assert bar["low"] == 95.0
    assert bar["close"] == 102.0
    assert bar["volume"] == 7
    # Bar time is bucket start.
    assert bar["time"] == datetime(2024, 1, 15, 9, 30, 0, tzinfo=timezone.utc)


def test_bucket_rollover_starts_new_bar():
    agg = CandleAggregator(interval_seconds=60)
    t0 = _epoch(2024, 1, 15, 9, 30, 0)
    agg.add_tick(100.0, 1, t0 + 5)
    bar2 = agg.add_tick(110.0, 2, t0 + 65)  # next minute
    assert bar2["open"] == 110.0
    assert bar2["volume"] == 2
    assert bar2["time"] == datetime(2024, 1, 15, 9, 31, 0, tzinfo=timezone.utc)


def test_out_of_order_tick_ignored():
    agg = CandleAggregator(interval_seconds=60)
    t0 = _epoch(2024, 1, 15, 9, 30, 0)
    agg.add_tick(100.0, 1, t0 + 65)  # establishes bucket 9:31
    late = agg.add_tick(99.0, 1, t0 + 5)  # belongs to 9:30 - too late
    assert late is None


def test_seed_last_bar_continues_same_bucket():
    agg = CandleAggregator(interval_seconds=60)
    t0 = datetime(2024, 1, 15, 9, 30, 0, tzinfo=timezone.utc)
    agg.seed_last_bar({"time": t0, "open": 50.0, "high": 55.0, "low": 48.0,
                       "close": 52.0, "volume": 100})
    # A tick in the same minute should fold into the seeded bar (open preserved).
    bar = agg.add_tick(60.0, 5, t0.timestamp() + 30)
    assert bar["open"] == 50.0
    assert bar["high"] == 60.0
    assert bar["low"] == 48.0
    assert bar["close"] == 60.0
    assert bar["volume"] == 105


def test_reset_switches_interval():
    agg = CandleAggregator(interval_seconds=60)
    agg.reset(interval_seconds=15)
    assert agg.interval_seconds == 15
    t0 = _epoch(2024, 1, 15, 9, 30, 0)
    b1 = agg.add_tick(100.0, 1, t0 + 1)
    b2 = agg.add_tick(101.0, 1, t0 + 20)  # 20s later -> new 15s bucket
    assert b1["time"] != b2["time"]
