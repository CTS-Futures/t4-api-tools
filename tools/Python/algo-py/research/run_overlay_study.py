"""
research/run_overlay_study.py

Defensive trend-overlay study: a broad-equity core (SPY) with a moving-average
trend filter — hold SPY while price is above its N-day SMA, otherwise step to cash
(or a reduced weight). This is the most-replicated tactical rule (time-series
momentum / Faber). The point is SMOOTHER RISK-ADJUSTED GROWTH (shallower drawdowns,
higher Sharpe), NOT a higher weekly win rate.

It reuses the same engine as the other studies: a causal SMA signal (acted on with
the backtester's one-bar lag, so no look-ahead) fed through
`multi_backtest.backtest_portfolio`, whose equal-weight baseline is continuous
full-SPY = buy & hold.

    python -m research.run_overlay_study --source csv --sma 200
    python -m research.run_overlay_study --source yahoo --sma 200 --below 0.5
"""

from __future__ import annotations

import argparse
import dataclasses
import os
import sys

import numpy as np
import pandas as pd

from . import config, data, indicators, multi_backtest, report, result_json


def equity_metrics(equity: pd.Series, time_in_market: float) -> dict:
    """Scale-invariant performance from an equity curve (so the growing fixed-share
    position size doesn't distort %-of-starting-cash figures): CAGR, Sharpe and max
    drawdown from daily equity returns, plus weekly win rate / worst week."""
    rets = equity.pct_change().dropna()
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    cagr = (float((equity.iloc[-1] / equity.iloc[0]) ** (1.0 / years) - 1.0) * 100.0
            if years > 0 and equity.iloc[0] > 0 else 0.0)
    sharpe = float(np.sqrt(252) * rets.mean() / rets.std(ddof=0)) if rets.std(ddof=0) > 0 else 0.0
    max_dd = float((equity / equity.cummax() - 1.0).min() * 100.0)
    wk = (equity.resample("W").last().pct_change().dropna() * 100.0)
    return {
        "cagr": cagr,
        "sharpe": sharpe,
        "max_dd_pct": max_dd,
        "pct_winning_weeks": float((wk > 0).mean() * 100.0) if len(wk) else 0.0,
        "worst_week_pct": float(wk.min()) if len(wk) else 0.0,
        "time_in_market_pct": time_in_market,
    }


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Defensive trend-overlay vs buy & hold study")
    ap.add_argument("--source", choices=["csv", "yahoo"], default="csv", help="data source (default: csv; SPY is cached)")
    ap.add_argument("--csv-dir", default=os.path.join(os.path.dirname(__file__), "data_csv"))
    ap.add_argument("--start", default="2018-01-01")
    ap.add_argument("--end", default=config.FETCH_END)
    ap.add_argument("--sma", type=int, default=200, help="trend-filter SMA window in bars (default 200)")
    ap.add_argument("--below", type=float, default=0.0, help="invested fraction when below the SMA (0=cash)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "output_overlay"))
    ap.add_argument("--json", dest="json_path", default=None,
                    help="write the result as JSON to this path (for the PyDemo panel)")
    args = ap.parse_args(argv)

    core = config.SPY
    if args.source == "csv":
        resolution = "csv (as provided)"
        try:
            frames = data.load_csv_all(args.csv_dir, symbols=[core])
        except RuntimeError as e:
            print(f"[overlay] ERROR: {e}", file=sys.stderr)
            return 2
    else:
        resolution = "1-day (Yahoo, adjusted)"
        print(f"[overlay] downloading {core.yahoo_ticker} from Yahoo {args.start}..{args.end}")
        try:
            frames = data.fetch_yahoo_all(symbols=[core], start=args.start, end=args.end)
        except RuntimeError as e:
            print(f"[overlay] ERROR: {e}", file=sys.stderr)
            return 2

    close = frames[core.key]["close"]
    print(f"[overlay] SPY: {len(close)} bars ({close.index.min().date()}..{close.index.max().date()})")

    # Causal trend signal: invested when close > SMA(window), else `below`. The
    # backtester lags positions one bar, so this acts on the prior close — no look-ahead.
    sma = indicators.sma(close, args.sma)
    overlay = pd.Series(np.where(close > sma, 1.0, args.below), index=close.index)
    overlay = overlay.where(sma.notna(), 0.0)  # flat during the SMA warmup
    targets = pd.DataFrame({core.key: overlay})

    # Size so target=1.0 deploys ~ the full $100k (comparable to buy & hold).
    ref = float(close.iloc[0])
    mc = max(1, int(round(config.CostModel().starting_cash / ref)))
    costs = {core.key: dataclasses.replace(config.cost_for(core.key), max_contracts=mc)}

    cfg = config.DEFAULT
    result = multi_backtest.backtest_portfolio(targets, {core.key: close}, cfg, costs_by_key=costs)
    starting = cfg.costs.starting_cash

    # Compare both over the SAME window — from the first bar the overlay can trade
    # (after the SMA warmup) — against a TRUE day-1 buy & hold curve built straight
    # from price (the engine's baseline sits flat through the warmup, which would
    # deflate buy & hold's CAGR/weekly stats).
    start = sma.first_valid_index()
    overlay_eq = result.equity.loc[start:]
    buyhold_eq = starting * (close.loc[start:] / float(close.loc[start]))

    overlay_m = equity_metrics(overlay_eq, result.stats["time_in_market_pct"])
    buyhold_m = equity_metrics(buyhold_eq, 100.0)

    # JSON path (for the PyDemo Research hub): emit machine-readable results, no PNGs.
    if args.json_path:
        data_summary = {
            "source": args.source, "rows": int(len(close)),
            "span": f"{close.index.min().date()} → {close.index.max().date()}",
        }
        obj = result_json.to_overlay_dict(
            overlay_eq, buyhold_eq, overlay_m, buyhold_m,
            window=args.sma, below=args.below, data_summary=data_summary,
        )
        result_json.write_json(args.json_path, obj)
        print(f"[overlay] wrote JSON -> {args.json_path}")
        return 0

    print(f"[overlay] SMA window={args.sma}, below={args.below}  (metrics from equity curve)")
    print(f"[overlay] CAGR:           overlay {overlay_m['cagr']:+.2f}%   vs  buy&hold {buyhold_m['cagr']:+.2f}%")
    print(f"[overlay] Sharpe:         overlay {overlay_m['sharpe']:.2f}     vs  buy&hold {buyhold_m['sharpe']:.2f}")
    print(f"[overlay] max drawdown:   overlay {overlay_m['max_dd_pct']:.1f}%  vs  buy&hold {buyhold_m['max_dd_pct']:.1f}%")
    print(f"[overlay] worst week:     overlay {overlay_m['worst_week_pct']:+.2f}%  vs  buy&hold {buyhold_m['worst_week_pct']:+.2f}%")
    print(f"[overlay] winning weeks:  overlay {overlay_m['pct_winning_weeks']:.1f}%   vs  buy&hold {buyhold_m['pct_winning_weeks']:.1f}%")
    print(f"[overlay] time in market: overlay {overlay_m['time_in_market_pct']:.1f}%  vs  buy&hold {buyhold_m['time_in_market_pct']:.1f}%")

    out_dir = args.out
    try:
        os.makedirs(out_dir, exist_ok=True)
        pd.DataFrame({"overlay_equity": overlay_eq, "buyhold_equity": buyhold_eq}).to_csv(
            os.path.join(out_dir, "pnl.csv"))
    except Exception:
        pass

    images = [report.plot_portfolio_equity(
        overlay_eq, buyhold_eq, out_dir,
        label=f"SPY + {args.sma}d trend overlay", baseline_label="SPY buy & hold",
        title="Equity ($) — trend overlay vs buy & hold")]
    data_summary = {"rows": len(close), "span": f"{close.index.min().date()} → {close.index.max().date()}"}
    path = report.write_overlay_report(
        out_dir=out_dir, window=args.sma, below=args.below,
        overlay_m=overlay_m, buyhold_m=buyhold_m,
        data_summary=data_summary, images=images, resolution=resolution,
    )
    print(f"[overlay] wrote report -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
