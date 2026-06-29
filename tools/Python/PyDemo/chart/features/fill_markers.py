"""Trade-fill markers (buy/sell arrows at the fill price/time).

Buy fills get an upward green arrow below the bar, sells a downward red arrow
above. Fills are cached so they can be re-applied after a ``chart.set()`` and
filtered to the active market.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("pydemo.chart.fill_markers")

_BUY = 1


class FillMarkers:
    def __init__(self, chart) -> None:
        self._chart = chart
        self._fills: list[dict] = []   # cached normalised fills for active market
        self._market_id = None

    def set_market(self, market_id) -> None:
        if market_id != self._market_id:
            self._market_id = market_id
            self._fills = []
            try:
                self._chart.clear_markers()
            except Exception:  # noqa: BLE001
                pass

    def add(self, fill: dict, market_id) -> None:
        """Handle an account 'fill' event."""
        if fill.get("market_id") != market_id:
            return
        norm = self._normalise(fill)
        if norm is None:
            return
        self._fills.append(norm)
        self._place(norm)

    def rebuild(self) -> None:
        """Re-apply cached markers after a chart.set()."""
        try:
            self._chart.clear_markers()
        except Exception:  # noqa: BLE001
            pass
        for f in self._fills:
            self._place(f)

    # ------------------------------------------------------------------

    @staticmethod
    def _normalise(fill: dict):
        price = fill.get("price")
        ts = fill.get("time")
        if price is None or ts is None:
            return None
        try:
            return {
                "time": datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None),
                "price": float(price),
                "volume": int(fill.get("volume", 0) or 0),
                "side": fill.get("buy_sell", 0),
            }
        except (ValueError, TypeError, OSError):
            return None

    def _place(self, f: dict) -> None:
        buy = f["side"] == _BUY
        try:
            self._chart.marker(
                time=f["time"],
                position="below" if buy else "above",
                shape="arrow_up" if buy else "arrow_down",
                color="#26a69a" if buy else "#ef5350",
                text=f"{'B' if buy else 'S'} {f['volume']}@{f['price']}",
            )
        except Exception:  # noqa: BLE001
            log.exception("failed to place fill marker")
