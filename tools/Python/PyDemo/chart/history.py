"""Historical bar loading via the T4 chart API (``t4login.ChartClient``).

Binary-first (``/chart/barchart`` with ``application/octet-stream``, decoded by
``ChartDataStreamReaderAggr``), falling back to JSON if the binary request fails
or yields no bars. Both paths return the chart's normalised bar dicts
(``{time: datetime, open, high, low, close, volume}``) and the path that served
the data is logged.

The JSON fallback mirrors JSDemo's ``calibrateScale`` trick: JSON bar prices may
be unscaled integers, so when a live reference price is available we infer the
power-of-ten divisor from ``rawClose / livePrice``.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Any, Optional

from t4login.client.chart_client import ChartClient

from . import convert

log = logging.getLogger("pydemo.chart.history")

# chart interval (seconds) -> (T4 barInterval name, barPeriod)
_INTERVAL_MAP: dict[int, tuple[str, int]] = {
    15: ("Second", 15),
    30: ("Second", 30),
    60: ("Minute", 1),
    300: ("Minute", 5),
    900: ("Minute", 15),
    3600: ("Hour", 1),
    86400: ("Day", 1),
}


def interval_to_t4(interval_seconds: int) -> tuple[str, int]:
    """Map a chart interval in seconds to T4 ``(barInterval, barPeriod)``."""
    if interval_seconds in _INTERVAL_MAP:
        return _INTERVAL_MAP[interval_seconds]
    # Derive a sensible (unit, period) for intervals not in the table.
    if interval_seconds % 86400 == 0:
        return ("Day", interval_seconds // 86400)
    if interval_seconds % 3600 == 0:
        return ("Hour", interval_seconds // 3600)
    if interval_seconds % 60 == 0:
        return ("Minute", interval_seconds // 60)
    return ("Second", max(1, interval_seconds))


def calibrate_scale(raw_close: float, live_price: float) -> Optional[float]:
    """Infer a power-of-ten divisor from a raw JSON close vs a live price.

    Returns ``None`` when the ratio is not a plausible power of ten (exponent
    outside ``0..8``), matching the JS plausibility guard.
    """
    if not raw_close or not live_price:
        return None
    try:
        ratio = float(raw_close) / float(live_price)
    except (ZeroDivisionError, ValueError):
        return None
    if ratio <= 0:
        return None
    exp = round(math.log10(ratio))
    if exp < 0 or exp > 8:
        return None
    return float(10 ** exp)


class _BarCollector:
    """``ChartDataHandler`` implementation that gathers decoded bars."""

    def __init__(self, tz_offset_hours: float = 0.0) -> None:
        self.bars: list[dict] = []
        self.market_definition: Any = None
        self._tz = tz_offset_hours

    def on_market_definition(self, market_definition: Any) -> None:
        self.market_definition = market_definition

    def on_bar(self, bar: Any) -> None:
        self.bars.append(convert.bar_to_dict(bar, self._tz))

    # Events we don't render on the price chart (no-ops).
    def on_mode_change(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401
        pass

    def on_settlement(self, *args: Any, **kwargs: Any) -> None:
        pass

    def on_open_interest(self, *args: Any, **kwargs: Any) -> None:
        pass


class ChartHistory:
    """Fetches and normalises historical bars for the chart."""

    def __init__(self, token: str, *, base_url: Optional[str] = None,
                 tz_offset_hours: float = 0.0) -> None:
        kwargs: dict[str, Any] = {}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = ChartClient(token, **kwargs)
        self._tz = tz_offset_hours

    def close(self) -> None:
        self._client.close()

    def fetch(
        self,
        *,
        exchange_id: str,
        contract_id: str,
        market_id: Optional[str],
        interval_seconds: int,
        trade_date_start: str,
        trade_date_end: str,
        live_price: Optional[float] = None,
        continuation_type: Optional[str] = None,
    ) -> tuple[list[dict], str]:
        """Return ``(bars, source)`` where ``source`` is ``"binary"`` or ``"json"``.

        Tries binary first; on any error or empty result, falls back to JSON.
        Bars are sorted ascending by time. ``continuation_type`` (e.g. ``"Volume"``)
        requests a continuous, roll-stitched futures series; omit it for cash/ETF
        contracts or a single futures month.
        """
        bar_interval, bar_period = interval_to_t4(interval_seconds)
        common = dict(
            exchange_id=exchange_id,
            contract_id=contract_id,
            market_id=market_id,
            bar_interval=bar_interval,
            bar_period=bar_period,
            trade_date_start=trade_date_start,
            trade_date_end=trade_date_end,
        )
        if continuation_type:
            common["continuation_type"] = continuation_type

        # --- binary (preferred) -------------------------------------------
        try:
            collector = _BarCollector(self._tz)
            self._client.get_barchart_binary(handler=collector, **common)
            if collector.bars:
                bars = sorted(collector.bars, key=lambda b: b["time"])
                log.info("history: %d bars via BINARY (%s/%s %s)",
                         len(bars), exchange_id, contract_id, bar_interval)
                return bars, "binary"
            log.warning("history: binary returned 0 bars; trying JSON")
        except Exception as exc:  # noqa: BLE001 - fall back on any failure
            log.warning("history: binary failed (%s); trying JSON", exc)

        # --- JSON fallback -------------------------------------------------
        try:
            raw = self._client.get_barchart_json(**common)
            bars = self._parse_json_bars(raw, live_price)
            bars.sort(key=lambda b: b["time"])
            log.info("history: %d bars via JSON (%s/%s %s)",
                     len(bars), exchange_id, contract_id, bar_interval)
            return bars, "json"
        except Exception as exc:  # noqa: BLE001
            log.error("history: JSON fallback failed (%s)", exc)
            return [], "none"

    # ------------------------------------------------------------------

    def _parse_json_bars(self, raw: Any, live_price: Optional[float]) -> list[dict]:
        rows = self._extract_rows(raw)
        if not rows:
            return []

        # Determine price scale once using the most recent raw close.
        scale = 1.0
        if live_price:
            last_close = self._field(rows[-1], ("closePrice", "close", "c"))
            cal = calibrate_scale(self._to_float(last_close), live_price)
            if cal:
                scale = cal

        bars: list[dict] = []
        for row in rows:
            t = self._parse_time(self._field(row, ("time", "barTime", "t")))
            if t is None:
                continue
            bars.append({
                "time": t,
                "open": self._to_float(self._field(row, ("openPrice", "open", "o"))) / scale,
                "high": self._to_float(self._field(row, ("highPrice", "high", "h"))) / scale,
                "low": self._to_float(self._field(row, ("lowPrice", "low", "l"))) / scale,
                "close": self._to_float(self._field(row, ("closePrice", "close", "c"))) / scale,
                "volume": int(self._to_float(self._field(row, ("volume", "v"))) or 0),
            })
        return bars

    @staticmethod
    def _extract_rows(raw: Any) -> list[dict]:
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            for key in ("bars", "barchart", "barChart", "data", "results"):
                val = raw.get(key)
                if isinstance(val, list):
                    return val
        return []

    @staticmethod
    def _field(row: dict, names: tuple[str, ...]) -> Any:
        for n in names:
            if n in row:
                return row[n]
        return None

    @staticmethod
    def _to_float(value: Any) -> float:
        if value is None:
            return 0.0
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    @staticmethod
    def _parse_time(value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            # Epoch seconds.
            from datetime import timezone
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        try:
            # ISO 'YYYY-MM-DDTHH:mm:ss' (exchange wall-clock); keep as UTC.
            from datetime import timezone
            return datetime.fromisoformat(str(value)).replace(tzinfo=timezone.utc)
        except ValueError:
            return None
