"""
research/result_json.py

Serialize a portfolio-study run into a JSON-able dict for the JSDemo UI bridge.
The browser renders its own charts (Lightweight Charts), so this emits plain
series of {time, value} with UNIX-second timestamps (ascending, unique) plus the
stats, the per-re-tune parameter log, and a compact holdings timeline.

Kept separate from report.py (which needs matplotlib) so the --json path stays
light: pandas/numpy only.
"""

from __future__ import annotations

import json
import math
from typing import Any

import pandas as pd

_EPOCH = pd.Timestamp("1970-01-01")


def _epoch(ts: pd.Timestamp) -> int:
    """pandas Timestamp → UNIX seconds (UTC, tz-naive safe — no local shift)."""
    return int((pd.Timestamp(ts).normalize() - _EPOCH) / pd.Timedelta(seconds=1))


def _num(v: Any):
    """JSON-safe number: inf/nan → None (JSON has no inf/NaN)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isinf(f) or math.isnan(f):
        return None
    return f


def _int(v: Any) -> int:
    """Safe int: NaN/inf/None (e.g. an early re-tune before any params qualify)
    → 0, so JSON serialization never trips on int(NaN)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    if math.isnan(f) or math.isinf(f):
        return 0
    return int(f)


def _series(s: pd.Series) -> list[dict]:
    return [{"time": _epoch(ts), "value": _num(val)} for ts, val in s.items()]


def to_result_dict(wf, result, cfg, data_summary: dict, baseline_return_pct: float) -> dict:
    """Build the JSON payload from a WalkForwardResult + PortfolioResult."""
    # Holdings, downsampled to rows where the book actually changes (+ the first
    # held row) so the timeline stays compact.
    targets = result.targets
    keys = list(targets.columns)
    changed = targets.diff().abs().sum(axis=1) > 1e-9
    if len(targets):
        changed.iloc[0] = bool((targets.iloc[0].abs().sum()) > 0) or changed.iloc[0]
    change_idx = targets.index[changed]
    holdings = {
        "keys": keys,
        "times": [_epoch(ts) for ts in change_idx],
        "rows": [[_num(v) for v in targets.loc[ts].tolist()] for ts in change_idx],
    }

    plog = wf.params_log
    params_log = []
    if len(plog):
        for ts, row in plog.iterrows():
            params_log.append({
                "time": _epoch(ts),
                "mom_lookback": _int(row.get("mom_lookback")),
                "mom_skip": _int(row.get("mom_skip")),
                "value_lookback": _int(row.get("value_lookback")),
                "top_n": _int(row.get("top_n")),
                "objective": _num(row.get("objective")),
                "switched": bool(row.get("switched", False)),
            })

    stats = {k: _num(v) if isinstance(v, (int, float)) else v for k, v in result.stats.items()}

    return {
        "ok": True,
        "meta": {
            "basket": keys,
            "source": data_summary.get("source"),
            "resolution": data_summary.get("resolution"),
            "span": data_summary.get("span"),
            "rows": data_summary.get("rows"),
        },
        "config": {
            "mom_lookback": cfg.signals.mom_lookback,
            "mom_skip": cfg.signals.mom_skip,
            "value_lookback": cfg.signals.value_lookback,
            "overext_z": cfg.signals.overext_z,
            "trend_lookback": cfg.signals.trend_lookback,
            "top_n": cfg.portfolio.top_n,
            "weighting": cfg.portfolio.weighting,
            "max_trades_per_week": cfg.portfolio.max_trades_per_week,
            "no_trade_band": cfg.portfolio.no_trade_band,
            "warmup": cfg.walk.warmup,
            "trailing_window": cfg.walk.trailing_window,
            "rebalance_days": cfg.walk.rebalance_days,
            "retune_days": cfg.walk.retune_days,
            "hysteresis": cfg.walk.hysteresis,
        },
        "stats": stats,
        "baseline_return_pct": _num(baseline_return_pct),
        "n_retunes": len(params_log),
        "n_switched": int(sum(1 for p in params_log if p["switched"])),
        "equity": _series(result.equity),
        "baseline_equity": _series(result.baseline_equity),
        "params_log": params_log,
        "holdings": holdings,
    }


def _trades(trades: pd.DataFrame) -> list[dict]:
    """Serialize a backtest trade blotter (one row per position change)."""
    out = []
    if trades is None or not len(trades):
        return out
    for ts, row in trades.iterrows():
        out.append({
            "time": _epoch(ts),
            "from": _int(row.get("from")),
            "to": _int(row.get("to")),
            "price": _num(row.get("price")),
            "realized_pnl": _num(row.get("realized_pnl")),
        })
    return out


def _stats_clean(stats: dict) -> dict:
    """JSON-safe stats dict (inf/NaN floats → None, ints/strings untouched)."""
    return {k: (_num(v) if isinstance(v, (int, float)) else v) for k, v in stats.items()}


def to_backtest_dict(result, buy_hold_equity, *, symbol: str, signal: str,
                     params: dict, data_summary: dict) -> dict:
    """Serialize a single-instrument ``backtest.BacktestResult`` for the PyDemo
    Backtester panel. ``buy_hold_equity`` is a notionally-scaled own-the-asset line
    (starting_cash * close/close[0]) so the comparison is meaningful regardless of
    contract sizing (the engine's own 1-contract baseline would be tiny for shares)."""
    return {
        "ok": True,
        "meta": {
            "symbol": symbol,
            "signal": signal,
            "source": data_summary.get("source"),
            "span": data_summary.get("span"),
            "rows": data_summary.get("rows"),
        },
        "params": params,
        "stats": _stats_clean(result.stats),
        "equity": _series(result.equity),
        "buy_hold_equity": _series(buy_hold_equity),
        "trades": _trades(result.trades),
    }


def to_overlay_dict(overlay_eq, buyhold_eq, overlay_m: dict, buyhold_m: dict, *,
                    window: int, below: float, data_summary: dict) -> dict:
    """Serialize the defensive trend-overlay study (overlay equity vs buy & hold)."""
    return {
        "ok": True,
        "meta": {
            "study": "overlay", "window": window, "below": below,
            "source": data_summary.get("source"),
            "span": data_summary.get("span"),
            "rows": data_summary.get("rows"),
        },
        "stats": _stats_clean(overlay_m),
        "baseline_stats": _stats_clean(buyhold_m),
        "equity": _series(overlay_eq),
        "baseline_equity": _series(buyhold_eq),
    }


def to_war_dict(full, event_stats: dict, *, calib_info: dict, data_summary: dict) -> dict:
    """Serialize the ES war-window combo study: full-span equity + buy&hold, plus
    full-span and event-window stat blocks and the calibration summary."""
    return {
        "ok": True,
        "meta": {
            "study": "war",
            "source": data_summary.get("source"),
            "resolution": data_summary.get("resolution"),
            "span": data_summary.get("span"),
            "rows": data_summary.get("rows"),
            "event_start": data_summary.get("event_start"),
            "event_end": data_summary.get("event_end"),
        },
        "calib": calib_info,
        "stats": _stats_clean(full.stats),
        "event_stats": _stats_clean(event_stats),
        "equity": _series(full.equity),
        "buy_hold_equity": _series(full.buy_hold_equity),
    }


def to_pairs_dict(result, *, pairs, zscores: dict, strat_weekly: dict,
                  base_weekly: dict, spy_corr: float, baseline_return_pct: float,
                  params, data_summary: dict) -> dict:
    """Serialize the market-neutral pairs study: portfolio equity vs buy&hold, the
    weekly-consistency lens, SPY-neutrality, and per-pair stats + z-score series."""
    pair_rows = []
    for p in pairs:
        pair_rows.append({
            "label": p.label,
            "a": p.a, "b": p.b,
            "beta": _num(p.beta),
            "pvalue": _num(p.pvalue),
            "corr": _num(p.corr),
            "zscore": _series(zscores[p.label].dropna()) if p.label in zscores else [],
        })
    return {
        "ok": True,
        "meta": {
            "study": "pairs",
            "source": data_summary.get("source"),
            "n_universe": data_summary.get("n_universe"),
            "span": data_summary.get("span"),
            "rows": data_summary.get("rows"),
            "entry_z": params.entry_z, "exit_z": params.exit_z, "stop_z": params.stop_z,
        },
        "stats": _stats_clean(result.stats),
        "baseline_return_pct": _num(baseline_return_pct),
        "spy_corr": _num(spy_corr),
        "weekly": _stats_clean(strat_weekly),
        "baseline_weekly": _stats_clean(base_weekly),
        "equity": _series(result.equity),
        "baseline_equity": _series(result.baseline_equity),
        "pairs": pair_rows,
    }


def write_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)
