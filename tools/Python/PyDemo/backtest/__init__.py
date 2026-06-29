"""PyDemo Backtester — a faithful Python port of JSDemo's single-instrument
backtest engine, fed by live T4 bars.

This package reimplements JSDemo's ``algo/`` backtest stack in Python so PyDemo
runs the *same* strategies on the *same* data the chart shows — no outside CSV /
Yahoo data, no sibling research package:

- ``indicators`` — port of ``algo/strategies/indicators.js`` (scalar-returning,
  buffer-based; Pine-seeded MACD, Wilder RSI).
- ``portfolio`` — port of ``algo/Portfolio.js`` (position/PnL accounting, equity
  curve, stats).
- ``sim_broker`` — port of ``algo/SimBroker.js`` (next-open market fills,
  limit/stop rules, OCO brackets with stop-first resolution).
- ``backtester`` — port of ``algo/Backtester.js`` (one-bar-lag replay loop).
- ``strategies`` — port of the core long/flat strategies + the base ``Strategy``.
- ``param_form`` — Tk port of ``algo/ui/ParamForm.js`` (dynamic param inputs).
- ``data`` — fetch T4 bars via ``chart.history.ChartHistory`` (or reuse the
  chart window's already-loaded bars).
- ``backtest_window`` — the Tk results viewer (mirrors ``algo/ui/BacktestPanel.js``).
"""
