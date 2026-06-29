"""backtest/sim_broker.py

In-memory matching engine for backtesting — a faithful port of
``algo/SimBroker.js``. The Backtester drives it bar-by-bar via ``process_bar``;
the strategy that runs against it is the same code shape that would run live.

Fill model (documented assumptions — this is bar data, not a real book):
  - MARKET orders fill at the NEXT bar's open +/- slippage. Acting on a closed
    bar then filling next-open avoids look-ahead bias.
  - LIMIT buy fills if bar.low <= price (sell: bar.high >= price); a gap through
    the limit fills at the bar open (price improvement).
  - STOP triggers when the bar trades through it, then fills as market at the
    stop (or gap-open) +/- slippage (adverse).
  - Bracket TP/SL become an OCO pair. If both could fill in one bar, the STOP is
    resolved first (pessimistic).

Orders placed during a bar's close are queued; they cannot fill on the bar that
triggered them.

Unlike the JS version (an EventEmitter), this uses plain ``on_bar`` / ``on_fill``
callbacks set by the Backtester — same call order, no event machinery needed.
"""

from __future__ import annotations

import math

from .portfolio import Portfolio


class SimBroker:
    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self.config = config
        self.slippage = config.get("slippage") or 0     # price units, adverse
        self.portfolio = Portfolio(
            point_value=config.get("point_value", 1),
            commission=config.get("commission", 0),
            starting_cash=config.get("starting_cash", 100000),
        )

        self._pending = []        # market orders awaiting next open
        self._resting = []        # limit/stop orders
        self._seq = 0
        self._clock_ms = 0

        # Wired by the Backtester (mirrors AlgoRunner's live hookup).
        self.on_bar = None        # callable(bar_dict)
        self.on_fill = None       # callable(fill_dict)

    # ---- order entry ---------------------------------------------------------
    def buy(self, volume, opts=None):
        return self._order(1, volume, opts or {})

    def sell(self, volume, opts=None):
        return self._order(-1, volume, opts or {})

    def _order(self, side, volume, opts):
        type_ = opts.get("type", "market")
        price = opts.get("price")
        tp = opts.get("tp")
        sl = opts.get("sl")
        try:
            qty = max(1, int(volume))
        except (TypeError, ValueError):
            qty = 1
        self._seq += 1
        order_id = f"sim-{self._seq}"
        bracket = {"tp": tp, "sl": sl} if (tp is not None or sl is not None) else None

        if type_ == "market":
            self._pending.append({"id": order_id, "side": side, "qty": qty, "bracket": bracket})
        elif type_ in ("limit", "stop"):
            if price is None or not math.isfinite(price):
                raise ValueError(f"{type_} order requires a price")
            self._resting.append({"id": order_id, "side": side, "qty": qty, "type": type_,
                                  "price": price, "bracket": bracket, "oco_group": None})
        else:
            raise ValueError(f"Unknown order type: {type_}")
        return order_id

    def cancel(self, order_id) -> None:
        self._resting = [o for o in self._resting if o["id"] != order_id]
        self._pending = [o for o in self._pending if o["id"] != order_id]

    def flatten(self) -> None:
        """Cancel working orders, then market out of the net position."""
        self._resting = []
        net = self.portfolio.net
        if net > 0:
            self.sell(net, {"type": "market"})
        elif net < 0:
            self.buy(-net, {"type": "market"})

    # ---- state ---------------------------------------------------------------
    def position(self) -> dict:
        return {"net": self.portfolio.net, "avg_price": self.portfolio.avg_price}

    # ---- engine (called by Backtester) ---------------------------------------
    def process_bar(self, bar: dict) -> None:
        """Advance one bar: fill, mark equity, then deliver the close."""
        self._clock_ms = bar["time"] * 1000
        self._fill_pending_market(bar)
        self._scan_resting(bar)
        self.portfolio.mark_equity(bar["time"], bar["close"])
        # Deliver the CLOSED bar; strategy may queue new orders for next bar.
        if self.on_bar:
            self.on_bar({
                "time": bar["time"], "open": bar["open"], "high": bar["high"],
                "low": bar["low"], "close": bar["close"], "volume": bar.get("volume", 0),
            })

    def force_close(self, price, time_sec) -> None:
        """Close any open position at the final price (end of run)."""
        self._pending = []
        self._resting = []
        self.portfolio.force_close(price, time_sec)

    def config_summary(self) -> dict:
        return {
            "point_value": self.portfolio.point_value,
            "commission": self.portfolio.commission,
            "slippage": self.slippage,
            "starting_cash": self.portfolio.starting_cash,
        }

    # ---- fill internals ------------------------------------------------------
    def _emit_fill(self, order, price, bar) -> None:
        self.portfolio.apply_fill(order["side"], order["qty"], price, bar["time"])
        if self.on_fill:
            self.on_fill({"order_id": order["id"], "side": order["side"],
                          "volume": order["qty"], "price": price, "time": bar["time"]})

    def _fill_pending_market(self, bar) -> None:
        if not self._pending:
            return
        pending = self._pending
        self._pending = []
        for o in pending:
            fill = bar["open"] + self.slippage if o["side"] > 0 else bar["open"] - self.slippage
            self._emit_fill(o, fill, bar)
            if o["bracket"]:
                self._install_bracket(o, fill)

    def _scan_resting(self, bar) -> None:
        if not self._resting:
            return
        # Stops first so a one-bar TP+SL collision resolves pessimistically.
        ordered = sorted(self._resting, key=lambda o: 0 if o["type"] == "stop" else 1)
        filled_groups = set()
        filled_ids = set()

        for o in ordered:
            if o["oco_group"] and o["oco_group"] in filled_groups:
                continue  # sibling already filled
            res = self._try_fill(o, bar)
            if not res["filled"]:
                continue
            self._emit_fill(o, res["price"], bar)
            filled_ids.add(o["id"])
            if o["oco_group"]:
                filled_groups.add(o["oco_group"])

        # Drop filled orders and any OCO siblings whose partner filled.
        self._resting = [o for o in self._resting
                         if o["id"] not in filled_ids
                         and not (o["oco_group"] and o["oco_group"] in filled_groups)]

    def _try_fill(self, o, bar) -> dict:
        if o["type"] == "limit":
            if o["side"] > 0 and bar["low"] <= o["price"]:
                return {"filled": True, "price": bar["open"] if bar["open"] <= o["price"] else o["price"]}
            if o["side"] < 0 and bar["high"] >= o["price"]:
                return {"filled": True, "price": bar["open"] if bar["open"] >= o["price"] else o["price"]}
        elif o["type"] == "stop":
            if o["side"] > 0 and bar["high"] >= o["price"]:
                return {"filled": True, "price": max(o["price"], bar["open"]) + self.slippage}
            if o["side"] < 0 and bar["low"] <= o["price"]:
                return {"filled": True, "price": min(o["price"], bar["open"]) - self.slippage}
        return {"filled": False}

    def _install_bracket(self, parent, entry_price) -> None:
        """Attach OCO TP/SL children once the parent (bracketed) order fills."""
        self._seq += 1
        group = f"oco-{self._seq}"
        child_side = -1 if parent["side"] > 0 else 1   # exit is opposite the entry
        tp = parent["bracket"]["tp"]
        sl = parent["bracket"]["sl"]
        if tp is not None:
            self._seq += 1
            self._resting.append({"id": f"sim-{self._seq}", "side": child_side, "qty": parent["qty"],
                                  "type": "limit", "price": tp, "bracket": None, "oco_group": group})
        if sl is not None:
            self._seq += 1
            self._resting.append({"id": f"sim-{self._seq}", "side": child_side, "qty": parent["qty"],
                                  "type": "stop", "price": sl, "bracket": None, "oco_group": group})
