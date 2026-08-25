"""backtest/strategies — the core long/flat strategy library (JSDemo parity).

``REGISTRY`` is an ordered mapping of class-name -> Strategy subclass so the
Backtester window can populate its dropdown and instantiate by name, the same
way JSDemo iterates ``Algo.strategies``. DonchianBreakout and the two-sided
MomentumScalper are deferred to a follow-up.
"""

from __future__ import annotations

from collections import OrderedDict

from .base import Strategy
from .sma_crossover import SmaCrossover
from .macd_cross import MacdCross
from .rsi_reversion import RsiReversion
from .bollinger_reversion import BollingerReversion

REGISTRY = OrderedDict([
    ("SmaCrossover", SmaCrossover),
    ("MacdCross", MacdCross),
    ("RsiReversion", RsiReversion),
    ("BollingerReversion", BollingerReversion),
])

__all__ = ["Strategy", "REGISTRY", "SmaCrossover", "MacdCross",
           "RsiReversion", "BollingerReversion"]
