"""backtest/strategies/rsi_reversion.py

Mean-reversion on Wilder's RSI, long/flat only — a port of ``RsiReversion.js``:
  RSI crosses DOWN through `oversold` -> go long (market buy qty)
  RSI crosses UP through `exit`       -> go flat (flatten)
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


def _float(v, default):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


class RsiReversion(Strategy):
    DISPLAY_NAME = "RSI Reversion"
    PARAMS = [
        {"key": "period", "label": "RSI Period", "type": "int", "default": 14, "min": 2, "title": "RSI lookback"},
        {"key": "oversold", "label": "Oversold", "type": "float", "default": 30, "min": 1, "max": 99, "step": "any", "title": "Enter long when RSI dips below this"},
        {"key": "exit", "label": "Exit", "type": "float", "default": 50, "min": 1, "max": 99, "step": "any", "title": "Flatten when RSI rises above this"},
        {"key": "qty", "label": "Qty", "type": "int", "default": 1, "min": 1, "title": "Contracts per entry"},
    ]
    PLOTS = [
        {"key": "rsi", "label": "RSI", "type": "line", "color": "#42a5f5", "scale": "osc"},
    ]

    def __init__(self, params=None):
        super().__init__(params)
        p = self.params
        self.period = max(2, _int(p.get("period"), 14))
        self.oversold = _float(p.get("oversold"), 30)
        self.exit = _float(p.get("exit"), 50)
        self.qty = max(1, _int(p.get("qty"), 1))
        self._closes = []
        self._prev_rsi = None

    def init(self, broker, ctx=None):
        super().init(broker, ctx)
        self.log(f"RSI Reversion armed: period={self.period} oversold={self.oversold} "
                 f"exit={self.exit} qty={self.qty}")

    def _push(self, close):
        if close is None or not math.isfinite(close):
            return
        self._closes.append(close)
        if len(self._closes) > self.period + 2:    # need period+1; small margin
            self._closes.pop(0)

    def on_bar(self, bar):
        self._push(bar["close"])
        rsi_now = I.rsi(self._closes, self.period)
        if rsi_now is None:
            return  # warming up
        self.plot("rsi", rsi_now)

        if self._prev_rsi is not None:
            net = self.position()["net"]
            crossed_down_oversold = self._prev_rsi >= self.oversold and rsi_now < self.oversold
            crossed_up_exit = self._prev_rsi <= self.exit and rsi_now > self.exit
            if crossed_down_oversold and net <= 0:
                if net < 0:
                    self.flatten()
                self.buy(self.qty, {"type": "market"})
                self.log(f"RSI {rsi_now:.1f} < {self.oversold} @ {bar['close']} -> BUY {self.qty}")
            elif crossed_up_exit and net > 0:
                self.flatten()
                self.log(f"RSI {rsi_now:.1f} > {self.exit} @ {bar['close']} -> FLATTEN")
        self._prev_rsi = rsi_now
