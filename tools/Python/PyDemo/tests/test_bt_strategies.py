"""Integration tests: each core strategy runs end-to-end through the engine on a
synthetic oscillating series, trades, and emits its declared plot keys."""

import math

from backtest.backtester import Backtester
from backtest.strategies import REGISTRY


def _synthetic_bars(n=400):
    """A sine wave around 100 (amp 8) with a slow uptrend — enough swings that
    every long/flat strategy enters and exits at least once."""
    bars = []
    for i in range(n):
        mid = 100 + 0.02 * i + 8 * math.sin(i / 9.0)
        o = mid + 0.5 * math.sin(i / 3.0)
        c = mid
        h = max(o, c) + 1.0
        l = min(o, c) - 1.0
        bars.append({"time": 1_600_000_000 + i * 60, "open": o, "high": h,
                     "low": l, "close": c, "volume": 100})
    return bars


def test_all_strategies_run_and_emit_plots():
    bars = _synthetic_bars()
    for key, cls in REGISTRY.items():
        strat = cls()  # defaults
        res = Backtester().run(bars, strat, {"starting_cash": 100000, "point_value": 1},
                               interval_ms=60_000)
        # Result shape.
        assert set(res) >= {"equity_curve", "trades", "stats", "plots", "config"}
        assert len(res["equity_curve"]) == len(bars)
        # Stats keys present.
        for k in ("netProfit", "totalReturnPct", "maxDrawdown", "numTrades",
                  "winRatePct", "profitFactor", "sharpe", "finalEquity"):
            assert k in res["stats"], f"{key} missing stat {k}"
        # Every declared plot key shows up in at least one bar's values.
        declared = {p["key"] for p in cls.PLOTS}
        seen = set()
        for p in res["plots"]:
            seen |= set(p["values"].keys())
        missing = declared - seen
        assert not missing, f"{key} never emitted plots {missing}"


def test_long_flat_strategies_never_go_short():
    """The core 4 are long/flat — net position must never be negative."""
    bars = _synthetic_bars()
    for key, cls in REGISTRY.items():
        res = Backtester().run(bars, cls(), {"starting_cash": 100000})
        assert all(p["net"] >= 0 for p in res["plots"]), f"{key} went short"
