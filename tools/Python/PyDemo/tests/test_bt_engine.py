"""Unit tests for the ported backtest engine (SimBroker / Portfolio / Backtester).

These pin the invariants that must match JSDemo: one-bar lag on market fills,
OCO stop-first resolution, weighted-avg PnL accounting, and the stats math.
"""

import math

from backtest.backtester import Backtester
from backtest.strategies.base import Strategy


def _bar(t, o, h, l, c, v=0):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v}


class BuyOnceMarket(Strategy):
    """Buys 1 (plain market) on the first bar it sees, then never again."""
    def __init__(self, params=None):
        super().__init__(params)
        self._done = False

    def on_bar(self, bar):
        if not self._done:
            self._done = True
            self.buy(1, {"type": "market"})


class BuyBracketOnce(Strategy):
    """Buys 1 with a TP/SL bracket on the first bar, then never again."""
    def __init__(self, params=None):
        super().__init__(params)
        self._done = False

    def on_bar(self, bar):
        if not self._done:
            self._done = True
            self.buy(1, {"type": "market", "tp": 110, "sl": 90})


def test_one_bar_lag_market_fills_next_open():
    bars = [
        _bar(1, 100, 100, 100, 100),   # strategy buys on this close
        _bar(2, 105, 106, 104, 105),   # market should fill at THIS open (105)
        _bar(3, 105, 105, 105, 105),
    ]
    res = Backtester().run(bars, BuyOnceMarket(), {"starting_cash": 100000})
    fills = res["trades"]
    # First fill is the entry at bar2 open.
    assert fills[0]["time"] == 2
    assert fills[0]["price"] == 105
    assert fills[0]["side"] == 1


def test_oco_stop_resolves_first():
    # Entry fills at bar2 open (100); bar3 spans BOTH tp(110) and sl(90) → the
    # stop must win (pessimistic), closing the long at 90 for a -10 loss.
    bars = [
        _bar(1, 100, 100, 100, 100),
        _bar(2, 100, 100, 100, 100),   # entry fills here @ 100, bracket installed
        _bar(3, 100, 115, 85, 100),    # both TP and SL in range
        _bar(4, 100, 100, 100, 100),
    ]
    res = Backtester().run(bars, BuyBracketOnce(), {"starting_cash": 100000})
    closing = [t for t in res["trades"] if t["closing"]]
    assert len(closing) == 1
    assert closing[0]["price"] == 90
    assert math.isclose(closing[0]["pnl"], -10.0, rel_tol=1e-12)
    # No open position left, so the run's net profit equals that loss.
    assert math.isclose(res["stats"]["netProfit"], -10.0, rel_tol=1e-12)


def test_pnl_point_value_and_commission():
    # Long 1 @100 (bar2 open), force-closed at last close (120) → +20 points.
    bars = [
        _bar(1, 100, 100, 100, 100),
        _bar(2, 100, 100, 100, 100),
        _bar(3, 120, 120, 120, 120),
    ]
    res = Backtester().run(bars, BuyOnceMarket(),
                           {"starting_cash": 100000, "point_value": 2, "commission": 1})
    # gross = (120-100)*1*2 = 40 ; commissions = 1 entry + 1 exit = 2 → net 38.
    assert math.isclose(res["stats"]["netProfit"], 38.0, rel_tol=1e-12)
    assert res["stats"]["numTrades"] == 1
    # finalEquity is the LAST per-bar equity mark (bar3 close: +40 unrealized,
    # only the entry commission deducted = 100039). force_close realizes the
    # exit (and its commission) afterwards WITHOUT re-marking the curve — a
    # faithful JSDemo quirk: finalEquity (100039) != startingCash+netProfit (100038).
    assert res["stats"]["finalEquity"] == 100039.0


def test_equity_curve_marks_unrealized():
    bars = [
        _bar(1, 100, 100, 100, 100),
        _bar(2, 100, 100, 100, 100),   # entry @100
        _bar(3, 110, 110, 110, 110),   # unrealized +10 marked at close
    ]
    res = Backtester().run(bars, BuyOnceMarket(), {"starting_cash": 100000})
    eq = res["equity_curve"]
    assert len(eq) == 3
    # At bar3 close the open long is +10 over cash.
    assert math.isclose(eq[2]["value"], 100010.0, rel_tol=1e-12)


def test_too_few_bars_raises():
    try:
        Backtester().run([_bar(1, 1, 1, 1, 1)], BuyOnceMarket())
    except ValueError:
        return
    assert False, "expected ValueError for < 2 bars"
