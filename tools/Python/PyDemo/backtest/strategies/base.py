"""backtest/strategies/base.py

Base class for backtest strategies — a port of ``algo/strategies/Strategy.js``.

A strategy is pure decision logic: it reacts to closed bars and issues intents
through the broker. It must not know whether the broker is live or simulated.

Lifecycle (driven by the Backtester):
    init(broker, ctx)  once, before any events
    warmup(bars)       optional; seed indicators from history (no orders)
    on_bar(bar)        on each CLOSED bar (primary entry point)
    on_fill(fill)      on each execution (optional)
    teardown()         once, on stop (optional)

Subclasses declare ``PARAMS`` and ``PLOTS`` schemas (mirroring JSDemo's static
``params`` / ``plots``) and override the event hooks. The buy/sell/flatten
helpers forward to the broker so strategy code stays terse.
"""

from __future__ import annotations

import math


class Strategy:
    DISPLAY_NAME = "Strategy"

    # Tunable parameters, used by the UI to render inputs dynamically. Each item:
    #   {key, label, type:'int'|'float', default, min?, max?, step?, title?}
    PARAMS: list[dict] = []

    # Traces the strategy draws on the Strategy View. Each item:
    #   {key, label, type:'line'|'histogram', color, scale:'price'|'osc'}
    PLOTS: list[dict] = []

    def __init__(self, params: dict | None = None) -> None:
        self.params = params or {}
        self.broker = None
        self._log = lambda *a, **k: None
        # Per-bar scratch for the Strategy View: indicator readings keyed by plot
        # key. Filled by plot() during on_bar, drained after on_bar.
        self._plot = {}

    # ---- lifecycle (override as needed) -------------------------------------
    def init(self, broker, ctx=None) -> None:
        ctx = ctx or {}
        self.broker = broker
        if callable(ctx.get("log")):
            self._log = ctx["log"]

    def warmup(self, bars) -> None:  # pragma: no cover - not used in backtest
        pass

    def on_bar(self, bar) -> None:
        pass

    def on_fill(self, fill) -> None:
        pass

    def teardown(self) -> None:
        pass

    # ---- helpers ------------------------------------------------------------
    def buy(self, volume, opts=None):
        return self.broker.buy(volume, opts or {})

    def sell(self, volume, opts=None):
        return self.broker.sell(volume, opts or {})

    def flatten(self):
        return self.broker.flatten()

    def position(self):
        return self.broker.position()

    def log(self, msg, level="info"):
        self._log(msg, level)

    def plot(self, key, value) -> None:
        """Record an indicator value for this bar so the Strategy View can plot
        it. Only keys declared in PLOTS are rendered; others are harmless."""
        if value is not None and math.isfinite(value):
            self._plot[key] = value

    def _drain_plots(self) -> dict:
        p = self._plot
        self._plot = {}
        return p
