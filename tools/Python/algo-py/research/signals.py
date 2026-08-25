"""
research/signals.py

Per-asset signal components for the slow-rebuild rotation study. Each function
takes one instrument's close-price Series and returns a Series aligned to the
input index — pure, no I/O, composing research/indicators.py.

These are the RAW per-asset components. The cross-sectional combination (compare
names against each other, rank, select) lives in research/portfolio.py, where
the whole basket is in hand. Keeping them split means "how a name looks on its
own" (here) is separate from "how it ranks vs its peers" (there).

The four signals map to the user's request:
  * skip-recent momentum  — trend, but excluding the freshest spike (anti-bubble)
  * value / mean-reversion — cheap vs its own long-run mean
  * overextension          — how stretched a name is (an explicit bubble guard)
  * long-term trend gate   — only allow longs that are in an up-trend
"""

from __future__ import annotations

import pandas as pd

from . import config, indicators as ind


def momentum_skip(close: pd.Series, lookback: int, skip: int) -> pd.Series:
    """Return over `lookback` bars EXCLUDING the most recent `skip` bars.

    The classic 12-1 momentum construction: measure the trend up to `skip` bars
    ago, so the freshest (most bubble-prone) move is deliberately ignored.
    With skip=0 this is a plain rate-of-change over `lookback`.
    """
    past = close.shift(skip)
    base = close.shift(skip + lookback)
    return past / base - 1.0


def value_score(close: pd.Series, lookback: int) -> pd.Series:
    """Mean-reversion / "value": negative z-score of price vs its trailing mean.
    Positive (buy) when price is BELOW its ~1yr mean, negative when above."""
    return -ind.zscore(close, lookback)


def overextension(close: pd.Series, lookback: int) -> pd.Series:
    """How stretched a name is: |z-score| of price vs its trailing mean. Large
    values flag a name that has run far from its own mean (bubble guard). The
    threshold/penalty is applied by the portfolio layer."""
    return ind.zscore(close, lookback).abs()


def trend_ok(close: pd.Series, lookback: int) -> pd.Series:
    """Long-term trend gate: True where close is above its `lookback`-bar SMA.
    NaN during warmup is treated as False (not yet allowed)."""
    sma = ind.sma(close, lookback)
    return (close > sma).where(sma.notna(), False)


def asset_signals(close: pd.Series, p: config.SignalParams) -> pd.DataFrame:
    """Bundle the four per-asset components into one DataFrame.

    Columns: momentum, value, overext_z (raw |z|), trend_ok (bool). The
    cross-sectional blend/rank happens in portfolio.py, which standardises
    `momentum` and `value` across the basket before combining.
    """
    return pd.DataFrame({
        "momentum": momentum_skip(close, p.mom_lookback, p.mom_skip),
        "value": value_score(close, p.value_lookback),
        "overext_z": overextension(close, p.value_lookback),
        "trend_ok": trend_ok(close, p.trend_lookback),
    })
