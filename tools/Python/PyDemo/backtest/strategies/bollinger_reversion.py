"""backtest/strategies/bollinger_reversion.py

Mean-reversion on Bollinger Bands, long/flat only — a port of
``BollingerReversion.js``:
  close crosses BELOW the lower band  -> go long (market buy qty)
  close returns to/above the mid band -> go flat (flatten)

Bands = SMA(period) +/- mult * stdev(period).
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


def _float_pos(v, default):
    try:
        f = float(v)
        return f if (math.isfinite(f) and f > 0) else default
    except (TypeError, ValueError):
        return default


class BollingerReversion(Strategy):
    DISPLAY_NAME = "Bollinger Reversion"
    PARAMS = [
        {"key": "period", "label": "Period", "type": "int", "default": 20, "min": 2, "title": "SMA / band lookback"},
        {"key": "mult", "label": "Std Mult", "type": "float", "default": 2.0, "min": 0.1, "step": "any", "title": "Band width in standard deviations"},
        {"key": "qty", "label": "Qty", "type": "int", "default": 1, "min": 1, "title": "Contracts per entry"},
    ]
    PLOTS = [
        {"key": "upper", "label": "Upper Band", "type": "line", "color": "#ef5350", "scale": "price"},
        {"key": "mid", "label": "Mid (SMA)", "type": "line", "color": "#7e57c2", "scale": "price"},
        {"key": "lower", "label": "Lower Band", "type": "line", "color": "#26a69a", "scale": "price"},
    ]

    def __init__(self, params=None):
        super().__init__(params)
        p = self.params
        self.period = max(2, _int(p.get("period"), 20))
        self.mult = _float_pos(p.get("mult"), 2.0)
        self.qty = max(1, _int(p.get("qty"), 1))
        self._closes = []

    def init(self, broker, ctx=None):
        super().init(broker, ctx)
        self.log(f"Bollinger Reversion armed: period={self.period} mult={self.mult} qty={self.qty}")

    def _push(self, close):
        if close is None or not math.isfinite(close):
            return
        self._closes.append(close)
        if len(self._closes) > self.period + 2:
            self._closes.pop(0)

    def on_bar(self, bar):
        self._push(bar["close"])
        mid = I.sma(self._closes, self.period)
        sd = I.stdev(self._closes, self.period)
        if mid is None or sd is None:
            return  # warming up

        lower = mid - self.mult * sd
        self.plot("upper", mid + self.mult * sd)
        self.plot("mid", mid)
        self.plot("lower", lower)
        net = self.position()["net"]

        if bar["close"] < lower and net <= 0:
            if net < 0:
                self.flatten()
            self.buy(self.qty, {"type": "market"})
            self.log(f"Close {bar['close']} < lower {lower:.4f} -> BUY {self.qty}")
        elif bar["close"] >= mid and net > 0:
            self.flatten()
            self.log(f"Close {bar['close']} >= mid {mid:.4f} -> FLATTEN")
