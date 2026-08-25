"""backtest/strategies/sma_crossover.py

Moving-average crossover, long/flat only — a port of ``SmaCrossover.js``:
  fast SMA crosses ABOVE slow SMA -> go long (market buy qty)
  fast SMA crosses BELOW slow SMA -> go flat (flatten)

Decides only on CLOSED bars (on_bar).
"""

from __future__ import annotations

from .base import Strategy
from .. import indicators as I


def _int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


class SmaCrossover(Strategy):
    DISPLAY_NAME = "SMA Crossover"
    PARAMS = [
        {"key": "fast", "label": "Fast", "type": "int", "default": 9, "min": 1, "title": "Fast SMA period"},
        {"key": "slow", "label": "Slow", "type": "int", "default": 21, "min": 2, "title": "Slow SMA period"},
        {"key": "qty", "label": "Qty", "type": "int", "default": 1, "min": 1, "title": "Contracts per entry"},
    ]
    PLOTS = [
        {"key": "fast", "label": "Fast SMA", "type": "line", "color": "#f6a609", "scale": "price"},
        {"key": "slow", "label": "Slow SMA", "type": "line", "color": "#7e57c2", "scale": "price"},
    ]

    def __init__(self, params=None):
        super().__init__(params)
        p = self.params
        self.fast = max(1, _int(p.get("fast"), 9))
        self.slow = max(self.fast + 1, _int(p.get("slow"), 21))
        self.qty = max(1, _int(p.get("qty"), 1))
        self._closes = []
        self._prev_fast = None
        self._prev_slow = None

    def init(self, broker, ctx=None):
        super().init(broker, ctx)
        self.log(f"SMA Crossover armed: fast={self.fast} slow={self.slow} qty={self.qty}")

    def on_bar(self, bar):
        self._closes.append(bar["close"])
        if len(self._closes) > self.slow + 2:    # bound memory
            self._closes.pop(0)

        fast_now = I.sma(self._closes, self.fast)
        slow_now = I.sma(self._closes, self.slow)
        if fast_now is None or slow_now is None:
            return  # warming up

        self.plot("fast", fast_now)
        self.plot("slow", slow_now)

        if self._prev_fast is not None and self._prev_slow is not None:
            crossed_up = self._prev_fast <= self._prev_slow and fast_now > slow_now
            crossed_down = self._prev_fast >= self._prev_slow and fast_now < slow_now
            net = self.position()["net"]
            if crossed_up and net <= 0:
                if net < 0:
                    self.flatten()
                self.buy(self.qty, {"type": "market"})
                self.log(f"Cross UP @ {bar['close']} -> BUY {self.qty}")
            elif crossed_down and net > 0:
                self.flatten()
                self.log(f"Cross DOWN @ {bar['close']} -> FLATTEN")

        self._prev_fast = fast_now
        self._prev_slow = slow_now
