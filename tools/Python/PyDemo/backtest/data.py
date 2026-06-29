"""backtest/data.py

Bar sourcing for the Backtester — T4 JSON data only (no CSV/Yahoo). Mirrors
JSDemo's two modes:

- ``chart_bars(client)`` — reuse the chart window's already-loaded bars (what's
  on screen), so the backtest and the chart agree exactly. Used when From/To are
  blank.
- ``fetch_t4_bars(...)`` — fetch a fresh range for the currently-selected market
  via :class:`chart.history.ChartHistory` (binary-first, JSON fallback). Used
  when From/To are set. BLOCKING (HTTP) — call from a worker thread.

Both return engine-ready bars: ``{time: int UTC seconds, open, high, low, close,
volume}`` ascending, which is what :class:`backtest.backtester.Backtester` wants.
"""

from __future__ import annotations

from chart.history import ChartHistory


class BacktestDataError(RuntimeError):
    """Raised when bars can't be sourced (no login/market, empty, etc.)."""


def _to_engine_bars(bars) -> list[dict]:
    """Normalize ChartHistory bars (time as a UTC datetime) to engine bars
    (time as int UTC seconds), ascending."""
    out = []
    for b in bars or []:
        t = b.get("time")
        if t is None:
            continue
        ts = int(t.timestamp()) if hasattr(t, "timestamp") else int(t)
        try:
            out.append({
                "time": ts,
                "open": float(b["open"]),
                "high": float(b["high"]),
                "low": float(b["low"]),
                "close": float(b["close"]),
                "volume": float(b.get("volume", 0) or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    out.sort(key=lambda x: x["time"])
    return out


def chart_bars(client) -> tuple[list[dict], int]:
    """Engine bars + interval(seconds) from the chart window's loaded history."""
    cw = getattr(client, "chart_window", None)
    if cw is None:
        raise BacktestDataError(
            "Chart window unavailable — enable the chart, or set From/To dates to "
            "fetch a range instead.")
    raw = getattr(cw, "_history_bars", None) or []
    bars = _to_engine_bars(raw)
    if len(bars) < 2:
        raise BacktestDataError(
            "The chart has no loaded bars yet — subscribe to a market in the chart "
            "first, or set From/To dates to fetch a range.")
    interval = int(getattr(cw, "_history_interval", 60) or 60)
    return bars, interval


def fetch_t4_bars(client, interval_seconds: int, start: str, end: str,
                  tz_offset_hours: float = 0.0) -> tuple[list[dict], str]:
    """Fetch a T4 bar range for the currently-selected market. BLOCKING.

    Args mirror the chart's own history load. Raises BacktestDataError with an
    actionable message when there's no token / market / data.
    """
    token = getattr(client, "jw_token", None)
    if not token:
        raise BacktestDataError(
            "Connect/login to T4 first — fetching a date range needs a live token. "
            "(Blank dates reuse the chart's loaded bars instead.)")
    market_id = getattr(client, "current_market_id", None)
    details = (getattr(client, "market_details", {}) or {}).get(market_id)
    exchange_id = getattr(details, "exchange_id", None) or getattr(client, "md_exchange_id", None)
    contract_id = getattr(details, "contract_id", None) or getattr(client, "md_contract_id", None)
    if not (exchange_id and contract_id):
        raise BacktestDataError(
            "No market selected — subscribe to a contract before fetching a range.")

    api = getattr(client, "apiUrl", None)
    base_url = (api.rstrip("/") + "/chart") if api else None
    hist = ChartHistory(token, base_url=base_url, tz_offset_hours=tz_offset_hours)
    try:
        bars, source = hist.fetch(
            exchange_id=exchange_id,
            contract_id=contract_id,
            market_id=market_id,
            interval_seconds=interval_seconds,
            trade_date_start=start,
            trade_date_end=end,
            live_price=getattr(client, "chart_window", None)
            and getattr(client.chart_window, "_last_price", None),
        )
    finally:
        hist.close()

    engine_bars = _to_engine_bars(bars)
    if len(engine_bars) < 2:
        raise BacktestDataError(
            f"Only {len(engine_bars)} bars returned for that range/interval — widen "
            "the dates or pick a smaller interval.")
    return engine_bars, source
