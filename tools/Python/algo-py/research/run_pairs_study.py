"""
research/run_pairs_study.py

Orchestrates the market-neutral cross-sector pairs study:

    fetch/align universe  →  select cointegrated pairs (in-sample)
                          →  trade spread z-score (out-of-sample)
                          →  weekly-consistency lens + SPY-neutrality check  →  report

The point of this study is WEEKLY CONSISTENCY, not max return: long the laggard
leg, short the leader leg, profit when the spread reverts — so the weekly win rate
is driven by mean-reversion, not by the market going up (weekly corr to SPY ≈ 0).

    # Real data from Yahoo (default), select on <=2021, trade 2022+ OOS
    python -m research.run_pairs_study --source yahoo --start 2018-01-01 --end 2025-06-30

    # Reuse cached CSVs (after a --cache-csv run); needs one CSV per universe key
    python -m research.run_pairs_study --source csv

Outputs land in research/output_pairs/ (report.md + PNGs).
"""

from __future__ import annotations

import argparse
import dataclasses
import os
import sys

import numpy as np
import pandas as pd

from . import config, data, multi_backtest, pairs as pairs_mod, report, result_json


def _weekly_returns(pnl: pd.Series, starting: float) -> pd.Series:
    return (pnl.resample("W").sum() / starting).dropna()


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to cp1252; keep prints from crashing on any non-ASCII.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Market-neutral cross-sector pairs study")
    ap.add_argument("--source", choices=["csv", "yahoo"], default="yahoo", help="data source (default: yahoo)")
    ap.add_argument("--universe", choices=["pairs", "large"], default="pairs",
                    help="pairs=~24 names, large=~80 liquid names + ETFs (more cointegrated pairs)")
    ap.add_argument("--csv-dir", default=os.path.join(os.path.dirname(__file__), "data_csv"))
    ap.add_argument("--cache-csv", action="store_true", help="yahoo: also write pulled data to --csv-dir")
    ap.add_argument("--start", default="2018-01-01", help="fetch start (default 2018-01-01)")
    ap.add_argument("--end", default=config.FETCH_END, help=f"fetch end (default {config.FETCH_END})")
    ap.add_argument("--calib-end", default=config.DEFAULT.pairs.calib_end,
                    help="in-sample/out-of-sample split (pairs selected on data up to here)")
    ap.add_argument("--top-pairs", type=int, default=config.DEFAULT.pairs.top_pairs)
    ap.add_argument("--entry-z", type=float, default=config.DEFAULT.pairs.entry_z)
    ap.add_argument("--exit-z", type=float, default=config.DEFAULT.pairs.exit_z)
    ap.add_argument("--stop-z", type=float, default=config.DEFAULT.pairs.stop_z,
                    help="divergence stop: bail when |z| exceeds this (use a big number to disable)")
    ap.add_argument("--z-lookback", type=int, default=config.DEFAULT.pairs.z_lookback)
    ap.add_argument("--min-corr", type=float, default=config.DEFAULT.pairs.min_corr)
    ap.add_argument("--max-pvalue", type=float, default=config.DEFAULT.pairs.max_pvalue)
    ap.add_argument("--dollar-per-leg", type=float, default=config.DEFAULT.pairs.dollar_per_leg)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "output_pairs"))
    ap.add_argument("--json", dest="json_path", default=None,
                    help="write the result as JSON to this path (for the PyDemo panel)")
    args = ap.parse_args(argv)

    params = dataclasses.replace(
        config.DEFAULT.pairs, calib_end=args.calib_end, top_pairs=args.top_pairs,
        entry_z=args.entry_z, exit_z=args.exit_z, stop_z=args.stop_z, z_lookback=args.z_lookback,
        min_corr=args.min_corr, max_pvalue=args.max_pvalue, dollar_per_leg=args.dollar_per_leg,
    )
    universe = config.LARGE_UNIVERSE if args.universe == "large" else config.PAIRS_UNIVERSE
    fetch_syms = universe + [config.SPY]  # SPY = market-neutrality reference

    # --- data ---------------------------------------------------------------
    if args.source == "csv":
        resolution = "csv (as provided)"
        print(f"[pairs] loading CSVs from {args.csv_dir} for {len(fetch_syms)} symbols")
        try:
            frames = data.load_csv_all(args.csv_dir, symbols=fetch_syms)
        except RuntimeError as e:
            print(f"[pairs] ERROR: {e}", file=sys.stderr)
            return 2
    else:
        resolution = "1-day (Yahoo, adjusted)"
        print(f"[pairs] downloading {len(fetch_syms)} symbols from Yahoo {args.start}..{args.end}")
        try:
            frames = data.fetch_yahoo_all(symbols=fetch_syms, start=args.start, end=args.end)
        except RuntimeError as e:
            print(f"[pairs] ERROR: {e}", file=sys.stderr)
            return 2
        if args.cache_csv:
            data.save_frames_csv(frames, args.csv_dir)
            print(f"[pairs] cached CSVs -> {args.csv_dir}")

    wide = data.align(frames)
    if wide.empty:
        print("[pairs] ERROR: no overlapping data across the universe after alignment.", file=sys.stderr)
        return 2
    print(f"[pairs] aligned rows: {len(wide)} ({wide.index.min().date()}..{wide.index.max().date()})")

    closes = {s.key: wide[f"{s.key}_close"] for s in universe}
    spy_close = wide["spy_close"]

    # --- select pairs (in-sample) ------------------------------------------
    print(f"[pairs] selecting pairs on data up to {params.calib_end} "
          f"(min_corr={params.min_corr}, max_pvalue={params.max_pvalue})...")
    pairs = pairs_mod.select_pairs(closes, params)
    if not pairs:
        print("[pairs] ERROR: no cointegrated pairs found. Loosen --min-corr / --max-pvalue.", file=sys.stderr)
        return 2
    print(f"[pairs] selected {len(pairs)} disjoint pairs:")
    for p in pairs:
        print(f"[pairs]   {p.a.upper():>5}-{p.b.upper():<5}  beta={p.beta:+.2f}  coint_p={p.pvalue:.3f}  corr={p.corr:.2f}")

    # --- build targets + dollar-neutral sizing, backtest OOS ----------------
    targets, zscores = pairs_mod.build_targets(wide, pairs, params)
    costs = pairs_mod.dollar_neutral_costs(wide, pairs, params)
    leg_closes = {k: closes[k] for k in targets.columns}

    cfg = config.DEFAULT
    result = multi_backtest.backtest_portfolio(targets, leg_closes, cfg, costs_by_key=costs)
    print(f"[pairs] OOS stats: {result.stats}")

    starting = cfg.costs.starting_cash
    baseline_return_pct = float((result.baseline_equity.iloc[-1] - starting) / starting * 100.0)

    # --- weekly consistency + SPY-neutrality --------------------------------
    base_pnl = result.baseline_equity.diff().fillna(0.0)
    strat_wk = multi_backtest.weekly_consistency(result.pnl, starting)
    base_wk = multi_backtest.weekly_consistency(base_pnl, starting)

    # Weekly-return correlation to SPY over the OOS span (≈0 ⇒ market-neutral).
    strat_w = _weekly_returns(result.pnl.loc[params.calib_end:], starting)
    spy_w = spy_close.loc[params.calib_end:].resample("W").last().pct_change()
    join = pd.concat([strat_w.rename("s"), spy_w.rename("spy")], axis=1).dropna()
    join = join[join["s"] != 0.0]  # only weeks the strategy was active
    spy_corr = float(join["s"].corr(join["spy"])) if len(join) > 2 else float("nan")

    print("[pairs] --- weekly consistency (pairs vs buy&hold) ---")
    print(f"[pairs]   active weeks:    {strat_wk['n_active_weeks']}/{strat_wk['n_weeks']}  vs  {base_wk['n_active_weeks']}/{base_wk['n_weeks']}")
    print(f"[pairs]   winning weeks:   {strat_wk['pct_winning_weeks']:.1f}%  vs  {base_wk['pct_winning_weeks']:.1f}%")
    print(f"[pairs]   avg week:        {strat_wk['avg_week_pct']:+.3f}%  vs  {base_wk['avg_week_pct']:+.3f}%")
    print(f"[pairs]   avg WIN week:    {strat_wk['avg_win_week_pct']:+.3f}%  vs  {base_wk['avg_win_week_pct']:+.3f}%")
    print(f"[pairs]   avg LOSS week:   {strat_wk['avg_loss_week_pct']:+.3f}%  vs  {base_wk['avg_loss_week_pct']:+.3f}%")
    print(f"[pairs]   worst week:      {strat_wk['worst_week_pct']:+.3f}%  vs  {base_wk['worst_week_pct']:+.3f}%")
    print(f"[pairs]   longest losing streak: {strat_wk['max_losing_streak_weeks']}w  vs  {base_wk['max_losing_streak_weeks']}w")
    print(f"[pairs]   weekly Sharpe:   {strat_wk['weekly_sharpe']:.2f}    vs  {base_wk['weekly_sharpe']:.2f}")
    print(f"[pairs]   weekly-return corr to SPY: {spy_corr:.2f}  (~0 => market-neutral)")

    # JSON path (for the PyDemo Research hub): emit machine-readable results, no PNGs.
    if args.json_path:
        data_summary = {
            "source": args.source, "n_universe": len(universe), "rows": len(wide),
            "span": f"{wide.index.min().date()} → {wide.index.max().date()}",
        }
        obj = result_json.to_pairs_dict(
            result, pairs=pairs, zscores=zscores, strat_weekly=strat_wk,
            base_weekly=base_wk, spy_corr=spy_corr, baseline_return_pct=baseline_return_pct,
            params=params, data_summary=data_summary,
        )
        result_json.write_json(args.json_path, obj)
        print(f"[pairs] wrote JSON -> {args.json_path}")
        return 0

    # --- report -------------------------------------------------------------
    out_dir = args.out
    try:
        os.makedirs(out_dir, exist_ok=True)
        pd.DataFrame({"strategy": result.pnl, "buyhold": base_pnl}).to_csv(os.path.join(out_dir, "pnl.csv"))
    except Exception:
        pass

    images = [
        report.plot_portfolio_equity(result.equity, result.baseline_equity, out_dir),
        report.plot_holdings_heatmap(result.targets, out_dir),
    ]
    for p in pairs:
        images.append(report.plot_spread_zscore(wide, p, zscores[p.label], params, out_dir))

    data_summary = {
        "n_universe": len(universe),
        "rows": len(wide),
        "span": f"{wide.index.min().date()} → {wide.index.max().date()}",
    }
    path = report.write_pairs_report(
        out_dir=out_dir, stats=result.stats, baseline_return_pct=baseline_return_pct,
        strat_weekly=strat_wk, base_weekly=base_wk, spy_corr=spy_corr, pairs=pairs,
        data_summary=data_summary, images=images, params=params, resolution=resolution,
    )
    print(f"[pairs] wrote report -> {path}")
    print(f"[pairs] artifacts in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
