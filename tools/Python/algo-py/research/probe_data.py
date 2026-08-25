"""
research/probe_data.py  —  STEP 0 GATE

Before building anything on T4 data, confirm the unknowns that can't be answered
from code:

  1. Auth: is the T4_API_TOKEN valid?
  2. Symbols: which exchange_id actually returns ES / CL / GC?
  3. Retention: does the sim feed serve the JUNE 2025 window (and the prior year)?
  4. Resolution: is intraday (Minute) available for the window, or only Day?

It prints a per-symbol coverage table and a clear GO / NO-GO verdict. Run:

    export T4_API_TOKEN=...
    python -m research.probe_data        # from algo-py/

NO-GO means the sim feed lacks the window — at which point we decide on a
fallback data source (CSV / free daily) rather than silently degrading.
"""

from __future__ import annotations

import sys
from typing import Optional

import pandas as pd

from . import config, data


def _probe_one(client, symbol: config.Symbol, start: str, end: str, interval: str) -> dict:
    result = {"symbol": symbol.key, "interval": interval, "exchange": None,
              "bars": 0, "first": None, "last": None, "error": None}
    try:
        df = data.fetch_symbol(client, symbol, start=start, end=end, interval=interval, period=1)
        result["exchange"] = df.attrs.get("exchange_id")
        result["bars"] = len(df)
        if len(df):
            result["first"] = df.index.min().date().isoformat()
            result["last"] = df.index.max().date().isoformat()
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def main(argv: Optional[list[str]] = None) -> int:
    try:
        token = data.get_token()
    except RuntimeError as e:
        print(f"[probe] {e}", file=sys.stderr)
        return 2

    client = data.make_client(token)
    rows = []
    try:
        for sym in config.SYMBOLS:
            # (a) recent sanity window (~last 10 days) — proves auth+symbol work now
            now = pd.Timestamp.now("UTC").normalize()
            recent_start = (now - pd.Timedelta(days=10)).date().isoformat()
            recent_end = now.date().isoformat()
            rows.append({"phase": "recent", **_probe_one(client, sym, recent_start, recent_end, "Day")})
            # (b) the event window itself (daily)
            rows.append({"phase": "event-day", **_probe_one(client, sym, config.EVENT_START, config.EVENT_END, "Day")})
            # (c) the event window intraday (optional finer zoom)
            rows.append({"phase": "event-min", **_probe_one(client, sym, config.EVENT_START, config.EVENT_END, "Minute")})
            # (d) the start of the calibration year (retention depth check)
            rows.append({"phase": "calib-start", **_probe_one(client, sym, config.CALIB_START,
                                                              (pd.Timestamp(config.CALIB_START) + pd.Timedelta(days=7)).date().isoformat(),
                                                              "Day")})
    finally:
        client.close()

    table = pd.DataFrame(rows)
    print("\n=== T4 data probe ===")
    with pd.option_context("display.max_columns", None, "display.width", 160):
        print(table.to_string(index=False))

    # GO/NO-GO: every symbol must return DAILY bars for the event window AND the
    # calibration start. Intraday is a bonus.
    def covered(phase: str) -> set:
        ok = table[(table["phase"] == phase) & (table["bars"] > 0)]["symbol"]
        return set(ok)

    need = {s.key for s in config.SYMBOLS}
    event_ok = covered("event-day")
    calib_ok = covered("calib-start")
    intraday_ok = covered("event-min")

    print("\n--- verdict ---")
    print(f"event window (daily) covered for : {sorted(event_ok) or 'NONE'}")
    print(f"calibration start covered for    : {sorted(calib_ok) or 'NONE'}")
    print(f"intraday available for           : {sorted(intraday_ok) or 'NONE'}")

    if need <= event_ok and need <= calib_ok:
        extra = " (intraday available - can run --intraday)" if need <= intraday_ok else " (daily only)"
        print(f"\n[GO]  -- full ~1yr + event window available for ES/CL/GC{extra}")
        return 0

    missing_event = sorted(need - event_ok)
    missing_calib = sorted(need - calib_ok)
    print("\n[NO-GO]  -- sim feed does not fully cover the study window.")
    if missing_event:
        print(f"  missing event-window data for : {missing_event}")
    if missing_calib:
        print(f"  missing calibration-year data for : {missing_calib}")
    print("  → choose a fallback data source (user CSVs / free daily) before proceeding.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
