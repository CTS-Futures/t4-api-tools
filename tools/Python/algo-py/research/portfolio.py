"""
research/portfolio.py

Cross-sectional construction: turn the basket's per-asset signals into a target
matrix (dates x instruments, each target in [0, 1], or [-1, 1] with shorts).

Two responsibilities, kept separate so the walk-forward can drive them with
per-segment parameters:

  * `composite_scores(closes, signal_params)` — score every name on every date,
    comparing names AGAINST EACH OTHER (cross-sectional standardisation), with
    the overextension + trend guards disqualifying ineligible longs.
  * `select_targets(scores, closes, port_params, rebalance_idx)` — on each
    rebalance date pick the top-N, weight them, hold flat in between, and apply
    the trade THROTTLE (no-trade band + max-changes-per-rebalance) so the book
    turns over at most a couple of times a week.

`build_targets()` wires both together for a fixed-parameter run; the walk-forward
calls the two pieces directly with the params it re-tuned for each segment.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from . import config, signals as sig


# --- helpers -----------------------------------------------------------------
def closes_from_wide(wide: pd.DataFrame, basket: Optional[List[config.Symbol]] = None) -> Dict[str, pd.Series]:
    """Pull each basket member's close column out of the aligned wide frame.
    `data.align` prefixes columns by key, e.g. spy_close."""
    basket = basket or config.BASKET
    out: Dict[str, pd.Series] = {}
    for s in basket:
        col = f"{s.key}_close"
        if col in wide.columns:
            out[s.key] = wide[col].astype(float)
    if not out:
        raise RuntimeError(
            f"No basket close columns found in wide frame. Expected one of "
            f"{[s.key + '_close' for s in basket]}; got {list(wide.columns)[:8]}..."
        )
    return out


def _xs_zscore(wide: pd.DataFrame) -> pd.DataFrame:
    """Cross-sectional z-score: standardise each ROW across columns (compare the
    names against each other on that date). Rows with <2 finite names pass
    through demeaned-only (std undefined)."""
    mean = wide.mean(axis=1)
    std = wide.std(axis=1, ddof=0).replace(0.0, np.nan)
    return wide.sub(mean, axis=0).div(std, axis=0)


# --- scoring -----------------------------------------------------------------
def composite_scores(closes: Dict[str, pd.Series], p: config.SignalParams) -> pd.DataFrame:
    """Eligible-long composite score per (date, instrument). NaN = not eligible
    (disqualified by the overextension or trend guard, or still warming up).

    Momentum and value are cross-sectionally standardised so they're comparable,
    then blended by the (renormalised) weights. A name is disqualified when it is
    overextended to the UPSIDE (z above +overext_z — the bubble guard) or when it
    fails the long-term trend gate.
    """
    keys = list(closes.keys())
    per = {k: sig.asset_signals(closes[k], p) for k in keys}

    mom = pd.DataFrame({k: per[k]["momentum"] for k in keys})
    val = pd.DataFrame({k: per[k]["value"] for k in keys})
    trend = pd.DataFrame({k: per[k]["trend_ok"] for k in keys}).astype(bool)
    # value = -z, so signed price z-score is -value (positive = above mean).
    z_price = -val

    z_mom = _xs_zscore(mom)
    z_val = _xs_zscore(val)
    wsum = p.w_momentum + p.w_value
    wm = p.w_momentum / wsum if wsum else 0.5
    wv = p.w_value / wsum if wsum else 0.5
    blended = wm * z_mom + wv * z_val

    # Disqualify overextended-up names (bubble guard) and down-trending names.
    eligible = (z_price <= p.overext_z) & trend
    return blended.where(eligible)


# --- selection + throttle ----------------------------------------------------
def _desired_row(score_row: pd.Series, p: config.PortfolioParams) -> pd.Series:
    """Top-N selection + weighting for a single rebalance date → target row."""
    target = pd.Series(0.0, index=score_row.index)
    eligible = score_row.dropna()
    if eligible.empty:
        return target
    chosen = eligible.sort_values(ascending=False).head(p.top_n)
    if p.weighting == "score":
        pos = chosen.clip(lower=0.0)
        if pos.sum() > 0:
            w = pos / pos.sum()
        else:  # all chosen scores <= 0 → fall back to equal
            w = pd.Series(1.0 / len(chosen), index=chosen.index)
    else:  # equal weight
        w = pd.Series(1.0 / len(chosen), index=chosen.index)
    target.loc[chosen.index] = (w * p.gross_target).values
    return target


def _throttle(prev: pd.Series, desired: pd.Series, p: config.PortfolioParams) -> pd.Series:
    """Limit how much the book changes at one rebalance.

    1. No-trade band: ignore per-name target changes smaller than `no_trade_band`
       (keep the previous weight for those names).
    2. Trade cap: if more than `max_trades_per_week` names would still change,
       keep only the largest |Δ| changes and revert the rest to `prev`.
    """
    delta = desired - prev
    band = delta.where(delta.abs() >= p.no_trade_band, 0.0)
    changed = band[band != 0.0]
    if len(changed) > p.max_trades_per_week:
        keep = changed.abs().sort_values(ascending=False).head(p.max_trades_per_week).index
        band = band.where(band.index.isin(keep), 0.0)
    return prev + band


def select_targets(
    scores: pd.DataFrame,
    p: config.PortfolioParams,
    rebalance_idx: List[pd.Timestamp],
) -> pd.DataFrame:
    """Walk the rebalance dates: choose desired holdings, throttle the change vs
    the currently-held book, then hold flat until the next rebalance. Returns the
    full target matrix (dates x instruments), forward-filled between rebalances."""
    # Compute the held book only at rebalance dates (carrying `prev` forward),
    # then forward-fill between them — far cheaper than touching every row.
    cols = scores.columns
    prev = pd.Series(0.0, index=cols)
    sparse = pd.DataFrame(index=scores.index, columns=cols, dtype=float)
    valid = scores.index
    for ts in rebalance_idx:
        if ts not in valid:
            continue
        desired = _desired_row(scores.loc[ts], p)
        prev = _throttle(prev, desired, p)
        sparse.loc[ts] = prev.values
    return sparse.ffill().fillna(0.0)


def rebalance_dates(index: pd.DatetimeIndex, every: int, start_at: int = 0) -> List[pd.Timestamp]:
    """Every `every` bars starting at offset `start_at` (e.g. after warmup)."""
    positions = range(max(0, start_at), len(index), max(1, every))
    return [index[i] for i in positions]


def build_targets(closes: Dict[str, pd.Series], cfg: config.StudyConfig = config.DEFAULT) -> pd.DataFrame:
    """Fixed-parameter target matrix (no walk-forward). Score the whole span with
    one parameter set and rebalance every `walk.rebalance_days` after warmup."""
    scores = composite_scores(closes, cfg.signals)
    idx = scores.index
    rb = rebalance_dates(idx, cfg.walk.rebalance_days, start_at=cfg.walk.warmup)
    return select_targets(scores, cfg.portfolio, rb)
