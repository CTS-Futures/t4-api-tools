"""Working-order overlay lines (labeled, colored, draggable to revise).

One draggable ``HorizontalLine`` per working order in the active market. Buy
lines are green, sell lines red. Dragging a line calls ``client.revise_order``
with the new price (scheduled on the asyncio loop via the bridge).

Two redraw entry points are needed because ``Chart.set`` (history load /
interval switch) wipes toolbox-managed drawings, including these lines:
* :meth:`update` - order set changed (from an account update); rebuilds lines.
* :meth:`rebuild` - called after a ``set()``; the JS primitives are already
  gone, so it just drops stale refs and recreates from cached order state.
"""

from __future__ import annotations

import logging

log = logging.getLogger("pydemo.chart.order_lines")

_WORKING_STATUS = 1
_BUY = 1


class OrderLines:
    def __init__(self, chart, bridge, client) -> None:
        self._chart = chart
        self._bridge = bridge
        self._client = client
        self._lines: dict = {}     # unique_id -> HorizontalLine
        self._orders: dict = {}    # unique_id -> {price, volume, side}
        self._market_id = None

    def set_market(self, market_id) -> None:
        if market_id != self._market_id:
            self._market_id = market_id
            self._orders = {}
            self._delete_all()

    def update(self, orders, market_id) -> None:
        """Refresh from a list of OrderUpdate protos (account 'orders' event)."""
        self._market_id = market_id
        working = {}
        for o in orders:
            if getattr(o, "market_id", None) != market_id:
                continue
            if getattr(o, "status", None) != _WORKING_STATUS:
                continue
            price = self._order_price(o)
            if price is None:
                continue
            working[o.unique_id] = {
                "price": float(price),
                "volume": self._order_volume(o),
                "side": getattr(o, "buy_sell", 0),
            }
        self._orders = working
        self._delete_all()
        self._create_all()

    def rebuild(self) -> None:
        """Recreate lines after a chart.set() wiped them."""
        self._lines.clear()
        self._create_all()

    # ------------------------------------------------------------------

    def _create_all(self) -> None:
        for uid, info in self._orders.items():
            self._create(uid, info)

    def _create(self, uid, info) -> None:
        color = "#26a69a" if info["side"] == _BUY else "#ef5350"
        side = "BUY" if info["side"] == _BUY else "SELL"
        text = f"{side} {info['volume']} @ {info['price']}"

        def on_drag(chart, line, _uid=uid):
            self._bridge.run_coro(lambda: self._revise(_uid, line.price))

        try:
            self._lines[uid] = self._chart.horizontal_line(
                info["price"], color=color, width=2, style="dashed",
                text=text, func=on_drag)
        except Exception:  # noqa: BLE001
            log.exception("failed to draw order line %s", uid)

    async def _revise(self, uid, new_price) -> None:
        info = self._orders.get(uid)
        if not info:
            return
        try:
            await self._client.revise_order(uid, int(info["volume"]),
                                            float(new_price), "limit")
            info["price"] = float(new_price)
            log.info("revise order %s -> %s", uid, new_price)
        except Exception:  # noqa: BLE001
            log.exception("revise order %s failed", uid)

    def _delete_all(self) -> None:
        for line in self._lines.values():
            try:
                line.delete()
            except Exception:  # noqa: BLE001
                pass
        self._lines.clear()

    @staticmethod
    def _order_price(o):
        if o.HasField("current_limit_price"):
            return o.current_limit_price.value
        if o.HasField("new_limit_price"):
            return o.new_limit_price.value
        return None

    @staticmethod
    def _order_volume(o):
        return (getattr(o, "working_volume", 0)
                or getattr(o, "current_volume", 0)
                or getattr(o, "new_volume", 0))
