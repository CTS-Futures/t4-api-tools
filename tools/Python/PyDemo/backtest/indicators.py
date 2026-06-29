"""backtest/indicators.py

Pure indicator math, a faithful port of JSDemo's ``algo/strategies/indicators.js``.

Unlike ``chart/features/indicators.py`` (whole-array pandas series for chart
overlays), these operate on a plain list buffer (a strategy's rolling
``_closes`` / ``_highs`` / ``_lows``) and return a single scalar for the MOST
RECENT point — the natural shape for a strategy deciding on each closed bar.

Every function returns ``None`` when there isn't enough data, so callers can use
a simple ``if x is None: return`` warm-up guard (matching the strategies).

No chart/DOM dependency — trivially unit-testable, and the implementations match
the JS ones value-for-value (notably the Pine-seeded MACD and Wilder RSI).
"""

from __future__ import annotations

import math
from typing import Optional, Sequence


def sma(values: Sequence[float], period: int) -> Optional[float]:
    """Simple moving average of the last ``period`` values. None if too short."""
    if period <= 0 or len(values) < period:
        return None
    return sum(values[len(values) - period:]) / period


def ema(values: Sequence[float], period: int) -> Optional[float]:
    """EMA over the whole buffer, seeded with the SMA of the first ``period``
    values (standard practice). Returns the latest EMA. None if too short."""
    if period <= 0 or len(values) < period:
        return None
    k = 2 / (period + 1)
    seed = sum(values[:period]) / period
    prev = seed
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
    return prev


def rsi(values: Sequence[float], period: int) -> Optional[float]:
    """Wilder's RSI over the last ``period`` deltas (needs period+1 values).
    Uses a simple average of gains/losses over the window — stateless for a
    buffer-based caller, matching the JS implementation. Returns 0..100 or None."""
    if period <= 0 or len(values) < period + 1:
        return None
    gain = 0.0
    loss = 0.0
    for i in range(len(values) - period, len(values)):
        diff = values[i] - values[i - 1]
        if diff >= 0:
            gain += diff
        else:
            loss -= diff
    avg_gain = gain / period
    avg_loss = loss / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def stdev(values: Sequence[float], period: int) -> Optional[float]:
    """Population standard deviation of the last ``period`` values. None if short."""
    mean = sma(values, period)
    if mean is None:
        return None
    sq = 0.0
    for i in range(len(values) - period, len(values)):
        d = values[i] - mean
        sq += d * d
    return math.sqrt(sq / period)


def highest(values: Sequence[float], period: int) -> Optional[float]:
    """Highest value over the last ``period``. None if too short."""
    if period <= 0 or len(values) < period:
        return None
    return max(values[len(values) - period:])


def lowest(values: Sequence[float], period: int) -> Optional[float]:
    """Lowest value over the last ``period``. None if too short."""
    if period <= 0 or len(values) < period:
        return None
    return min(values[len(values) - period:])


def macd(values: Sequence[float], fast_period: int, slow_period: int,
         signal_period: int) -> Optional[dict]:
    """MACD matching TradingView Pine's ``ta.macd(src, fast, slow, signal)``:

        macd_line = ta.ema(src, fast) - ta.ema(src, slow)
        signal    = ta.ema(macd_line, signal)
        hist      = macd_line - signal

    Pine's ``ta.ema`` seeds with the FIRST source value (``ema := na(ema[1]) ?
    src : alpha*src + (1-alpha)*ema[1]``) and is defined from the first bar — NOT
    an SMA seed. Replicating that seeding gives bar-for-bar parity with the
    chart. Returns ``{'macd', 'signal', 'hist'}`` for the latest point, or None
    if there are fewer than 2 values."""
    if len(values) < 2:
        return None
    if fast_period <= 0 or slow_period <= 0 or signal_period <= 0:
        return None

    k_fast = 2 / (fast_period + 1)
    k_slow = 2 / (slow_period + 1)
    k_sig = 2 / (signal_period + 1)

    # Pine seeding: every EMA starts at the first available value.
    fast = values[0]
    slow = values[0]
    macd_val = fast - slow   # 0 at the first bar
    signal = macd_val        # signal EMA seeds with macd[0]

    for i in range(1, len(values)):
        fast = values[i] * k_fast + fast * (1 - k_fast)
        slow = values[i] * k_slow + slow * (1 - k_slow)
        macd_val = fast - slow
        signal = macd_val * k_sig + signal * (1 - k_sig)
    return {"macd": macd_val, "signal": signal, "hist": macd_val - signal}


def atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
        period: int) -> Optional[float]:
    """Average True Range over the last ``period`` bars. For each bar, the true
    range is ``max(high-low, |high-prevClose|, |low-prevClose|)``; ATR is the
    simple mean of the last ``period`` true ranges (matching this module's
    simple-average convention — see ``rsi``). Takes aligned high/low/close
    buffers (oldest-first); needs period+1 values so the oldest TR has a prior
    close. None if too short or buffers are misaligned/non-finite."""
    if period <= 0:
        return None
    n = min(len(highs), len(lows), len(closes))
    if n < period + 1:
        return None
    total = 0.0
    for i in range(n - period, n):
        prev_close = closes[i - 1]
        h = highs[i]
        l = lows[i]
        if not (math.isfinite(h) and math.isfinite(l) and math.isfinite(prev_close)):
            return None
        total += max(h - l, abs(h - prev_close), abs(l - prev_close))
    return total / period
