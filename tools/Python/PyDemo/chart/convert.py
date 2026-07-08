"""Pure conversion helpers: T4 ``NDateTime`` / ``Price`` -> chart units.

The chart layer (lightweight-charts) wants plain Python ``datetime`` objects and
``float`` prices. The T4 binary decoder (``t4login``) produces:

* ``NDateTime`` - .NET-style ticks (100 ns) since 0001-01-01. We convert to a
  UTC epoch second and then to a ``datetime``.
* ``Price`` - a ``decimal.Decimal`` wrapper already in *real display units*
  (e.g. ``4525.50``) once the decoder has applied the market's tick size, so a
  decoded bar's OHLC only needs ``float(price.value)``.

These functions are deliberately free of any I/O or charting dependency so they
can be unit-tested against the ``t4login`` fixtures.

Timezone note
-------------
The bar ``Time`` encoded by T4 is the exchange/session wall-clock, not UTC.
``ndatetime_to_epoch_seconds`` reads that wall-clock *as if* it were UTC. Live
ticks (timestamped with ``time.time()``) are true UTC, so if the exchange is not
on UTC the two streams can be offset by a constant. ``tz_offset_hours`` lets the
caller correct that; it defaults to 0 and is a calibration knob exercised during
live verification (compare the last historical bar time to "now").
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

# Ticks (100 ns units) between 0001-01-01 and the Unix epoch (1970-01-01).
EPOCH_TICKS: int = 621_355_968_000_000_000
TICKS_PER_SECOND: int = 10_000_000


def ndatetime_to_epoch_seconds(ndt: Any, tz_offset_hours: float = 0.0) -> int:
    """Convert an ``NDateTime`` (or anything exposing ``.ticks``) to a UTC
    epoch second, applying an optional whole/fractional hour offset."""
    ticks = ndt.ticks if hasattr(ndt, "ticks") else int(ndt)
    seconds = (ticks - EPOCH_TICKS) // TICKS_PER_SECOND
    return int(seconds + tz_offset_hours * 3600)


def ndatetime_to_datetime(ndt: Any, tz_offset_hours: float = 0.0) -> datetime:
    """Convert an ``NDateTime`` to a timezone-aware UTC ``datetime`` suitable
    for a lightweight-charts ``time`` column."""
    return datetime.fromtimestamp(
        ndatetime_to_epoch_seconds(ndt, tz_offset_hours), tz=timezone.utc
    )


def price_to_float(price: Any) -> float:
    """Convert a decoded ``Price`` (or ``Decimal``/number/str) to ``float``.

    Decoded bar prices are already in real display units, so this is a plain
    numeric cast - but we route through ``Decimal`` to avoid surprises from
    binary-float string parsing.
    """
    if price is None:
        return float("nan")
    value = getattr(price, "value", price)
    if isinstance(value, Decimal):
        return float(value)
    return float(Decimal(str(value)))


def bar_to_dict(bar: Any, tz_offset_hours: float = 0.0) -> dict:
    """Normalise a decoded ``t4login`` ``Bar`` into the chart's bar dict.

    Returns ``{time: datetime, open, high, low, close: float, volume: int}``.
    """
    return {
        "time": ndatetime_to_datetime(bar.Time, tz_offset_hours),
        "open": price_to_float(bar.OpenPrice),
        "high": price_to_float(bar.HighPrice),
        "low": price_to_float(bar.LowPrice),
        "close": price_to_float(bar.ClosePrice),
        "volume": int(bar.Volume),
    }


def parse_trade_string(last_trade: str) -> tuple[float, int] | None:
    """Parse PyDemo's ``"volume@price"`` last-trade string into ``(price, volume)``.

    Returns ``None`` for the ``"-"`` placeholder or anything unparseable.
    """
    if not last_trade or last_trade == "-" or "@" not in last_trade:
        return None
    vol_str, _, price_str = last_trade.partition("@")
    try:
        return float(price_str), int(float(vol_str))
    except (ValueError, TypeError):
        return None
