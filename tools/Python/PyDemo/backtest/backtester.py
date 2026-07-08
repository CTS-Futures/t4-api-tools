"""backtest/backtester.py

Drives a strategy over a fixed list of historical bars through a SimBroker and
returns the run's equity curve, trade blotter, summary stats, and per-bar plot
values. A faithful port of ``algo/Backtester.js``.

It is deliberately PURE: it takes already-normalized bars (display-unit OHLC,
UTC-second timestamps, ascending) rather than fetching/parsing them — the UI
sources those bars from the chart's loaded history or a T4 range fetch, so the
backtest and the on-screen chart agree.
"""

from __future__ import annotations

from .sim_broker import SimBroker


class Backtester:
    def run(self, bars, strategy, config=None, interval_ms=None) -> dict:
        """Replay ``bars`` through ``strategy`` and return the result dict:
        ``{bars, equity_curve, trades, stats, config, plots}``.

        config keys: point_value, commission, slippage, starting_cash, log.
        ``interval_ms`` (optional) annualizes Sharpe.
        """
        config = config or {}
        if not isinstance(bars, list) or len(bars) < 2:
            raise ValueError("Backtest needs at least 2 bars — load more history first")
        # Defensive: ensure ascending by time (chart history already is).
        series = sorted(bars, key=lambda b: b["time"])

        sim = SimBroker(config)
        log = config.get("log") if callable(config.get("log")) else (lambda *a, **k: None)
        strategy.init(sim, {"log": log})

        # Wire the strategy to the broker's bar/fill stream — the same hookup
        # AlgoRunner does live. (No 'tick' in backtest: the engine is bar-driven.)
        def _on_bar(b):
            try:
                strategy.on_bar(b)
            except Exception as e:  # noqa: BLE001
                log(f"Strategy error: {e}", "error")

        def _on_fill(f):
            try:
                strategy.on_fill(f)
            except Exception as e:  # noqa: BLE001
                log(f"Strategy error: {e}", "error")

        sim.on_bar = _on_bar
        sim.on_fill = _on_fill

        # No warmup seeding: the strategy accumulates indicators from the first
        # bar, mirroring a live run that starts cold. process_bar synchronously
        # invokes on_bar -> strategy.on_bar, so by the time it returns the
        # strategy has stashed this bar's plot values; drain them per bar for the
        # Strategy View.
        plots = []
        wants_plots = hasattr(strategy, "_drain_plots")
        for b in series:
            sim.process_bar(b)
            if wants_plots:
                plots.append({"time": b["time"], "close": b["close"],
                              "values": strategy._drain_plots(),
                              "net": sim.position()["net"]})

        # Realize any open position at the last close for a clean net-profit
        # figure (otherwise the result hides open risk).
        last = series[-1]
        sim.force_close(last["close"], last["time"])

        teardown = getattr(strategy, "teardown", None)
        if callable(teardown):
            try:
                teardown()
            except Exception:  # noqa: BLE001
                pass

        return {
            "bars": series,
            "equity_curve": sim.portfolio.equity_curve,
            "trades": sim.portfolio.trades,
            "stats": sim.portfolio.stats(interval_ms),
            "config": sim.config_summary(),
            "plots": plots,
        }
