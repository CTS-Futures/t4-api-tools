"""PyDemo Portfolio Study feature.

A launcher + results viewer for the walk-forward rotation backtest that lives in
the sibling ``algo-py/research`` package. PyDemo does NOT reimplement the
algorithm: it shells out to ``research.run_portfolio_study --json`` (the same
way JSDemo's server does), reads the JSON result, and renders it in a Tkinter
window with an embedded matplotlib equity curve.

(The single-instrument Backtester is a separate, self-contained JSDemo port that
runs in-process on T4 bars — see the sibling ``backtest/`` package.)
"""
