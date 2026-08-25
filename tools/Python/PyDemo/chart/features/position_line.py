"""Net-position / average-fill overlay line.

A single solid horizontal line at the position's average open price, labeled
with the net position. Hidden when flat. Like order lines, it must be recreated
after a ``chart.set()`` (which wipes drawings), so it exposes both an event-
driven :meth:`update` and a post-``set`` :meth:`rebuild`.
"""

from __future__ import annotations

import logging

log = logging.getLogger("pydemo.chart.position_line")


class PositionLine:
    def __init__(self, chart) -> None:
        self._chart = chart
        self._line = None
        self._state = None  # {price, net} or None when flat
        self._market_id = None

    def set_market(self, market_id) -> None:
        if market_id != self._market_id:
            self._market_id = market_id
            self._state = None
            self._delete()

    def update(self, positions, market_id) -> None:
        """Refresh from the account 'positions' event (list of dicts)."""
        self._market_id = market_id
        state = None
        for pos in positions:
            if pos.get("market_id") != market_id:
                continue
            net = pos.get("net")
            if net is None:
                net = pos.get("buys", 0) - pos.get("sells", 0)
            avg = pos.get("average_open_price")
            if net and avg not in (None, "", "0"):
                try:
                    state = {"price": float(avg), "net": int(net)}
                except (ValueError, TypeError):
                    state = None
            break
        self._state = state
        self._delete()
        self._create()

    def rebuild(self) -> None:
        """Recreate the line after a chart.set() wiped it."""
        self._line = None
        self._create()

    # ------------------------------------------------------------------

    def _create(self) -> None:
        if not self._state:
            return
        net = self._state["net"]
        color = "#26a69a" if net > 0 else "#ef5350"
        text = f"POS {net:+d} @ {self._state['price']}"
        try:
            self._line = self._chart.horizontal_line(
                self._state["price"], color=color, width=2, style="solid",
                text=text)
        except Exception:  # noqa: BLE001
            log.exception("failed to draw position line")

    def _delete(self) -> None:
        if self._line is not None:
            try:
                self._line.delete()
            except Exception:  # noqa: BLE001
                pass
            self._line = None
