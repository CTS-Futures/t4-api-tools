"""Unit tests for the ported backtest indicators (parity with JSDemo)."""

import math

from backtest import indicators as I


def test_sma_basic():
    assert I.sma([1, 2, 3, 4, 5], 3) == 4.0          # (3+4+5)/3
    assert I.sma([1, 2], 3) is None                   # too short


def test_ema_constant_series_is_constant():
    # SMA-seeded EMA of a flat series equals that value.
    assert I.ema([5, 5, 5, 5, 5], 2) == 5.0
    assert I.ema([5], 2) is None


def test_ema_known_value():
    # period=2, k=2/3. seed = SMA(first 2)= (1+2)/2 = 1.5.
    # i=2: 3*2/3 + 1.5*1/3 = 2 + 0.5 = 2.5
    # i=3: 4*2/3 + 2.5*1/3 = 2.6667 + 0.8333 = 3.5
    assert math.isclose(I.ema([1, 2, 3, 4], 2), 3.5, rel_tol=1e-9)


def test_rsi_all_gains_is_100():
    assert I.rsi([1, 2, 3, 4, 5, 6], 5) == 100.0
    assert I.rsi([1, 2], 5) is None                   # needs period+1


def test_rsi_known_value():
    # alternating +2/-1 deltas over 4 → avgGain=2*... compute directly.
    vals = [10, 12, 11, 13, 12]   # deltas: +2,-1,+2,-1 over period=4
    # gains=4, losses=2 → avgGain=1, avgLoss=0.5 → rs=2 → 100-100/3 = 66.667
    assert math.isclose(I.rsi(vals, 4), 100 - 100 / 3, rel_tol=1e-9)


def test_stdev_population():
    # Classic example: population stdev of this set is exactly 2.0.
    assert math.isclose(I.stdev([2, 4, 4, 4, 5, 5, 7, 9], 8), 2.0, rel_tol=1e-12)


def test_highest_lowest():
    assert I.highest([3, 1, 4, 1, 5, 9, 2], 3) == 9
    assert I.lowest([3, 1, 4, 1, 5, 9, 2], 3) == 2


def test_macd_constant_series_is_zero():
    m = I.macd([5] * 40, 12, 26, 9)
    assert m is not None
    assert math.isclose(m["macd"], 0.0, abs_tol=1e-12)
    assert math.isclose(m["signal"], 0.0, abs_tol=1e-12)
    assert math.isclose(m["hist"], 0.0, abs_tol=1e-12)


def test_macd_rising_series_positive():
    # A steadily rising series → fast EMA above slow EMA → macd > 0.
    m = I.macd(list(range(1, 60)), 12, 26, 9)
    assert m is not None and m["macd"] > 0
    assert I.macd([1], 12, 26, 9) is None             # < 2 values


def test_atr_known_value():
    highs = [10, 11, 12]
    lows = [9, 10, 11]
    closes = [9.5, 10.5, 11.5]
    # TR(1)=max(1,|11-9.5|,|10-9.5|)=1.5 ; TR(2)=max(1,|12-10.5|,|11-10.5|)=1.5
    assert math.isclose(I.atr(highs, lows, closes, 2), 1.5, rel_tol=1e-12)
    assert I.atr(highs, lows, closes, 5) is None       # too short
