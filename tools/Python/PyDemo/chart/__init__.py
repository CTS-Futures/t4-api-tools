"""Companion TradingView Lightweight Charts window for PyDemo.

This package adds a live candlestick chart to the PyDemo trading client. It
runs in its own pywebview window (the lightweight-charts library cannot be
embedded inside a tkinter frame) and is bridged back to the tkinter/asyncio
app via a thread-safe queue.

Public entry point: :class:`chart.chart_window.ChartWindow`.
"""
