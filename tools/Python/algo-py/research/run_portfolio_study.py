"""
research/run_portfolio_study.py

Orchestrates the slow-rebuild rotation study:

    fetch/align basket  →  walk-forward re-tune  →  multi-asset OOS backtest  →  report

Two data sources (CSV is the default; the T4 barchart currently 400s — see
probe_data.py):

    # CSV (default) — drop one Yahoo Finance OHLCV export per basket member into
    # research/data_csv/, named by key: spy.csv / qqq.csv / dia.csv / iwm.csv
    python -m research.run_portfolio_study
    python -m research.run_portfolio_study --csv-dir /path/to/csvs

    # Futures basket via T4 (once the barchart 400 is sorted)
    export T4_API_TOKEN=...
    python -m research.run_portfolio_study --source t4 --basket futures

Outputs land in research/output_portfolio/ (report.md + PNGs).
"""

from __future__ import annotations

import argparse
import os
import sys

from . import config, data, multi_backtest, portfolio as pf, report, result_json, walkforward


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Slow-rebuild momentum/value rotation study")
    ap.add_argument("--source", choices=["csv", "yahoo", "t4"], default="csv", help="data source (default: csv)")
    ap.add_argument("--basket", choices=["etf", "futures"], default="etf",
                    help="etf=SPY/QQQ/DIA/IWM, futures=ES/NQ/YM/RTY")
    ap.add_argument("--keys", default=None,
                    help="comma-separated subset of basket keys to actually run "
                         "(e.g. 'es,nq,rty' to drop an instrument with no data). "
                         "Defaults to the whole basket.")
    ap.add_argument("--csv-dir", default=os.path.join(os.path.dirname(__file__), "data_csv"),
                    help="directory of per-key CSVs (csv source)")
    ap.add_argument("--cache-csv", action="store_true",
                    help="yahoo only: also write the pulled data to --csv-dir for offline reruns")
    ap.add_argument("--start", default=config.FETCH_START,
                    help=f"yahoo/t4: fetch start (default {config.FETCH_START}). "
                         "The walk-forward needs >warmup+retune bars, so a multi-year "
                         "span gives a meaningful out-of-sample window.")
    ap.add_argument("--end", default=config.FETCH_END,
                    help=f"yahoo/t4: fetch end (default {config.FETCH_END})")
    ap.add_argument("--gross-target", type=float, default=config.DEFAULT.portfolio.gross_target,
                    help="sum of |target| spread across held names (default "
                         f"{config.DEFAULT.portfolio.gross_target}). Each name is still "
                         "clipped to |1.0|, so the effective max is top_n * 1.0.")
    ap.add_argument("--max-contracts", type=int, default=config.PORTFOLIO_BASE_COST.max_contracts,
                    help="contracts/shares at |target|=1.0 (default "
                         f"{config.PORTFOLIO_BASE_COST.max_contracts}). This is the real "
                         "capital-deployment lever; raise it with --gross-target to invest more.")
    ap.add_argument("--intraday", action="store_true", help="T4 only: Minute bars instead of Day")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "output_portfolio"))
    ap.add_argument("--json", dest="json_path", default=None,
                    help="write machine-readable results to this path (skips PNG/report; for the UI bridge)")
    args = ap.parse_args(argv)

    basket = config.EQUITY_INDEX_FUTURES if args.basket == "futures" else config.EQUITY_INDEX_ETFS
    if args.keys:
        wanted = [k.strip().lower() for k in args.keys.split(",") if k.strip()]
        basket = [s for s in basket if s.key in wanted]
        if not basket:
            print(f"[portfolio] ERROR: --keys {args.keys!r} matched no {args.basket} "
                  "basket members.", file=sys.stderr)
            return 2

    if args.source == "csv":
        resolution = "csv (as provided)"
        print(f"[portfolio] loading CSVs from {args.csv_dir} for {[s.key for s in basket]}")
        try:
            frames = data.load_csv_all(args.csv_dir, symbols=basket)
        except RuntimeError as e:
            print(f"[portfolio] ERROR: {e}", file=sys.stderr)
            return 2
    elif args.source == "yahoo":
        resolution = "1-day (Yahoo, adjusted)"
        tickers = [s.yahoo_ticker for s in basket]
        print(f"[portfolio] downloading from Yahoo {args.start}..{args.end}: {tickers}")
        try:
            frames = data.fetch_yahoo_all(symbols=basket, start=args.start, end=args.end)
        except RuntimeError as e:
            print(f"[portfolio] ERROR: {e}", file=sys.stderr)
            return 2
        if args.cache_csv:
            data.save_frames_csv(frames, args.csv_dir)
            print(f"[portfolio] cached Yahoo CSVs -> {args.csv_dir}")
    else:
        interval = "Minute" if args.intraday else "Day"
        resolution = f"1-{interval.lower()}"
        print(f"[portfolio] fetching {[s.key for s in basket]} {args.start}..{args.end} ({resolution})")
        client = data.make_client()
        try:
            frames = data.fetch_all(client, symbols=basket, interval=interval, period=1,
                                    start=args.start, end=args.end)
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    for k, df in frames.items():
        lo = df.index.min().date() if len(df) else "-"
        hi = df.index.max().date() if len(df) else "-"
        print(f"[portfolio]   {k}: {len(df)} bars ({lo}..{hi}) via {df.attrs.get('exchange_id')}")

    wide = data.align(frames)
    if wide.empty:
        print("[portfolio] ERROR: no overlapping data across the basket after alignment.", file=sys.stderr)
        return 2
    print(f"[portfolio] aligned rows: {len(wide)} ({wide.index.min().date()}..{wide.index.max().date()})")

    # Sizing overrides. gross_target is per-name-clipped to |1.0|, so capital
    # deployment also needs max_contracts (the $-per-|target|=1.0 lever). The cost
    # model is sourced via config.cost_for(key) -> PORTFOLIO_BASE_COST at call
    # time, so reassign that module default to propagate to every instrument.
    import dataclasses
    config.PORTFOLIO_BASE_COST = dataclasses.replace(
        config.PORTFOLIO_BASE_COST, max_contracts=args.max_contracts)
    cfg = dataclasses.replace(
        config.DEFAULT,
        portfolio=dataclasses.replace(config.DEFAULT.portfolio, gross_target=args.gross_target))
    print(f"[portfolio] sizing: gross_target={cfg.portfolio.gross_target} "
          f"max_contracts={config.PORTFOLIO_BASE_COST.max_contracts}")
    closes = pf.closes_from_wide(wide, basket)

    if len(wide) <= cfg.walk.warmup + cfg.walk.retune_days:
        print(f"[portfolio] ERROR: only {len(wide)} bars; need > warmup ({cfg.walk.warmup}) "
              f"+ retune ({cfg.walk.retune_days}). Provide more history.", file=sys.stderr)
        return 2

    print("[portfolio] walk-forward re-tuning (this is the slow rebuild)...")
    wf = walkforward.run_walkforward(closes, cfg)
    n_sw = int(wf.params_log["switched"].astype(bool).sum()) if len(wf.params_log) else 0
    print(f"[portfolio] re-tunes: {len(wf.params_log)} ({n_sw} switched parameters)")

    result = multi_backtest.backtest_portfolio(wf.targets, closes, cfg)
    print(f"[portfolio] OOS stats: {result.stats}")

    starting = cfg.costs.starting_cash
    baseline_return_pct = float((result.baseline_equity.iloc[-1] - starting) / starting * 100.0)
    print(f"[portfolio] equal-weight buy&hold return: {baseline_return_pct:.2f}%")

    # Weekly-consistency lens — "how often does it actually win on a weekly basis?"
    base_pnl = result.baseline_equity.diff().fillna(0.0)
    strat_wk = multi_backtest.weekly_consistency(result.pnl, starting)
    base_wk = multi_backtest.weekly_consistency(base_pnl, starting)
    # Persist raw PnL so the weekly lens can be re-analysed without re-running the
    # slow walk-forward.
    try:
        os.makedirs(args.out, exist_ok=True)
        import pandas as _pd
        _pd.DataFrame({"strategy": result.pnl, "buyhold": base_pnl}).to_csv(
            os.path.join(args.out, "pnl.csv"))
    except Exception:
        pass
    print("[portfolio] --- weekly consistency (strategy vs buy&hold) ---")
    print(f"[portfolio]   active weeks:    {strat_wk['n_active_weeks']}/{strat_wk['n_weeks']}  vs  {base_wk['n_active_weeks']}/{base_wk['n_weeks']}")
    print(f"[portfolio]   winning weeks:   {strat_wk['pct_winning_weeks']:.1f}%  vs  {base_wk['pct_winning_weeks']:.1f}%")
    print(f"[portfolio]   avg week:        {strat_wk['avg_week_pct']:+.3f}%  vs  {base_wk['avg_week_pct']:+.3f}%")
    print(f"[portfolio]   avg WIN week:    {strat_wk['avg_win_week_pct']:+.3f}%  vs  {base_wk['avg_win_week_pct']:+.3f}%")
    print(f"[portfolio]   avg LOSS week:   {strat_wk['avg_loss_week_pct']:+.3f}%  vs  {base_wk['avg_loss_week_pct']:+.3f}%")
    print(f"[portfolio]   win/loss ratio:  {strat_wk['win_loss_ratio']:.2f}    vs  {base_wk['win_loss_ratio']:.2f}")
    print(f"[portfolio]   worst week:      {strat_wk['worst_week_pct']:+.3f}%  vs  {base_wk['worst_week_pct']:+.3f}%")
    print(f"[portfolio]   longest losing streak: {strat_wk['max_losing_streak_weeks']}w  vs  {base_wk['max_losing_streak_weeks']}w")
    print(f"[portfolio]   weekly Sharpe:   {strat_wk['weekly_sharpe']:.2f}    vs  {base_wk['weekly_sharpe']:.2f}")

    data_summary = {
        "symbols": ", ".join(f"{s.key.upper()}({frames[s.key].attrs.get('exchange_id')})" for s in basket),
        "rows": len(wide),
        "span": f"{wide.index.min().date()} → {wide.index.max().date()}",
        "source": args.source,
        "resolution": resolution,
    }

    # JSON path (for the JSDemo UI bridge): emit machine-readable results, no PNGs.
    if args.json_path:
        obj = result_json.to_result_dict(wf, result, cfg, data_summary, baseline_return_pct)
        result_json.write_json(args.json_path, obj)
        print(f"[portfolio] wrote JSON -> {args.json_path}")
        return 0

    out_dir = args.out
    images = [
        report.plot_portfolio_equity(result.equity, result.baseline_equity, out_dir),
        report.plot_param_drift(wf.params_log, out_dir),
        report.plot_holdings_heatmap(result.targets, out_dir),
    ]
    path = report.write_portfolio_report(
        out_dir=out_dir, stats=result.stats, baseline_return_pct=baseline_return_pct,
        params_log=wf.params_log, data_summary=data_summary, images=images,
        cfg=cfg, resolution=resolution,
    )
    print(f"[portfolio] wrote report -> {path}")
    print(f"[portfolio] artifacts in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
