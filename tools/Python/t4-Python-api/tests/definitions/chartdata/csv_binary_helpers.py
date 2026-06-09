"""Helpers for CSV/binary fixture comparison tests.

Converts handler-captured records (bars, market definitions, mode changes,
settlements, open interest) to/from a unified CSV row format.

CSV schema (all record types share the same columns; unused fields are empty):

    type, market_id, trade_date, time, close_time,
    open, high, low, close,
    volume, volume_at_bid, volume_at_offer, trades, trades_at_bid, trades_at_offer,
    numerator, denominator, price_code, tick_value, vpt, min_cab_price,
    mode,
    settlement_price, held,
    open_interest
"""

from __future__ import annotations

import csv
from pathlib import Path

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_format_aggr import Bar, MarketDefinition
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price

# ---------------------------------------------------------------------------
# Column ordering (preserved in written CSV)
# ---------------------------------------------------------------------------

CSV_COLUMNS: list[str] = [
    "type",
    "market_id",
    "trade_date",
    "time",
    # bar
    "close_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "volume_at_bid",
    "volume_at_offer",
    "trades",
    "trades_at_bid",
    "trades_at_offer",
    # market_definition
    "numerator",
    "denominator",
    "price_code",
    "tick_value",
    "vpt",
    "min_cab_price",
    # mode_change
    "mode",
    # settlement
    "settlement_price",
    "held",
    # open_interest
    "open_interest",
]

_EMPTY: dict[str, str] = {col: "" for col in CSV_COLUMNS}


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _fmt_ndt(dt: NDateTime) -> str:
    """Format an NDateTime as ``YYYY-MM-DD HH:MM:SS.mmm``."""
    return (
        f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d} "
        f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}.{dt.millisecond:03d}"
    )


def _fmt_price(p: Price) -> str:
    """Serialise a Price as its full Decimal string."""
    return str(p.value)


# ---------------------------------------------------------------------------
# Per-record-type row builders
# ---------------------------------------------------------------------------


def bar_to_row(bar: Bar) -> dict[str, str]:
    row = _EMPTY.copy()
    row.update(
        {
            "type": "bar",
            "market_id": bar.MarketID,
            "trade_date": _fmt_ndt(bar.TradeDate),
            "time": _fmt_ndt(bar.Time),
            "close_time": _fmt_ndt(bar.CloseTime),
            "open": _fmt_price(bar.OpenPrice),
            "high": _fmt_price(bar.HighPrice),
            "low": _fmt_price(bar.LowPrice),
            "close": _fmt_price(bar.ClosePrice),
            "volume": str(bar.Volume),
            "volume_at_bid": str(bar.VolumeAtBid),
            "volume_at_offer": str(bar.VolumeAtOffer),
            "trades": str(bar.Trades),
            "trades_at_bid": str(bar.TradesAtBid),
            "trades_at_offer": str(bar.TradesAtOffer),
        }
    )
    return row


def market_def_to_row(md: MarketDefinition) -> dict[str, str]:
    row = _EMPTY.copy()
    row.update(
        {
            "type": "market_definition",
            "market_id": md.MarketID,
            "numerator": str(md.Numerator),
            "denominator": str(md.Denominator),
            "price_code": md.PriceCode,
            "tick_value": str(md.TickValue),
            "vpt": md.VPT_str,
            "min_cab_price": _fmt_price(md.MinCabPrice) if md.MinCabPrice is not None else "",
        }
    )
    return row


def mode_change_to_row(
    market_id: str, trade_date: NDateTime, time: NDateTime, mode: MarketMode
) -> dict[str, str]:
    row = _EMPTY.copy()
    row.update(
        {
            "type": "mode_change",
            "market_id": market_id,
            "trade_date": _fmt_ndt(trade_date),
            "time": _fmt_ndt(time),
            "mode": str(int(mode)),
        }
    )
    return row


def settlement_to_row(
    market_id: str,
    trade_date: NDateTime,
    time: NDateTime,
    price: Price,
    held: bool,
) -> dict[str, str]:
    row = _EMPTY.copy()
    row.update(
        {
            "type": "settlement",
            "market_id": market_id,
            "trade_date": _fmt_ndt(trade_date),
            "time": _fmt_ndt(time),
            "settlement_price": _fmt_price(price),
            "held": "true" if held else "false",
        }
    )
    return row


def open_interest_to_row(
    market_id: str, trade_date: NDateTime, time: NDateTime, open_interest: int
) -> dict[str, str]:
    row = _EMPTY.copy()
    row.update(
        {
            "type": "open_interest",
            "market_id": market_id,
            "trade_date": _fmt_ndt(trade_date),
            "time": _fmt_ndt(time),
            "open_interest": str(open_interest),
        }
    )
    return row


# ---------------------------------------------------------------------------
# Handler → rows
# ---------------------------------------------------------------------------


def handler_to_rows(
    bars: list[Bar],
    market_definitions: list[MarketDefinition],
    mode_changes: list[tuple],
    settlements: list[tuple],
    open_interests: list[tuple],
) -> list[dict[str, str]]:
    """Convert all handler-captured records to CSV row dicts (same order as decoded)."""
    rows: list[dict[str, str]] = []
    for md in market_definitions:
        rows.append(market_def_to_row(md))
    for bar in bars:
        rows.append(bar_to_row(bar))
    for market_id, trade_date, time, mode in mode_changes:
        rows.append(mode_change_to_row(market_id, trade_date, time, mode))
    for market_id, trade_date, time, price, held in settlements:
        rows.append(settlement_to_row(market_id, trade_date, time, price, held))
    for market_id, trade_date, time, oi in open_interests:
        rows.append(open_interest_to_row(market_id, trade_date, time, oi))
    return rows


# ---------------------------------------------------------------------------
# CSV I/O
# ---------------------------------------------------------------------------


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    """Write *rows* to *path* as a UTF-8 CSV with a header row."""
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def parse_csv(path: Path) -> list[dict[str, str]]:
    """Read *path* and return a list of row dicts (all values remain strings)."""
    with path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
