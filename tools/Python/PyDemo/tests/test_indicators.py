"""Unit tests for chart.features.indicators pure math (sma/ema/vwap)."""

import os
import sys
from datetime import datetime, timezone, timedelta

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart.features import indicators as ind  # noqa: E402


def _df(closes, vols=None, day=15):
    base = datetime(2024, 1, day, 9, 30, tzinfo=timezone.utc)
    n = len(closes)
    vols = vols or [1] * n
    return pd.DataFrame({
        "time": [base + timedelta(minutes=i) for i in range(n)],
        "open": closes, "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes], "close": closes, "volume": vols,
    })


def test_sma_basic():
    s = ind.sma(pd.Series([1, 2, 3, 4, 5], dtype=float), 3)
    assert pd.isna(s.iloc[0]) and pd.isna(s.iloc[1])
    assert s.iloc[2] == pytest.approx(2.0)
    assert s.iloc[4] == pytest.approx(4.0)


def test_ema_seed_and_trend():
    s = ind.ema(pd.Series([10, 10, 10, 10], dtype=float), 3)
    # Constant input -> EMA equals the constant.
    assert all(v == pytest.approx(10.0) for v in s)


def test_vwap_no_reset_single_day():
    df = _df([10, 20, 30], vols=[1, 1, 2])
    v = ind.vwap(df, day_reset=True)
    # cumulative: tp≈close here (high/low symmetric): (10*1)/(1)=10;
    # (10+20)/(2)=15; (10+20+60)/(4)=22.5
    assert v.iloc[0] == pytest.approx(10.0)
    assert v.iloc[1] == pytest.approx(15.0)
    assert v.iloc[2] == pytest.approx(22.5)


def test_vwap_day_reset():
    d1 = _df([10, 20], vols=[1, 1], day=15)
    d2 = _df([100, 200], vols=[1, 1], day=16)
    df = pd.concat([d1, d2], ignore_index=True)
    v = ind.vwap(df, day_reset=True)
    # Day 2 restarts: first point of day2 == its own typical price (100).
    assert v.iloc[2] == pytest.approx(100.0)
    assert v.iloc[3] == pytest.approx(150.0)


def test_vwap_zero_volume_no_div_zero():
    df = _df([10, 20], vols=[0, 0])
    v = ind.vwap(df)
    assert v.isna().all()


def test_compute_dispatch():
    df = _df([1, 2, 3, 4, 5])
    assert ind.compute(df, "sma", 2).iloc[-1] == pytest.approx(4.5)
    assert not ind.compute(df, "ema", 3).isna().any()
    assert ind.compute(df, "vwap", None).iloc[0] == pytest.approx(1.0)
    with pytest.raises(ValueError):
        ind.compute(df, "bogus", None)
