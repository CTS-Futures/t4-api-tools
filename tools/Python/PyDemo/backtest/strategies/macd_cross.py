"""backtest/strategies/macd_cross.py

Trend/momentum via MACD, long/flat only — a port of ``MacdCross.js``. Uses
``indicators.macd`` (Pine-seeded, matching TradingView ta.macd) so crossovers
line up with the chart:
  MACD line crosses ABOVE its signal (hist crosses 0 up)   -> go long
  MACD line crosses BELOW its signal (hist crosses 0 down)  -> go flat
"""

from __future__ import annotations

import math

from .base import Strategy
from .. import indicators as I


def _int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


class MacdCross(Strategy):
    DISPLAY_NAME = "MACD Crossover"
    PARAMS = [
        {"key": "fast", "label": "Fast", "type": "int", "default": 12, "min": 1, "title": "Fast EMA period"},
        {"key": "slow", "label": "Slow", "type": "int", "default": 26, "min": 2, "title": "Slow EMA period"},
        {"key": "signal", "label": "Signal", "type": "int", "default": 9, "min": 1, "title": "Signal EMA period"},
        {"key": "qty", "label": "Qty", "type": "int", "default": 1, "min": 1, "title": "Contracts per entry"},
    ]
    PLOTS = [
        {"key": "hist", "label": "Histogram", "type": "histogram", "color": "#90a4ae", "scale": "osc"},
        {"key": "macd", "label": "MACD", "type": "line", "color": "#2962ff", "scale": "osc"},
        {"key": "signal", "label": "Signal", "type": "line", "color": "#ff6d00", "scale": "osc"},
    ]

    def __init__(self, params=None):
        super().__init__(params)
        p = self.params
        self.fast = max(1, _int(p.get("fast"), 12))
        self.slow = max(self.fast + 1, _int(p.get("slow"), 26))
        self.signal = max(1, _int(p.get("signal"), 9))
        self.qty = max(1, _int(p.get("qty"), 1))
        self._closes = []
        # Generous buffer so the seeded EMAs converge to stable values.
        self._cap = self.slow + self.signal + 250
        self._prev_hist = None

    def init(self, broker, ctx=None):
        super().init(broker, ctx)
        self.log(f"MACD Crossover armed: fast={self.fast} slow={self.slow} "
                 f"signal={self.signal} qty={self.qty}")

    def _push(self, close):
        if close is None or not math.isfinite(close):
            return
        self._closes.append(close)
        if len(self._closes) > self._cap:
            self._closes.pop(0)

    def on_bar(self, bar):
        self._push(bar["close"])
        m = I.macd(self._closes, self.fast, self.slow, self.signal)
        if m is None:
            return  # warming up
        self.plot("macd", m["macd"])
        self.plot("signal", m["signal"])
        self.plot("hist", m["hist"])

        if self._prev_hist is not None:
            net = self.position()["net"]
            crossed_up = self._prev_hist <= 0 and m["hist"] > 0
            crossed_down = self._prev_hist >= 0 and m["hist"] < 0
            if crossed_up and net <= 0:
                if net < 0:
                    self.flatten()
                self.buy(self.qty, {"type": "market"})
                self.log(f"MACD cross UP @ {bar['close']} -> BUY {self.qty}")
            elif crossed_down and net > 0:
                self.flatten()
                self.log(f"MACD cross DOWN @ {bar['close']} -> FLATTEN")
        self._prev_hist = m["hist"]
