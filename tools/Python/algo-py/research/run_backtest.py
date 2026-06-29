"""
research/run_backtest.py

Single-instrument backtest runner — surfaces the audited `backtest.backtest()`
engine (one-bar lag, cost model, trade blotter, PnL reconciliation) for ONE symbol
and one signal, and emits a machine-readable JSON result for the PyDemo Backtester
panel. No new strategy math: the target series is built by REUSING the signal
functions in `model.py` (momentum / mean-reversion), the same ones the war study uses.

    # CSV (default; reads research/data_csv/{symbol}.csv) — no token, no network
    python -m research.run_backtest --symbol spy --signal momentum --json out.json
    python -m research.run_backtest --symbol aapl --signal mean_reversion --json out.json

    # Free real data from Yahoo
    python -m research.run_backtest --symbol qqq --source yahoo --signal momentum --json out.json

Without --json it prints the stats to stdout (handy for a quick CLI check).
"""

from __future__ import annotations

import argparse
import dataclasses
import os
import sys

import pandas as pd

from . import config, data, model as model_mod, result_json
from .backtest import backtest

SIGNALS = ("momentum", "mean_reversion")


def _load_close(symbol: str, source: str, csv_dir: str, start: str, end: str) -> pd.Series:
    """Load one instrument's close series from CSV or Yahoo. CSV reads
    {csv_dir}/{symbol}.csv directly (any OHLCV file load_csv_symbol understands),
    so the symbol need not be in config.SYMBOLS."""
    if source == "csv":
        path = os.path.join(csv_dir, f"{symbol}.csv")
        if not os.path.exists(path):
            raise RuntimeError(
                f"No CSV for {symbol!r} at {path}. Expected {symbol}.csv in {csv_dir} "
                f"(or use --source yahoo)."
            )
        df = data.load_csv_symbol(path)
    else:
        sym = config.Symbol(symbol, symbol.upper(), symbol.upper(),
                            ["ARCA", "NASDAQ", "NYSE"], yahoo=symbol.upper())
        df = data.fetch_yahoo_symbol(sym, start=start, end=end)
    close = df["close"].astype(float)
    if len(close) < 30:
        raise RuntimeError(f"{symbol}: only {len(close)} bars — too few to backtest.")
    return close


def _build_target(close: pd.Series, signal: str, zscore_lookback: int) -> pd.Series:
    if signal == "momentum":
        return model_mod.momentum_score(close, config.DEFAULT.indicators)
    if signal == "mean_reversion":
        return model_mod.mean_reversion_score(close, zscore_lookback)
    raise RuntimeError(f"unknown signal {signal!r}; choose from {SIGNALS}")


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Single-instrument signal backtest")
    ap.add_argument("--symbol", default="spy", help="instrument key (CSV file name / Yahoo ticker), e.g. spy")
    ap.add_argument("--source", choices=["csv", "yahoo"], default="csv",
                    help="data source (default: csv — reads research/data_csv/{symbol}.csv)")
    ap.add_argument("--csv-dir", default=os.path.join(os.path.dirname(__file__), "data_csv"))
    ap.add_argument("--signal", choices=list(SIGNALS), default="momentum")
    ap.add_argument("--zscore-lookback", type=int, default=config.DEFAULT.indicators.zscore_lookback,
                    help="mean_reversion lookback in bars (default 252)")
    ap.add_argument("--start", default="2018-01-01")
    ap.add_argument("--end", default=config.FETCH_END)
    ap.add_argument("--json", dest="json_path", default=None,
                    help="write the result as JSON to this path (for the PyDemo panel)")
    args = ap.parse_args(argv)

    try:
        close = _load_close(args.symbol, args.source, args.csv_dir, args.start, args.end)
    except RuntimeError as e:
        print(f"[backtest] ERROR: {e}", file=sys.stderr)
        return 2

    target = _build_target(close, args.signal, args.zscore_lookback).reindex(close.index)

    # Size as an equity/share position: point_value = $1, and a |target|=1 deploys
    # ~the full starting cash (max_contracts ≈ cash / price), so equity is on the
    # same scale as a buy & hold of the same capital.
    ref = float(close.iloc[0])
    mc = max(1, int(round(config.CostModel().starting_cash / ref))) if ref > 0 else 1
    costs = dataclasses.replace(config.PORTFOLIO_BASE_COST, point_value=1.0, max_contracts=mc)
    cfg = dataclasses.replace(config.DEFAULT, costs=costs)

    result = backtest(close, target, cfg)

    # Comparable own-the-asset baseline: all starting cash in the symbol on day 1.
    buy_hold = costs.starting_cash * (close / float(close.iloc[0]))

    print(f"[backtest] {args.symbol} / {args.signal}: {len(close)} bars "
          f"({close.index.min().date()}..{close.index.max().date()})")
    print(f"[backtest] stats: {result.stats}")

    if args.json_path:
        data_summary = {
            "source": args.source,
            "rows": int(len(close)),
            "span": f"{close.index.min().date()} → {close.index.max().date()}",
        }
        params = {
            "signal": args.signal,
            "zscore_lookback": args.zscore_lookback,
            "max_contracts": mc,
            "point_value": 1.0,
            "starting_cash": costs.starting_cash,
        }
        obj = result_json.to_backtest_dict(
            result, buy_hold, symbol=args.symbol, signal=args.signal,
            params=params, data_summary=data_summary,
        )
        result_json.write_json(args.json_path, obj)
        print(f"[backtest] wrote JSON -> {args.json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
