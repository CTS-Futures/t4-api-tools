"""
research/data.py

Fetch + decode T4 binary chart data into pandas DataFrames, and align several
instruments onto a common time index.

This is the ONLY T4-specific layer. It reuses the conversion repo's ChartClient
(`get_barchart_binary` → `ChartDataStreamReaderAggr` → Bar objects) decoded via
a CollectingHandler-style sink, then maps each Bar to an OHLCV row. Everything
downstream (indicators / model / backtest / report) operates on plain pandas and
is agnostic to where the data came from — so a CSV/free-data fallback can plug in
here without touching the rest.
"""

from __future__ import annotations

import datetime as _dt
import os
from dataclasses import dataclass, field
from typing import List, Optional

import pandas as pd

# NOTE: t4login (the conversion API) is imported LAZILY inside make_client — it is
# only needed for the T4 source. Thanks to `from __future__ import annotations`
# above, the ChartClient/NDateTime/Bar/MarketDefinition names below are used only
# in (unevaluated) type annotations, so the CSV and Yahoo paths import and run with
# no conversion-API dependency at all. (Before this, importing research.data — and
# therefore every research.* entrypoint — hard-failed with ModuleNotFoundError:
# 't4login' unless the conversion repo was installed, even in CSV mode.)
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # annotation-only; never imported at runtime
    from t4login.client.chart_client import ChartClient
    from t4login.datetime_.n_date_time import NDateTime
    from t4login.definitions.chartdata.chart_format_aggr import Bar, MarketDefinition

from . import config


# --- token / client ----------------------------------------------------------
def get_token() -> str:
    """Bearer token for the chart API, from the T4_API_TOKEN env var.

    The conversion repo has no login flow (Phase-1, chart-only); the token must
    be supplied. Capture it from an authenticated T4 session (e.g. the running
    JSDemo login) and export it: `export T4_API_TOKEN=...`.
    """
    token = os.environ.get("T4_API_TOKEN")
    if not token:
        raise RuntimeError(
            "No T4_API_TOKEN set. Export a bearer token from an authenticated T4 "
            "session before running (see research/README.md)."
        )
    return token


def make_client(token: Optional[str] = None, *, base_url: Optional[str] = None) -> "ChartClient":
    # Lazy import: only the T4 source constructs a client, so CSV/Yahoo runs never
    # need the conversion API installed.
    from t4login.client.chart_client import ChartClient
    if base_url:
        return ChartClient(token=token or get_token(), base_url=base_url)
    return ChartClient(token=token or get_token())


# --- decode helpers ----------------------------------------------------------
def ndt_to_datetime(ndt: NDateTime) -> _dt.datetime:
    """NDateTime (.NET ticks) → naive python datetime via its date/time parts."""
    return _dt.datetime(ndt.year, ndt.month, ndt.day, ndt.hour, ndt.minute, ndt.second)


@dataclass
class _BarSink:
    """Minimal ChartDataHandler: keep bars + market defs, ignore the rest."""
    bars: List[Bar] = field(default_factory=list)
    market_definitions: List[MarketDefinition] = field(default_factory=list)

    def on_market_definition(self, md: MarketDefinition) -> None:
        self.market_definitions.append(md)

    def on_bar(self, bar: Bar) -> None:
        self.bars.append(bar)

    # Unused callbacks — must exist to satisfy the handler protocol.
    def on_mode_change(self, *a) -> None: ...
    def on_settlement(self, *a) -> None: ...
    def on_open_interest(self, *a) -> None: ...


def _bars_to_frame(bars: List[Bar], interval: str) -> pd.DataFrame:
    """Map decoded Bars → an OHLCV DataFrame indexed by timestamp (UTC-naive).

    Daily bars are indexed by their trade date; intraday by bar Time.
    """
    rows = []
    for b in bars:
        if interval == "Day":
            ts = _dt.datetime(b.TradeDate.year, b.TradeDate.month, b.TradeDate.day)
        else:
            ts = ndt_to_datetime(b.Time)
        rows.append({
            "ts": ts,
            "open": float(b.OpenPrice.value),
            "high": float(b.HighPrice.value),
            "low": float(b.LowPrice.value),
            "close": float(b.ClosePrice.value),
            "volume": int(b.Volume),
        })
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(rows).set_index("ts").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    return df


# --- fetch -------------------------------------------------------------------
def fetch_symbol(
    client: ChartClient,
    symbol: config.Symbol,
    *,
    start: str,
    end: str,
    interval: str = config.BAR_INTERVAL,
    period: int = config.BAR_PERIOD,
) -> pd.DataFrame:
    """Fetch one instrument's OHLCV over [start, end].

    Tries each candidate exchange id until one returns bars. Raises if none do
    (so callers/probe can report the dead symbol clearly).
    """
    last_err: Optional[Exception] = None
    for exchange_id in symbol.exchange_candidates:
        sink = _BarSink()
        try:
            client.get_barchart_binary(
                exchange_id=exchange_id,
                contract_id=symbol.contract_id,
                chart_type="Bar",
                bar_interval=interval,
                bar_period=period,
                trade_date_start=start,
                trade_date_end=end,
                continuation_type=symbol.continuation_type,
                handler=sink,
            )
        except Exception as e:  # network / decode / HTTP error → try next exchange
            last_err = e
            continue
        df = _bars_to_frame(sink.bars, interval)
        if not df.empty:
            df.attrs["exchange_id"] = exchange_id
            df.attrs["symbol"] = symbol.key
            return df
    if last_err:
        raise RuntimeError(f"{symbol.key}: all exchange candidates failed; last error: {last_err}")
    raise RuntimeError(f"{symbol.key}: no bars returned for any exchange candidate over {start}..{end}")


def fetch_all(
    client: ChartClient,
    symbols: Optional[List[config.Symbol]] = None,
    *,
    start: str = config.FETCH_START,
    end: str = config.FETCH_END,
    interval: str = config.BAR_INTERVAL,
    period: int = config.BAR_PERIOD,
) -> dict[str, pd.DataFrame]:
    symbols = symbols or config.SYMBOLS
    out: dict[str, pd.DataFrame] = {}
    for s in symbols:
        out[s.key] = fetch_symbol(client, s, start=start, end=end, interval=interval, period=period)
    return out


# --- CSV source (fallback) ---------------------------------------------------
# Column-name aliases so we accept Yahoo Finance exports and generic OHLCV files
# without the user reformatting anything.
_CSV_DATE_KEYS = ("date", "datetime", "time", "timestamp")
_CSV_FIELD_ALIASES = {
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "adj close", "adj_close", "adjclose", "c", "last", "price"),
    "volume": ("volume", "vol", "v"),
}


def load_csv_symbol(path: str) -> pd.DataFrame:
    """Load one OHLCV series from a CSV into the same frame shape as fetch_symbol.

    Headers are matched case-insensitively. A date/datetime column is required;
    open/high/low/close are required; volume is optional (defaults to 0). If
    only a close is present (e.g. a price-only series), OHL fall back to close.
    """
    raw = pd.read_csv(path)
    if raw.empty:
        raise RuntimeError(f"{path}: empty CSV")
    lower = {c.lower().strip(): c for c in raw.columns}

    date_col = next((lower[k] for k in _CSV_DATE_KEYS if k in lower), None)
    if date_col is None:
        raise RuntimeError(f"{path}: no date column (looked for {_CSV_DATE_KEYS}); columns={list(raw.columns)}")

    def pick(field: str) -> Optional[str]:
        for alias in _CSV_FIELD_ALIASES[field]:
            if alias in lower:
                return lower[alias]
        return None

    close_col = pick("close")
    if close_col is None:
        raise RuntimeError(f"{path}: no close/price column; columns={list(raw.columns)}")

    out = pd.DataFrame(index=pd.to_datetime(raw[date_col], errors="coerce"))
    out.index.name = "ts"
    for field in ("open", "high", "low"):
        col = pick(field)
        out[field] = pd.to_numeric(raw[col], errors="coerce").values if col else None
    out["close"] = pd.to_numeric(raw[close_col], errors="coerce").values
    vol_col = pick("volume")
    out["volume"] = (pd.to_numeric(raw[vol_col], errors="coerce").fillna(0).astype("int64").values
                     if vol_col else 0)
    # Fill any missing OHL from close (price-only series stay usable).
    for field in ("open", "high", "low"):
        out[field] = out[field].fillna(out["close"])

    out = out.dropna(subset=["close"]).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out.attrs["source"] = "csv"
    return out[["open", "high", "low", "close", "volume"]]


def load_csv_all(csv_dir: str, symbols: Optional[List[config.Symbol]] = None) -> dict[str, pd.DataFrame]:
    """Load {key}.csv for each symbol from csv_dir (key = es/cl/gc)."""
    symbols = symbols or config.SYMBOLS
    out: dict[str, pd.DataFrame] = {}
    missing = []
    for s in symbols:
        path = os.path.join(csv_dir, f"{s.key}.csv")
        if not os.path.exists(path):
            missing.append(path)
            continue
        df = load_csv_symbol(path)
        df.attrs["symbol"] = s.key
        df.attrs["exchange_id"] = "csv"
        out[s.key] = df
    if missing:
        raise RuntimeError(
            f"Missing CSV(s): {missing}. Expected one file per instrument named "
            f"es.csv / cl.csv / gc.csv in {csv_dir}."
        )
    return out


# --- Yahoo Finance source (free, real data) ----------------------------------
# yfinance is an optional dep (only this path needs it). Each symbol maps to a
# Yahoo ticker via Symbol.yahoo_ticker (ETFs -> plain symbol, futures -> "=F"
# continuous front-month). Returns the SAME OHLCV frame shape as the T4/CSV
# loaders, so everything downstream is unchanged.
def _yahoo_to_frame(raw: "pd.DataFrame") -> pd.DataFrame:
    """Normalise a single-ticker yfinance frame to open/high/low/close/volume."""
    df = raw.copy()
    # yfinance returns a MultiIndex (Price, Ticker) even for one ticker; flatten
    # to the Price level (Open/High/Low/Close/Volume).
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.lower)
    keep = ["open", "high", "low", "close", "volume"]
    missing = [c for c in keep if c not in df.columns]
    if missing:
        raise RuntimeError(f"yahoo frame missing columns {missing}; got {list(df.columns)}")
    out = df[keep].copy()
    out.index = pd.to_datetime(out.index).tz_localize(None)
    out.index.name = "ts"
    for c in ("open", "high", "low", "close"):
        out[c] = pd.to_numeric(out[c], errors="coerce")
    out["volume"] = pd.to_numeric(out["volume"], errors="coerce").fillna(0).astype("int64")
    out = out.dropna(subset=["close"]).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out


def fetch_yahoo_symbol(
    symbol: config.Symbol,
    *,
    start: str = config.FETCH_START,
    end: str = config.FETCH_END,
) -> pd.DataFrame:
    """Download one instrument's daily OHLCV from Yahoo Finance."""
    try:
        import yfinance as yf
    except ImportError as e:  # pragma: no cover - clear actionable message
        raise RuntimeError("yfinance not installed. Run: pip install yfinance") from e

    ticker = symbol.yahoo_ticker
    # end is exclusive in yfinance; bump by a day so the configured end is included.
    end_excl = (pd.to_datetime(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    raw = yf.download(ticker, start=start, end=end_excl, interval="1d",
                      auto_adjust=True, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError(f"{symbol.key}: Yahoo returned no data for ticker {ticker!r} over {start}..{end}")
    df = _yahoo_to_frame(raw)
    if df.empty:
        raise RuntimeError(f"{symbol.key}: Yahoo data for {ticker!r} empty after cleaning")
    df.attrs["symbol"] = symbol.key
    df.attrs["exchange_id"] = f"yahoo:{ticker}"
    df.attrs["source"] = "yahoo"
    return df


def fetch_yahoo_all(
    symbols: Optional[List[config.Symbol]] = None,
    *,
    start: str = config.FETCH_START,
    end: str = config.FETCH_END,
) -> dict[str, pd.DataFrame]:
    symbols = symbols or config.SYMBOLS
    out: dict[str, pd.DataFrame] = {}
    for s in symbols:
        out[s.key] = fetch_yahoo_symbol(s, start=start, end=end)
    return out


def save_frames_csv(frames: dict[str, pd.DataFrame], csv_dir: str) -> None:
    """Write each frame to {csv_dir}/{key}.csv in a format load_csv_symbol reads
    back (Date + OHLCV). Lets a Yahoo pull be cached for offline/reproducible
    reruns and reused by the JSDemo UI bridge (which runs the CSV path)."""
    os.makedirs(csv_dir, exist_ok=True)
    for key, df in frames.items():
        path = os.path.join(csv_dir, f"{key}.csv")
        out = df[["open", "high", "low", "close", "volume"]].copy()
        out.index.name = "Date"
        out.columns = ["Open", "High", "Low", "Close", "Volume"]
        out.to_csv(path)


# --- align -------------------------------------------------------------------
def align(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Outer-join per-symbol OHLCV onto a common index, column-prefixed by key.

    Forward-fills gaps (different sessions/holidays) so every row has all three
    instruments' last-known values. Returns one wide DataFrame:
        es_open, es_high, ..., es_volume, cl_close, ..., gc_close, ...
    """
    wide: Optional[pd.DataFrame] = None
    for key, df in frames.items():
        renamed = df.add_prefix(f"{key}_")
        wide = renamed if wide is None else wide.join(renamed, how="outer")
    if wide is None:
        return pd.DataFrame()
    wide = wide.sort_index().ffill().dropna()
    return wide
