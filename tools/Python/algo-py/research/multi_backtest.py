"""
research/multi_backtest.py

Portfolio backtest of a target MATRIX (dates x instruments). Rather than write a
second engine, this REUSES the audited single-asset `backtest.backtest()` once
per instrument — preserving its one-bar lag, cost model, trade blotter and PnL
reconciliation — then sums the per-instrument PnL into one portfolio curve.

Each instrument gets its own cost model via `config.cost_for(key)` (point values
differ: ETF shares = $1, ES = $50, NQ = $20, ...). The portfolio uses a single
pool of starting cash, so we sum the per-bar PnL and add cash once (not N times).

Also reports turnover and trades-per-week (to check the "≤2 trades/week" target)
and an equal-weight buy-&-hold baseline over the same basket.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Dict, List

import numpy as np
import pandas as pd

from . import backtest as bt, config


@dataclass
class PortfolioResult:
    equity: pd.Series              # portfolio equity ($), single cash pool
    pnl: pd.Series                 # portfolio per-bar PnL ($)
    positions: pd.DataFrame        # contracts held per instrument
    targets: pd.DataFrame          # the input target matrix
    per_asset: Dict[str, bt.BacktestResult]
    trades: pd.DataFrame           # concatenated closed trades (with `symbol`)
    stats: dict
    baseline_equity: pd.Series     # equal-weight buy & hold over the basket


def _weeks(index: pd.DatetimeIndex) -> float:
    if len(index) < 2:
        return 1.0
    days = (index[-1] - index[0]).days
    return max(1.0, days / 7.0)


def _portfolio_stats(pnl: pd.Series, equity: pd.Series, positions: pd.DataFrame,
                     targets: pd.DataFrame, closed: pd.DataFrame,
                     starting_cash: float, index: pd.DatetimeIndex) -> dict:
    total = float(pnl.sum())
    rets = pnl / starting_cash
    ann = bt._annualization(index)
    sharpe = float(np.sqrt(ann) * rets.mean() / rets.std(ddof=0)) if rets.std(ddof=0) > 0 else 0.0
    running_max = equity.cummax()
    max_dd = float((equity - running_max).min())

    wins = closed[closed["realized_pnl"] > 0]["realized_pnl"] if len(closed) else pd.Series(dtype=float)
    losses = closed[closed["realized_pnl"] < 0]["realized_pnl"] if len(closed) else pd.Series(dtype=float)
    hit = float(len(wins) / len(closed)) if len(closed) else 0.0
    pf = float(wins.sum() / -losses.sum()) if losses.sum() != 0 else float("inf")

    # Trades = integer position changes summed across instruments.
    pos_changes = int((positions.diff().fillna(positions) != 0).sum().sum())
    in_market = (positions != 0).any(axis=1)
    turn = targets.diff().abs().sum(axis=1)
    return {
        "net_pnl": total,
        "return_pct": float(total / starting_cash * 100.0),
        "sharpe": sharpe,
        "max_drawdown": max_dd,
        "max_drawdown_pct": float(max_dd / starting_cash * 100.0),
        "n_bars": int(len(pnl)),
        "n_trades": pos_changes,
        "trades_per_week": float(pos_changes / _weeks(index)),
        "hit_rate": hit,
        "profit_factor": pf,
        "avg_turnover": float(turn[turn > 0].mean()) if (turn > 0).any() else 0.0,
        "time_in_market_pct": float(in_market.mean() * 100.0),
    }


def weekly_consistency(pnl: pd.Series, starting_cash: float) -> dict:
    """Weekly-cadence consistency lens on a per-bar PnL series.

    Resamples PnL to calendar weeks and reports how OFTEN it wins and how the
    win weeks compare to the loss weeks — the metrics that matter for a
    "profit most weeks" goal (as opposed to total return / Sharpe). All percent
    figures are vs starting cash so they're comparable across sizing.
    """
    if pnl is None or len(pnl) == 0:
        return {}
    wk = pnl.resample("W").sum().dropna()
    if len(wk) == 0:
        return {}
    wk_pct = wk / starting_cash * 100.0
    # "Active" weeks = where it actually had exposure. Flat (≈0) weeks are warmup
    # or out-of-market periods; counting them as losses understates the win rate
    # and invents fake losing streaks, so judge consistency on active weeks only.
    eps = 1e-6
    active = wk_pct[wk_pct.abs() > eps]
    wins = active[active > 0]
    losses = active[active < 0]

    # Longest run of consecutive strictly-negative weeks (flat weeks break it).
    streak = worst_streak = 0
    for v in wk_pct:
        if v < -eps:
            streak += 1
            worst_streak = max(worst_streak, streak)
        else:
            streak = 0

    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss = float(losses.mean()) if len(losses) else 0.0
    return {
        "n_weeks": int(len(wk)),
        "n_active_weeks": int(len(active)),
        "pct_winning_weeks": float((active > 0).mean() * 100.0) if len(active) else 0.0,
        "avg_week_pct": float(active.mean()) if len(active) else 0.0,
        "median_week_pct": float(active.median()) if len(active) else 0.0,
        "avg_win_week_pct": avg_win,
        "avg_loss_week_pct": avg_loss,
        "win_loss_ratio": float(avg_win / -avg_loss) if avg_loss < 0 else float("inf"),
        "best_week_pct": float(wk_pct.max()),
        "worst_week_pct": float(wk_pct.min()),
        "max_losing_streak_weeks": int(worst_streak),
        "weekly_sharpe": (float(np.sqrt(52) * wk_pct.mean() / wk_pct.std(ddof=0))
                          if wk_pct.std(ddof=0) > 0 else 0.0),
    }


def _cost_for_key(k: str, costs_by_key: Dict[str, config.CostModel] | None) -> config.CostModel:
    """Per-instrument cost model: an explicit override (e.g. dollar-neutral pairs
    sizing) if supplied, else the default from config.cost_for."""
    if costs_by_key is not None and k in costs_by_key:
        return costs_by_key[k]
    return config.cost_for(k)


def backtest_portfolio(targets: pd.DataFrame, closes: Dict[str, pd.Series],
                       cfg: config.StudyConfig = config.DEFAULT,
                       costs_by_key: Dict[str, config.CostModel] | None = None) -> PortfolioResult:
    keys: List[str] = list(targets.columns)
    starting_cash = cfg.costs.starting_cash

    per: Dict[str, bt.BacktestResult] = {}
    pnl_sum: pd.Series | None = None
    positions: Dict[str, pd.Series] = {}
    closed_frames: List[pd.DataFrame] = []

    for k in keys:
        ccfg = replace(cfg, costs=_cost_for_key(k, costs_by_key))
        res = bt.backtest(closes[k], targets[k], ccfg)
        per[k] = res
        positions[k] = res.positions
        pnl_sum = res.pnl if pnl_sum is None else pnl_sum.add(res.pnl, fill_value=0.0)
        if len(res.trades):
            ct = res.trades[res.trades["realized_pnl"].notna()].copy()
            if len(ct):
                ct["symbol"] = k
                closed_frames.append(ct)

    index = pnl_sum.index
    equity = starting_cash + pnl_sum.cumsum()
    positions_df = pd.DataFrame(positions)
    closed = pd.concat(closed_frames) if closed_frames else pd.DataFrame(columns=["realized_pnl", "symbol"])
    stats = _portfolio_stats(pnl_sum, equity, positions_df, targets, closed, starting_cash, index)

    baseline_equity = _equal_weight_baseline(closes, targets, cfg, starting_cash, costs_by_key)
    return PortfolioResult(
        equity=equity, pnl=pnl_sum, positions=positions_df, targets=targets,
        per_asset=per, trades=closed, stats=stats, baseline_equity=baseline_equity,
    )


def _equal_weight_baseline(closes: Dict[str, pd.Series], targets: pd.DataFrame,
                           cfg: config.StudyConfig, starting_cash: float,
                           costs_by_key: Dict[str, config.CostModel] | None = None) -> pd.Series:
    """Hold an equal gross-weight in every basket member, continuously, from the
    first bar the strategy could trade — the naive 'just own the basket' line."""
    keys = list(targets.columns)
    n = len(keys)
    # Start when the strategy first takes any position (fair comparison window).
    active = targets.abs().sum(axis=1) > 0
    start_ts = active.idxmax() if active.any() else targets.index[0]
    level = cfg.portfolio.gross_target / max(1, n)

    pnl_sum: pd.Series | None = None
    for k in keys:
        bt_target = pd.Series(0.0, index=targets.index)
        bt_target.loc[start_ts:] = level
        ccfg = replace(cfg, costs=_cost_for_key(k, costs_by_key))
        res = bt.backtest(closes[k], bt_target, ccfg)
        pnl_sum = res.pnl if pnl_sum is None else pnl_sum.add(res.pnl, fill_value=0.0)
    return starting_cash + pnl_sum.cumsum()
