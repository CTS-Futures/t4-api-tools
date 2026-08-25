"""Live tick storage and time-bucketed candle aggregation.

Port of the JS ``TickStore`` / ``CandleAggregator`` pair (JSDemo
``ChartService.js``). Turns the live trade-tick stream PyDemo already receives
into forming/closing OHLCV bars at a configurable interval.

* :class:`TickStore` - bounded ring buffer of recent ticks per market.
* :class:`CandleAggregator` - folds ticks into the current bar; on a bucket
  rollover it leaves the finished bar in place and starts a new one.

Times are handled as float UTC epoch seconds internally; emitted bars carry a
timezone-aware ``datetime`` so they drop straight into a lightweight-charts
``update`` call. The aggregator does **no** trade de-duplication - the caller
de-dupes using the market's cumulative traded volume before calling
:meth:`CandleAggregator.add_tick` (see ``chart_window``).
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Deque, Optional


class TickStore:
    """Bounded ring buffer of recent ticks, keyed by market id."""

    def __init__(self, capacity: int = 5000) -> None:
        self._capacity = capacity
        self._by_market: dict[str, Deque[dict]] = {}

    def push(self, market_id: str, tick: dict) -> None:
        buf = self._by_market.get(market_id)
        if buf is None:
            buf = deque(maxlen=self._capacity)
            self._by_market[market_id] = buf
        buf.append(tick)

    def get(self, market_id: str) -> list[dict]:
        return list(self._by_market.get(market_id, ()))

    def clear(self, market_id: Optional[str] = None) -> None:
        if market_id is None:
            self._by_market.clear()
        else:
            self._by_market.pop(market_id, None)


class CandleAggregator:
    """Aggregates ticks into OHLCV bars at a fixed interval."""

    def __init__(self, interval_seconds: int = 60) -> None:
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        self._interval = int(interval_seconds)
        self._bucket: Optional[int] = None  # epoch-second start of current bar
        self._bar: Optional[dict] = None    # current forming bar (epoch-sec time)

    @property
    def interval_seconds(self) -> int:
        return self._interval

    def reset(self, interval_seconds: Optional[int] = None) -> None:
        """Clear state, optionally switching interval (on interval change)."""
        if interval_seconds is not None:
            if interval_seconds <= 0:
                raise ValueError("interval_seconds must be positive")
            self._interval = int(interval_seconds)
        self._bucket = None
        self._bar = None

    def _bucket_start(self, ts: float) -> int:
        return int(ts // self._interval) * self._interval

    def seed_last_bar(self, bar: dict) -> None:
        """Continue live aggregation from the last historical bar.

        ``bar`` is a chart bar dict (``time`` may be ``datetime`` or epoch
        seconds). The next tick falling in the same bucket folds into it rather
        than resetting the open.
        """
        ts = self._to_epoch(bar["time"])
        self._bucket = self._bucket_start(ts)
        self._bar = {
            "_ts": self._bucket,
            "open": float(bar["open"]),
            "high": float(bar["high"]),
            "low": float(bar["low"]),
            "close": float(bar["close"]),
            "volume": int(bar.get("volume", 0) or 0),
        }

    def add_tick(self, price: float, volume: int, ts: float) -> Optional[dict]:
        """Fold one trade into the current bar and return the bar to render.

        Returns a chart bar dict (``time`` as UTC ``datetime``) to pass to
        ``chart.update``. Out-of-order ticks (older than the current bucket) are
        ignored and return ``None``, mirroring the JS monotonic-stream
        assumption.
        """
        bucket = self._bucket_start(ts)

        if self._bar is None or bucket > self._bucket:
            # First tick, or a new bucket: start a fresh bar.
            self._bucket = bucket
            self._bar = {
                "_ts": bucket,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": int(volume),
            }
        elif bucket < self._bucket:
            # Out-of-order / late tick - ignore.
            return None
        else:
            # Same bucket: update the forming bar.
            bar = self._bar
            bar["high"] = max(bar["high"], price)
            bar["low"] = min(bar["low"], price)
            bar["close"] = price
            bar["volume"] += int(volume)

        return self._render(self._bar)

    @staticmethod
    def _render(bar: dict) -> dict:
        return {
            "time": datetime.fromtimestamp(bar["_ts"], tz=timezone.utc),
            "open": bar["open"],
            "high": bar["high"],
            "low": bar["low"],
            "close": bar["close"],
            "volume": bar["volume"],
        }

    @staticmethod
    def _to_epoch(t) -> float:
        if isinstance(t, datetime):
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            return t.timestamp()
        return float(t)
