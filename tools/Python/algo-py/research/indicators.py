"""
research/indicators.py

Pure indicator functions over a pandas close-price Series. No state, no I/O —
each returns a Series aligned to the input index. Momentum (ROC, RSI, MACD,
MA-slope) and mean-reversion (rolling z-score) live here so the model layer just
composes them.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def roc(close: pd.Series, period: int) -> pd.Series:
    """Rate of change (fractional) over `period` bars."""
    return close.pct_change(period)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI in [0, 100]."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    # Wilder smoothing == EMA with alpha = 1/period.
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    # When avg_loss == 0 (pure uptrend) RSI is 100.
    out = out.where(avg_loss != 0.0, 100.0)
    return out


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return (macd_line, signal_line, histogram)."""
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def sma(close: pd.Series, period: int) -> pd.Series:
    return close.rolling(period, min_periods=period).mean()


def ma_slope(close: pd.Series, period: int, slope_period: int = 10) -> pd.Series:
    """Normalised slope of an SMA: change in the MA over `slope_period`, divided
    by the MA level (so it's comparable across price scales)."""
    m = sma(close, period)
    return (m - m.shift(slope_period)) / m.shift(slope_period)


def zscore(close: pd.Series, lookback: int) -> pd.Series:
    """Rolling z-score of price vs its trailing mean/std (the mean-reversion
    primitive). lookback ≈ one trading year by default."""
    mean = close.rolling(lookback, min_periods=lookback).mean()
    std = close.rolling(lookback, min_periods=lookback).std(ddof=0)
    return (close - mean) / std.replace(0.0, np.nan)


def realized_vol(close: pd.Series, window: int = 20) -> pd.Series:
    """Rolling std of log returns (per-bar; not annualised)."""
    rets = np.log(close / close.shift(1))
    return rets.rolling(window, min_periods=window).std(ddof=0)


def momentum_zscore(close: pd.Series, lookback: int) -> pd.Series:
    """Z-score of momentum (ROC over `lookback`) vs its own recent distribution —
    used to gauge how *unusual* an instrument's move is (drives regime logic)."""
    mom = close.pct_change(lookback)
    mean = mom.rolling(lookback, min_periods=lookback).mean()
    std = mom.rolling(lookback, min_periods=lookback).std(ddof=0)
    return (mom - mean) / std.replace(0.0, np.nan)
