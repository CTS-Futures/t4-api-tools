"""study/t4_fetch.py

Source the Portfolio Study's futures bars from T4 the SAME way the Backtester
does — via :class:`chart.history.ChartHistory`, which is binary-first with a JSON
fallback. The study's old path (``algo-py``'s ``research.data.fetch_symbol``)
called ``get_barchart_binary`` with no fallback, so it died on the binary
``/chart/barchart`` 400 that ChartHistory recovers from via JSON.

We fetch each futures instrument here (in PyDemo's process, where the live
authenticated client lives), write one ``{key}.csv`` per instrument, and let the
study run over them through its existing, reliable ``--source csv`` path. No
token plumbing into the subprocess, no fragile binary-only fetch.

Daily bars only (the rotation study is daily). BLOCKING (HTTP) — call from a
worker thread, never the Tk/asyncio main thread.
"""

from __future__ import annotations

import csv
import os
from typing import Callable, List, Optional, Tuple

from chart.history import ChartHistory

_DAILY = 86400  # seconds; ChartHistory maps this to T4 ("Day", 1)


class FetchError(RuntimeError):
    """Raised when a futures instrument yields no bars over the window."""


# Futures basket, mirrored from algo-py/research/config.py (EQUITY_INDEX_FUTURES).
# (key, contract_id, [exchange candidates tried in order]). The key names the CSV
# file and the study's DataFrame column, so it must match the futures basket keys.
_FUTURES: List[Tuple[str, str, List[str]]] = [
    ("es", "ES", ["CME_Eq", "CME_E", "CME"]),
    ("nq", "NQ", ["CME_Eq", "CME_E", "CME"]),
    # YM (E-mini Dow) is a CBOT product; some T4 feeds group it under CME_Eq, so
    # try that too. On feeds that carry none of these it's dropped (see below).
    ("ym", "YM", ["CBOT", "CME_CBOT", "CME_Eq", "CME"]),
    ("rty", "RTY", ["CME_Eq", "CME_E", "CME"]),
]

# The rotation study needs a basket; run on whatever's available down to this many.
_MIN_SYMBOLS = 2

_CSV_HEADER = ("date", "open", "high", "low", "close", "volume")


def _tz_offset_hours(client) -> float:
    try:
        cfg = (getattr(client, "config", None) or {}).get("chart", {}) or {}
        return float(cfg.get("tz_offset_hours", 0.0) or 0.0)
    except Exception:  # noqa: BLE001 - best-effort
        return 0.0


def _live_price_for(client, contract_id: str) -> Optional[float]:
    """The charted last price, but only when it's the SAME contract we're fetching
    (so JSON price-scaling calibrates against the right instrument)."""
    if (getattr(client, "md_contract_id", None) or "").upper() != contract_id.upper():
        return None
    cw = getattr(client, "chart_window", None)
    return getattr(cw, "_last_price", None) if cw else None


def fetch_futures_csvs(
    client,
    start: str,
    end: str,
    out_dir: str,
    on_line: Optional[Callable[[str], None]] = None,
) -> List[Tuple[str, int]]:
    """Fetch daily bars for the ES/NQ/YM/RTY futures over [start, end] and write one
    ``{key}.csv`` per instrument that returns data into ``out_dir``.

    Instruments that return no bars (e.g. YM on a feed that doesn't carry the Dow)
    are SKIPPED with a warning rather than failing the run — the study then trades
    the available subset. Returns [(key, n_bars), ...] for the symbols written.

    Raises:
        FetchError: no token, or fewer than _MIN_SYMBOLS instruments return data.
    """
    token = getattr(client, "jw_token", None)
    if not token:
        raise FetchError("Connect/login to T4 first — the study needs a live token.")
    api = getattr(client, "apiUrl", None)
    base_url = (api.rstrip("/") + "/chart") if api else None
    tz = _tz_offset_hours(client)

    def emit(msg: str) -> None:
        if on_line is not None:
            try:
                on_line(msg)
            except Exception:  # noqa: BLE001 - progress is best-effort
                pass

    results: List[Tuple[str, int]] = []
    dropped: List[str] = []
    for key, contract_id, candidates in _FUTURES:
        live_price = _live_price_for(client, contract_id)
        bars: list = []
        source = "none"
        used_exchange = None
        hist = ChartHistory(token, base_url=base_url, tz_offset_hours=tz)
        try:
            for exch in candidates:
                # Prefer a roll-stitched continuous series for the multi-month
                # window; if that yields nothing, retry the same exchange without
                # continuation (some sim feeds don't serve it).
                for cont in ("Volume", None):
                    got, src = hist.fetch(
                        exchange_id=exch,
                        contract_id=contract_id,
                        market_id=None,
                        interval_seconds=_DAILY,
                        trade_date_start=start,
                        trade_date_end=end,
                        live_price=live_price,
                        continuation_type=cont,
                    )
                    if got:
                        bars, source, used_exchange = got, src, exch
                        break
                if bars:
                    break
        finally:
            hist.close()

        if not bars:
            dropped.append(key)
            emit(f"[fetch] {key}: no bars (tried {', '.join(candidates)}) — skipping")
            continue

        path = os.path.join(out_dir, f"{key}.csv")
        _write_csv(path, bars)
        results.append((key, len(bars)))
        emit(f"[fetch] {key}: {len(bars)} daily bars via {source} ({used_exchange})")

    if len(results) < _MIN_SYMBOLS:
        have = ", ".join(k for k, _ in results) or "none"
        raise FetchError(
            f"Only {len(results)} instrument(s) returned data ({have}); the rotation "
            f"study needs at least {_MIN_SYMBOLS}. Widen the From/To window or check "
            "T4 market-data entitlements."
        )
    if dropped:
        emit(f"[fetch] running on {', '.join(k for k, _ in results)} "
             f"(unavailable on this feed: {', '.join(dropped)})")
    return results


def _write_csv(path: str, bars: list) -> None:
    """Write ChartHistory bars ({time: datetime, open, high, low, close, volume})
    to a daily OHLCV CSV that research.data.load_csv_symbol can read."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(_CSV_HEADER)
        for b in bars:
            t = b.get("time")
            day = t.strftime("%Y-%m-%d") if hasattr(t, "strftime") else str(t)
            w.writerow([
                day,
                b.get("open"), b.get("high"), b.get("low"), b.get("close"),
                int(b.get("volume", 0) or 0),
            ])
