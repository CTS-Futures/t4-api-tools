"""
research/walkforward.py

The "rebuild every week or so". Steps through time and, at each re-tune date,
re-optimises the rotation's parameters using ONLY data up to that point, then
applies them forward. This is the slow, anti-bubble core: the rule's shape is
fixed (rank the basket, hold top-N), but its knobs (momentum lookback/skip,
value lookback, how many names) are recalibrated on a trailing window and held
steady unless a new set clearly beats the incumbent (hysteresis).

No look-ahead by construction:
  * the signal math (momentum/zscore/SMA, cross-sectional rank) is causal — a
    row only ever sees past bars (this is asserted in test_portfolio.py);
  * parameters for a segment are chosen from data strictly BEFORE that segment.

Output: a stitched out-of-sample target matrix (dates x instruments) plus a log
of the parameters chosen at each re-tune (for the param-drift plot).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import product
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from . import config, portfolio as pf


@dataclass
class WalkForwardResult:
    targets: pd.DataFrame      # OOS target matrix (dates x instrument keys)
    params_log: pd.DataFrame   # one row per re-tune: chosen params + objective
    closes: pd.DataFrame       # aligned close matrix (for the backtest stage)


# --- candidate parameter sets ------------------------------------------------
def _candidates(cfg: config.StudyConfig):
    """Cartesian product of the coarse grid (kept small → fast & robust)."""
    w = cfg.walk
    for ml, ms, vl, tn in product(w.grid_mom_lookback, w.grid_mom_skip,
                                  w.grid_value_lookback, w.grid_top_n):
        if ms + ml <= 0:
            continue
        yield {"mom_lookback": ml, "mom_skip": ms, "value_lookback": vl, "top_n": tn}


def _signal_params(cfg: config.StudyConfig, cand: dict) -> config.SignalParams:
    return replace(cfg.signals, mom_lookback=cand["mom_lookback"],
                   mom_skip=cand["mom_skip"], value_lookback=cand["value_lookback"])


def _port_params(cfg: config.StudyConfig, cand: dict) -> config.PortfolioParams:
    return replace(cfg.portfolio, top_n=cand["top_n"])


# --- objective ---------------------------------------------------------------
def _objective(scores: pd.DataFrame, price_mat: pd.DataFrame,
               pp: config.PortfolioParams, cfg: config.StudyConfig) -> float:
    """Scale-free trailing-window objective for parameter selection: annualised
    Sharpe of the (1-bar-lagged) portfolio return minus a turnover penalty.

    Takes a precomputed `scores` frame so the caller can reuse it across top_n
    variants (top_n only affects selection, not scoring). Deliberately uses
    simple per-bar returns (not the dollar cost model) — we're ranking parameter
    sets, not reporting PnL, so scale-free is right and the turnover penalty
    pushes toward stable, lower-churn settings.
    """
    w = cfg.walk
    rb = pf.rebalance_dates(scores.index, w.rebalance_days, start_at=0)
    targets = pf.select_targets(scores, pp, rb)

    rets = (targets.shift(1) * price_mat.pct_change()).sum(axis=1)
    rets = rets.tail(w.trailing_window).replace([np.inf, -np.inf], np.nan).dropna()
    if len(rets) < 5 or rets.std(ddof=0) == 0:
        return float("-inf")
    sharpe = float(np.sqrt(252.0) * rets.mean() / rets.std(ddof=0))

    turn = targets.diff().abs().sum(axis=1).tail(w.trailing_window)
    turnover = float(turn[turn > 0].mean()) if (turn > 0).any() else 0.0
    return sharpe - w.turnover_penalty * turnover


# --- main loop ---------------------------------------------------------------
def run_walkforward(closes: Dict[str, pd.Series], cfg: config.StudyConfig = config.DEFAULT) -> WalkForwardResult:
    keys = list(closes.keys())
    price_mat = pd.DataFrame({k: closes[k] for k in keys})
    index = price_mat.index
    w = cfg.walk

    targets = pd.DataFrame(0.0, index=index, columns=keys)
    retune_set = set(pf.rebalance_dates(index, w.retune_days, start_at=w.warmup))
    rebalance_set = set(pf.rebalance_dates(index, w.rebalance_days, start_at=w.warmup))

    incumbent: Optional[dict] = None      # current parameter set
    incumbent_scores: Optional[pd.DataFrame] = None  # composite scores for it
    incumbent_pp: Optional[config.PortfolioParams] = None
    prev = pd.Series(0.0, index=keys)
    log: List[dict] = []

    # How much trailing history each tune needs: enough indicator warmup for the
    # widest grid lookback, plus the trailing_window we actually score over.
    warm_need = max(max(w.grid_value_lookback),
                    max(w.grid_mom_lookback) + max(w.grid_mom_skip),
                    cfg.signals.trend_lookback)
    tune_tail = warm_need + w.trailing_window + 5

    for ts in index:
        if ts in retune_set:
            # Tune on a bounded trailing slice ending at `ts` (still strictly
            # causal — only past data — just bounded so cost doesn't grow).
            past_mat = price_mat.loc[:ts].tail(tune_tail)
            past = {k: past_mat[k] for k in keys}

            # Cache composite_scores by signal key — top_n variants share scores.
            score_cache: dict = {}

            def _scores_for(cand: dict):
                key = (cand["mom_lookback"], cand["mom_skip"], cand["value_lookback"])
                sc = score_cache.get(key)
                if sc is None:
                    sc = pf.composite_scores(past, _signal_params(cfg, cand))
                    score_cache[key] = sc
                return sc

            best, best_obj = None, float("-inf")
            for cand in _candidates(cfg):
                obj = _objective(_scores_for(cand), past_mat, _port_params(cfg, cand), cfg)
                if obj > best_obj:
                    best, best_obj = cand, obj

            # Hysteresis: only switch if the new set beats the incumbent's score
            # on THIS trailing window by an absolute margin (slow rebuild). The
            # incumbent's scores are already in the cache (it came from the grid).
            switched = False
            if incumbent is None:
                incumbent, switched = best, True
            elif best is not None:
                inc_obj = _objective(_scores_for(incumbent), past_mat,
                                     _port_params(cfg, incumbent), cfg)
                if best_obj - inc_obj > w.hysteresis:
                    incumbent, switched = best, True

            if switched and incumbent is not None:
                incumbent_scores = pf.composite_scores(closes, _signal_params(cfg, incumbent))
                incumbent_pp = _port_params(cfg, incumbent)
            log.append({"ts": ts, **(incumbent or {}), "objective": best_obj, "switched": switched})

        if ts in rebalance_set and incumbent_scores is not None:
            desired = pf._desired_row(incumbent_scores.loc[ts], incumbent_pp)
            prev = pf._throttle(prev, desired, incumbent_pp)

        targets.loc[ts] = prev.values

    params_log = pd.DataFrame(log).set_index("ts") if log else pd.DataFrame()
    return WalkForwardResult(targets=targets, params_log=params_log, closes=price_mat)
