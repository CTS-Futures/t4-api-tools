"""
research/run_study.py

Orchestrates the whole study:

    fetch ES/CL/GC  →  align  →  combo model  →  backtest (full + event)  →  report

Two data sources:

    # CSV (default) — drop es.csv / cl.csv / gc.csv into research/data_csv/
    python -m research.run_study
    python -m research.run_study --csv-dir /path/to/csvs

    # T4 sim (once the barchart 400 is sorted — see probe_data.py)
    export T4_API_TOKEN=...
    python -m research.run_study --source t4

Outputs land in research/output/ (report.md + PNGs). --intraday requests Minute
bars from T4 (no effect for CSV, which uses whatever the files contain).
"""

from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

from . import config, data, model as model_mod, report, result_json
from .backtest import backtest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ES combo-signal war-window study")
    ap.add_argument("--source", choices=["csv", "yahoo", "t4"], default="csv",
                    help="data source (default: csv)")
    ap.add_argument("--csv-dir", default=os.path.join(os.path.dirname(__file__), "data_csv"),
                    help="directory holding es.csv / cl.csv / gc.csv (csv source)")
    ap.add_argument("--cache-csv", action="store_true",
                    help="yahoo only: also write the pulled data to --csv-dir for offline reruns")
    ap.add_argument("--intraday", action="store_true", help="T4 only: request Minute bars instead of Day")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "output"))
    ap.add_argument("--json", dest="json_path", default=None,
                    help="write the result as JSON to this path (for the PyDemo panel)")
    args = ap.parse_args(argv)

    if args.source == "csv":
        resolution = "csv (as provided)"
        print(f"[study] loading CSVs from {args.csv_dir}")
        try:
            frames = data.load_csv_all(args.csv_dir)
        except RuntimeError as e:
            print(f"[study] ERROR: {e}", file=sys.stderr)
            return 2
    elif args.source == "yahoo":
        resolution = "1-day (Yahoo, adjusted)"
        tickers = [s.yahoo_ticker for s in config.SYMBOLS]
        print(f"[study] downloading from Yahoo {config.FETCH_START}..{config.FETCH_END}: {tickers}")
        try:
            frames = data.fetch_yahoo_all()
        except RuntimeError as e:
            print(f"[study] ERROR: {e}", file=sys.stderr)
            return 2
        if args.cache_csv:
            data.save_frames_csv(frames, args.csv_dir)
            print(f"[study] cached Yahoo CSVs -> {args.csv_dir}")
    else:
        interval = "Minute" if args.intraday else "Day"
        period = 1
        resolution = f"{period}-{interval.lower()}"
        print(f"[study] fetching ES/CL/GC {config.FETCH_START}..{config.FETCH_END} ({resolution})")
        client = data.make_client()
        try:
            frames = data.fetch_all(client, interval=interval, period=period)
        finally:
            client.close()

    for k, df in frames.items():
        print(f"[study]   {k}: {len(df)} bars "
              f"({df.index.min().date() if len(df) else '-'}..{df.index.max().date() if len(df) else '-'}) "
              f"via {df.attrs.get('exchange_id')}")

    wide = data.align(frames)
    if wide.empty:
        print("[study] ERROR: no overlapping data across ES/CL/GC after alignment.", file=sys.stderr)
        return 2
    print(f"[study] aligned rows: {len(wide)} ({wide.index.min().date()}..{wide.index.max().date()})")

    cfg = config.DEFAULT
    out = model_mod.combine(wide, cfg)
    calib_info = model_mod.calibrate(wide, cfg)
    print(f"[study] calibration: {calib_info}")

    # Full-span backtest.
    full = backtest(out.frame["es_close"], out.target, cfg)
    print(f"[study] full-span stats: {full.stats}")

    # Event-window backtest (slice the target; re-run on the event prices).
    ev_target = out.target.loc[config.EVENT_START:config.EVENT_END]
    ev_prices = out.frame["es_close"].loc[config.EVENT_START:config.EVENT_END]
    if len(ev_prices) < 2:
        print("[study] WARNING: event window has <2 bars — zoom/stats will be thin.")
        event_stats = {k: 0 for k in full.stats}
    else:
        event = backtest(ev_prices, ev_target, cfg)
        event_stats = event.stats
        print(f"[study] event-window stats: {event_stats}")

    # JSON path (for the PyDemo Research hub): emit machine-readable results, no PNGs.
    if args.json_path:
        data_summary = {
            "source": args.source, "resolution": resolution, "rows": len(wide),
            "span": f"{wide.index.min().date()} → {wide.index.max().date()}",
            "event_start": config.EVENT_START, "event_end": config.EVENT_END,
        }
        obj = result_json.to_war_dict(full, event_stats, calib_info=calib_info,
                                      data_summary=data_summary)
        result_json.write_json(args.json_path, obj)
        print(f"[study] wrote JSON -> {args.json_path}")
        return 0

    # Report.
    out_dir = args.out
    images = [
        report.plot_price_positions(out.frame.loc[config.CALIB_START:config.CALIB_END],
                                     full.positions.loc[config.CALIB_START:config.CALIB_END], out_dir),
        report.plot_equity(full, out_dir),
        report.plot_war_zoom(out.frame, full.positions, out_dir),
    ]
    data_summary = {
        "symbols": ", ".join(f"{s.key.upper()}({frames[s.key].attrs.get('exchange_id')})"
                             for s in config.SYMBOLS),
        "rows": len(wide),
    }
    path = report.write_report(
        out_dir=out_dir, full_stats=full.stats, event_stats=event_stats,
        calib_info=calib_info, data_summary=data_summary, images=images,
        resolution=resolution,
    )
    print(f"[study] wrote report -> {path}")
    print(f"[study] artifacts in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
