"""
research/pairs.py

Market-neutral cross-sector pairs trading (statistical arbitrage).

Pick instruments that LOOK unrelated (fast food / tech / commerce) but co-move
under macro shifts, then trade the SPREAD market-neutrally: long the laggard leg,
short the leader leg, and bet the spread reverts to its mean. Because the two
legs hedge each other, weekly P&L stops being "did the market go up" and becomes
"did the spread revert" — the textbook route to a high weekly WIN RATE without
riding equity beta.

Discipline (mirrors the rest of research/): pair SELECTION and the hedge ratio
are fit on the calibration window only; the spread is then traded OUT-OF-SAMPLE.
The rolling z-score uses only trailing data and is acted on with the backtester's
one-bar lag, so there is no look-ahead.

Reuses `indicators.zscore` for the spread z-score and `config.cost_for` for the
per-leg cost model (only max_contracts is overridden, for dollar-neutral sizing).
"""

from __future__ import annotations

import dataclasses
import itertools
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from . import config, indicators


@dataclass
class Pair:
    a: str            # leg A key
    b: str            # leg B key
    beta: float       # hedge ratio: spread = log(A) - beta * log(B)
    pvalue: float     # Engle-Granger cointegration p-value (in-sample)
    corr: float       # daily log-return correlation (in-sample)

    @property
    def label(self) -> str:
        return f"{self.a}-{self.b}"


# --- selection ---------------------------------------------------------------
def select_pairs(closes: Dict[str, pd.Series], params: config.PairsParams) -> List[Pair]:
    """Find tradeable pairs on the CALIBRATION window only.

    A pair qualifies when (1) the two legs' daily log returns are correlated
    above `min_corr` AND (2) their log-price spread is cointegrated (Engle-Granger
    p-value <= `max_pvalue`) — correlation alone can pick pairs whose spread drifts
    forever and never reverts. Qualifying pairs are ranked by p-value (most
    stationary first) and chosen GREEDILY so the selected set is DISJOINT (no
    instrument used twice) — each pair is then an independent dollar-neutral book.
    """
    from statsmodels.tsa.stattools import coint  # local import: optional dep

    keys = list(closes.keys())
    calib: Dict[str, pd.Series] = {
        k: closes[k].loc[:params.calib_end].dropna() for k in keys
    }
    rets = pd.DataFrame({k: np.log(calib[k]).diff() for k in keys}).dropna()

    candidates: List[Pair] = []
    for a, b in itertools.combinations(keys, 2):
        ca, cb = calib[a].align(calib[b], join="inner")
        if len(ca) < 120:                      # need ~6mo of overlap to trust the test
            continue
        if a not in rets or b not in rets:
            continue
        corr = float(rets[a].corr(rets[b]))
        if not np.isfinite(corr) or corr < params.min_corr:
            continue
        la, lb = np.log(ca.values), np.log(cb.values)
        try:
            _tstat, pval, _crit = coint(la, lb)
        except Exception:
            continue
        if not np.isfinite(pval) or pval > params.max_pvalue:
            continue
        beta = float(np.polyfit(lb, la, 1)[0])  # OLS hedge ratio (log-log)
        candidates.append(Pair(a, b, beta, float(pval), corr))

    candidates.sort(key=lambda p: p.pvalue)     # most stationary first
    chosen: List[Pair] = []
    used: set[str] = set()
    for p in candidates:
        if p.a in used or p.b in used:
            continue
        chosen.append(p)
        used.update((p.a, p.b))
        if len(chosen) >= params.top_pairs:
            break
    return chosen


# --- signal ------------------------------------------------------------------
def spread_zscore(a: pd.Series, b: pd.Series, beta: float, lookback: int) -> pd.Series:
    """Rolling z-score of the log-price spread (the mean-reversion signal)."""
    spread = np.log(a) - beta * np.log(b)
    return indicators.zscore(spread, lookback)


def _state_from_z(z: pd.Series, entry: float, exit_: float, stop: float) -> pd.Series:
    """Spread position for leg A from its z-score, with entry/exit hysteresis and a
    divergence stop.

    +1 = long the spread (long A / short B), opened when z < -entry (A cheap).
    -1 = short the spread (short A / long B), opened when z > +entry (A rich).
     0 = flat, restored when |z| < exit (reverted). Positions persist between entry
    and exit (hysteresis) so it doesn't flicker around the band. NaN (warmup) = flat.

    Divergence stop: while holding, if |z| >= `stop` the spread is blowing out (a leg
    re-rated / shocked) — exit and LOCK OUT new entries until |z| comes back inside
    the exit band, so we don't keep re-entering an un-reverting spread. New positions
    are only opened when entry < |z| < stop (never initiate into an already-blown spread).
    """
    out = np.zeros(len(z))
    state = 0
    locked = False
    for i, v in enumerate(z.values):
        if not np.isfinite(v):
            state, locked = 0, False
        elif state != 0:                       # holding
            if abs(v) >= stop:                 # divergence stop → bail and lock out
                state, locked = 0, True
            elif abs(v) < exit_:               # normal mean-reversion exit
                state = 0
        else:                                  # flat
            if locked:
                if abs(v) < exit_:             # spread normalised → re-arm
                    locked = False
            elif entry < v < stop:
                state = -1
            elif -stop < v < -entry:
                state = 1
        out[i] = state
    return pd.Series(out, index=z.index)


def build_targets(
    wide: pd.DataFrame, pairs: List[Pair], params: config.PairsParams
) -> Tuple[pd.DataFrame, Dict[str, pd.Series]]:
    """Per-leg signed target matrix (dates x leg-keys) in {-1, 0, +1}.

    Leg A carries the spread position; leg B carries the opposite. The calibration
    window is masked flat so reported P&L is out-of-sample. Also returns each
    pair's z-score series (for plotting). Pairs are disjoint, so columns are unique.
    """
    legs: List[str] = []
    for p in pairs:
        legs += [p.a, p.b]
    targets = pd.DataFrame(0.0, index=wide.index, columns=legs)
    zscores: Dict[str, pd.Series] = {}

    for p in pairs:
        a = wide[f"{p.a}_close"]
        b = wide[f"{p.b}_close"]
        z = spread_zscore(a, b, p.beta, params.z_lookback)
        state = _state_from_z(z, params.entry_z, params.exit_z, params.stop_z)
        targets[p.a] = state
        targets[p.b] = -state
        zscores[p.label] = z

    # Out-of-sample only: nothing is traded on or before calib_end.
    targets.loc[:params.calib_end] = 0.0
    return targets, zscores


# --- sizing ------------------------------------------------------------------
def dollar_neutral_costs(
    wide: pd.DataFrame, pairs: List[Pair], params: config.PairsParams
) -> Dict[str, config.CostModel]:
    """Per-leg CostModel whose max_contracts ≈ `dollar_per_leg / ref_price`, so a
    target of ±1 deploys roughly `dollar_per_leg` of exposure on every leg — i.e.
    the two legs of a pair are approximately dollar-neutral. Ref price is the leg's
    price at calib_end (in-sample, no look-ahead)."""
    legs: set[str] = set()
    for p in pairs:
        legs.update((p.a, p.b))
    out: Dict[str, config.CostModel] = {}
    for k in legs:
        col = wide[f"{k}_close"].loc[:params.calib_end].dropna()
        ref = float(col.iloc[-1]) if len(col) else float(wide[f"{k}_close"].dropna().iloc[0])
        mc = max(1, int(round(params.dollar_per_leg / ref))) if ref > 0 else 1
        out[k] = dataclasses.replace(config.cost_for(k), max_contracts=mc)
    return out
