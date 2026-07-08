"""backtest/backtest_window.py

Tkinter results viewer for the single-instrument backtester — the Python
counterpart of JSDemo's ``algo/ui/BacktestPanel.js``. It runs the SAME strategies
on T4 bars (the chart's loaded history, or a fetched range) and shows:

* an 8-cell stats grid (Net Profit / Return / Max Drawdown / Trades / Win Rate /
  Profit Factor / Sharpe / Final Equity),
* an equity curve,
* a Strategy-View sub-chart (the active strategy's own plot lines + entry/exit
  markers; an oscillator pane for RSI/MACD),
* a trade blotter.

The backtest runs on a worker thread (``backtester.Backtester`` is CPU-bound) and
results are marshalled back onto the Tk thread via ``after()`` — tkinter is not
thread-safe. Importing this module requires matplotlib; callers should guard the
import (see t4_gui) so a missing dep disables the feature gracefully.
"""

from __future__ import annotations

import datetime as _dt
import math
import queue
import threading
import tkinter as tk
from tkinter import ttk

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from . import data
from .backtester import Backtester
from .param_form import build_param_inputs, read_param_inputs
from .strategies import REGISTRY

# Interval label -> seconds. ChartHistory.interval_to_t4 derives the T4
# (unit, period) for any of these.
_INTERVALS = [("15s", 15), ("1m", 60), ("5m", 300), ("15m", 900),
              ("1h", 3600), ("1d", 86400)]
_LABEL_TO_SEC = dict(_INTERVALS)
_SEC_TO_LABEL = {s: l for l, s in _INTERVALS}


# --- formatting helpers ------------------------------------------------------
def _fmt_money(v) -> str:
    return "—" if v is None or (isinstance(v, float) and not math.isfinite(v)) else f"${float(v):,.2f}"


def _fmt_pct(v) -> str:
    return "—" if v is None or (isinstance(v, float) and not math.isfinite(v)) else f"{float(v):.2f}%"


def _fmt_num(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float) and math.isinf(v):
        return "∞"
    if isinstance(v, float) and math.isnan(v):
        return "—"
    return f"{float(v):.2f}"


def _dtime(unix_sec) -> _dt.datetime:
    return _dt.datetime.utcfromtimestamp(int(unix_sec))


class BacktestWindow(tk.Toplevel):
    def __init__(self, parent, client=None):
        super().__init__(parent)
        self.client = client
        self.title("Backtester — single-instrument strategy")
        self.geometry("860x860")
        self.configure(bg="white")
        self._running = False
        self._param_widgets = {}
        # Worker results are marshalled back to the Tk thread through this queue
        # and drained by a main-thread poller; never touch tkinter from _worker
        # (tkinter is not thread-safe — that includes after()).
        self._result_q = queue.Queue()
        self._build()

    # -- UI construction -------------------------------------------------------
    def _build(self):
        form = tk.Frame(self, bg="white", padx=16, pady=10)
        form.pack(fill="x")

        # Strategy dropdown (display names -> registry keys).
        self._name_to_key = {cls.DISPLAY_NAME: key for key, cls in REGISTRY.items()}
        tk.Label(form, text="Strategy:", bg="white").grid(row=0, column=0, sticky="w")
        self.strategy = ttk.Combobox(form, values=list(self._name_to_key.keys()),
                                     state="readonly", width=20)
        self.strategy.grid(row=0, column=1, columnspan=3, sticky="w", padx=(4, 16))
        self.strategy.bind("<<ComboboxSelected>>", lambda _e: self._rebuild_params())

        # Dynamic strategy params.
        self.params_frame = tk.Frame(form, bg="white")
        self.params_frame.grid(row=1, column=0, columnspan=4, sticky="w", pady=(6, 6))

        # Cost model.
        tk.Label(form, text="Point value:", bg="white").grid(row=2, column=0, sticky="w")
        self.point_value = tk.Entry(form, width=8)
        self.point_value.insert(0, "1")
        self.point_value.grid(row=2, column=1, sticky="w", padx=(4, 16))
        tk.Label(form, text="Commission:", bg="white").grid(row=2, column=2, sticky="w")
        self.commission = tk.Entry(form, width=8)
        self.commission.insert(0, "0")
        self.commission.grid(row=2, column=3, sticky="w", padx=(4, 16))
        tk.Label(form, text="Slippage:", bg="white").grid(row=2, column=4, sticky="w")
        self.slippage = tk.Entry(form, width=8)
        self.slippage.insert(0, "0")
        self.slippage.grid(row=2, column=5, sticky="w", padx=(4, 16))

        # Data window.
        tk.Label(form, text="Interval:", bg="white").grid(row=3, column=0, sticky="w", pady=(6, 0))
        self.interval = ttk.Combobox(form, values=[l for l, _ in _INTERVALS],
                                     state="readonly", width=6)
        self.interval.set("1m")
        self.interval.grid(row=3, column=1, sticky="w", padx=(4, 16), pady=(6, 0))
        tk.Label(form, text="From:", bg="white").grid(row=3, column=2, sticky="w", pady=(6, 0))
        self.start = tk.Entry(form, width=18)
        self.start.grid(row=3, column=3, sticky="w", padx=(4, 8), pady=(6, 0))
        tk.Label(form, text="To:", bg="white").grid(row=3, column=4, sticky="w", pady=(6, 0))
        self.end = tk.Entry(form, width=18)
        self.end.grid(row=3, column=5, sticky="w", padx=(4, 8), pady=(6, 0))

        self.run_btn = tk.Button(form, text="Run Backtest", bg="#3b82f6", fg="white",
                                 command=self._run)
        self.run_btn.grid(row=0, column=4, columnspan=2, sticky="e", padx=(8, 0))

        self.status = tk.Label(self, text="", bg="white", fg="#555", anchor="w")
        self.status.pack(fill="x", padx=16)
        note = tk.Label(
            self, bg="white", fg="#777", justify="left", anchor="w", wraplength=820,
            text=("Runs the selected strategy on T4 bars. Leave From/To blank to "
                  "backtest the chart window's currently-loaded bars; set them "
                  "(YYYY-MM-DD or 'YYYY-MM-DD HH:MM') to fetch that range for the "
                  "selected market (needs login + a subscribed contract)."),
        )
        note.pack(fill="x", padx=16, pady=(0, 6))

        # Stats grid.
        self.stats_frame = tk.Frame(self, bg="white", padx=16, pady=6)
        self.stats_frame.pack(fill="x")

        # Result tabs: Equity / Strategy View / Trades.
        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=12, pady=(4, 10))

        eq_tab = tk.Frame(nb, bg="white")
        nb.add(eq_tab, text="Equity Curve")
        self.eq_fig = Figure(figsize=(7.8, 3.2), dpi=100)
        self.eq_ax = self.eq_fig.add_subplot(111)
        self.eq_fig.tight_layout()
        self.eq_canvas = FigureCanvasTkAgg(self.eq_fig, master=eq_tab)
        self.eq_canvas.get_tk_widget().pack(fill="both", expand=True)

        sv_tab = tk.Frame(nb, bg="white")
        nb.add(sv_tab, text="Strategy View")
        self.sv_fig = Figure(figsize=(7.8, 3.6), dpi=100)
        self.sv_canvas = FigureCanvasTkAgg(self.sv_fig, master=sv_tab)
        self.sv_canvas.get_tk_widget().pack(fill="both", expand=True)

        tr_tab = tk.Frame(nb, bg="white")
        nb.add(tr_tab, text="Trades")
        cols = ("time", "dir", "qty", "entry", "exit", "pnl")
        headers = ("Time", "Dir", "Qty", "Entry", "Exit", "Net P&L")
        self.tree = ttk.Treeview(tr_tab, columns=cols, show="headings", height=10)
        for c, h in zip(cols, headers):
            self.tree.heading(c, text=h)
            self.tree.column(c, width=130, anchor="center")
        vsb = ttk.Scrollbar(tr_tab, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self.tree.tag_configure("win", foreground="#137333")
        self.tree.tag_configure("loss", foreground="#c0392b")

        # Default selection + initial param render.
        first = next(iter(self._name_to_key), None)
        if first:
            self.strategy.set(first)
            self._rebuild_params()

    def _rebuild_params(self):
        key = self._name_to_key.get(self.strategy.get())
        cls = REGISTRY.get(key)
        if cls is None:
            return
        self._active_schema = cls.PARAMS
        self._param_widgets = build_param_inputs(self.params_frame, cls.PARAMS)

    # -- run / worker ----------------------------------------------------------
    def _run(self):
        if self._running:
            return
        key = self._name_to_key.get(self.strategy.get())
        cls = REGISTRY.get(key)
        if cls is None:
            self._set_status("Pick a strategy.", error=True)
            return
        try:
            cfg = {
                "point_value": float(self.point_value.get() or 1),
                "commission": float(self.commission.get() or 0),
                "slippage": float(self.slippage.get() or 0),
                "starting_cash": 100000,   # JSDemo parity
            }
        except ValueError:
            self._set_status("Point value / commission / slippage must be numbers.", error=True)
            return

        start_raw = self.start.get().strip()
        end_raw = self.end.get().strip()
        use_fetch = bool(start_raw)
        start_iso = end_iso = None
        if use_fetch:
            try:
                start_iso = self._parse_dt(start_raw, end=False)
                end_iso = self._parse_dt(end_raw, end=True) if end_raw else \
                    _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
            except ValueError:
                self._set_status("Dates must be 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM'.", error=True)
                return

        params = read_param_inputs(self._param_widgets, cls.PARAMS)
        interval_sec = _LABEL_TO_SEC.get(self.interval.get(), 60)
        opts = {
            "cls": cls, "params": params, "cfg": cfg,
            "use_fetch": use_fetch, "interval_sec": interval_sec,
            "start_iso": start_iso, "end_iso": end_iso,
        }
        self._running = True
        self.run_btn.config(state="disabled")
        self._set_status("Running…")
        threading.Thread(target=self._worker, args=(opts,), daemon=True).start()
        # Poll from the main (Tk) thread — after() is only safe to call here.
        self._poll_results()

    def _worker(self, opts):
        # Runs off the Tk thread: must not call any tkinter method (including
        # after()). Push the outcome onto the queue; the poller does the UI work.
        try:
            tz = self._tz_offset()
            if opts["use_fetch"]:
                bars, source = data.fetch_t4_bars(
                    self.client, opts["interval_sec"], opts["start_iso"], opts["end_iso"], tz)
                interval_sec = opts["interval_sec"]
                src_label = f"fetched ({source})"
            else:
                bars, interval_sec = data.chart_bars(self.client)
                src_label = "chart history"
            strategy = opts["cls"](opts["params"])
            result = Backtester().run(bars, strategy, opts["cfg"],
                                      interval_ms=interval_sec * 1000)
            result["_meta"] = {
                "rows": len(bars), "interval_sec": interval_sec, "source": src_label,
                "span": f"{_dtime(bars[0]['time']):%Y-%m-%d %H:%M} → "
                        f"{_dtime(bars[-1]['time']):%Y-%m-%d %H:%M}",
                "plots_schema": opts["cls"].PLOTS,
            }
        except data.BacktestDataError as exc:
            self._result_q.put(("error", str(exc)))
            return
        except Exception as exc:  # noqa: BLE001 - never let the worker die silently
            self._result_q.put(("error", f"Unexpected error: {exc}"))
            return
        self._result_q.put(("render", result))

    def _poll_results(self):
        """Drain worker results on the Tk thread; reschedule until one arrives."""
        try:
            kind, payload = self._result_q.get_nowait()
        except queue.Empty:
            if self._running:
                self.after(100, self._poll_results)
            return
        if kind == "error":
            self._on_error(payload)
        else:
            self._render(payload)

    def _on_error(self, msg):
        self._running = False
        self.run_btn.config(state="normal")
        self._set_status(f"Failed: {msg}", error=True)

    # -- rendering -------------------------------------------------------------
    def _render(self, result):
        self._running = False
        self.run_btn.config(state="normal")
        try:
            self._render_stats(result["stats"])
            self._render_equity(result["equity_curve"])
            self._render_strategy_view(result)
            self._render_trades(result["trades"])
            m = result["_meta"]
            self._set_status(f"Done — {self.strategy.get()} on {m['rows']} bars "
                             f"({_SEC_TO_LABEL.get(m['interval_sec'], '')}, {m['source']}, {m['span']}).")
        except Exception as exc:  # noqa: BLE001
            self._set_status(f"Render failed: {exc}", error=True)

    def _render_stats(self, s):
        for w in self.stats_frame.winfo_children():
            w.destroy()
        dd = f"{_fmt_money(s.get('maxDrawdown'))} ({_fmt_pct(s.get('maxDrawdownPct'))})"
        sharpe_label = "Sharpe (ann.)" if s.get("sharpeAnnualized") else "Sharpe"
        cells = [
            ("Net Profit", _fmt_money(s.get("netProfit"))),
            ("Return", _fmt_pct(s.get("totalReturnPct"))),
            ("Max Drawdown", dd),
            ("Trades", str(s.get("numTrades", 0))),
            ("Win Rate", _fmt_pct(s.get("winRatePct"))),
            ("Profit Factor", _fmt_num(s.get("profitFactor"))),
            (sharpe_label, _fmt_num(s.get("sharpe"))),
            ("Final Equity", _fmt_money(s.get("finalEquity"))),
        ]
        for i, (label, value) in enumerate(cells):
            col = i % 4
            row = (i // 4) * 2
            tk.Label(self.stats_frame, text=label, bg="white", fg="#777",
                     font=("Arial", 9)).grid(row=row, column=col, sticky="w", padx=(0, 22))
            tk.Label(self.stats_frame, text=value, bg="white",
                     font=("Arial", 12, "bold")).grid(row=row + 1, column=col, sticky="w", padx=(0, 22))

    def _render_equity(self, equity):
        self.eq_ax.clear()
        self.eq_ax.set_title("Equity Curve", fontsize=9)
        xs = [_dtime(p["time"]) for p in equity]
        ys = [p["value"] for p in equity]
        if xs:
            self.eq_ax.plot(xs, ys, color="#2962ff", linewidth=1.5)
        self.eq_ax.grid(True, alpha=0.3)
        self.eq_fig.autofmt_xdate()
        self.eq_fig.tight_layout()
        self.eq_canvas.draw()

    def _render_strategy_view(self, result):
        plots = result.get("plots", [])
        schema = result["_meta"]["plots_schema"]
        trades = result.get("trades", [])
        self.sv_fig.clear()

        has_osc = any(p.get("scale") == "osc" for p in schema)
        if has_osc:
            ax_price = self.sv_fig.add_subplot(2, 1, 1)
            ax_osc = self.sv_fig.add_subplot(2, 1, 2, sharex=ax_price)
        else:
            ax_price = self.sv_fig.add_subplot(1, 1, 1)
            ax_osc = None

        # Context close line.
        cx = [_dtime(p["time"]) for p in plots]
        cy = [p["close"] for p in plots]
        if cx:
            ax_price.plot(cx, cy, color="#b0bec5", linewidth=1.0, label="close")

        # Price-scale plot lines.
        for spec in schema:
            if spec.get("scale") != "price":
                continue
            xs, ys = self._plot_series(plots, spec["key"])
            if xs:
                ax_price.plot(xs, ys, color=spec.get("color", "#000"),
                              linewidth=1.2, label=spec.get("label", spec["key"]))

        # Entry/exit markers (buy fills green up, sell fills red down).
        self._mark_trades(ax_price, trades)
        ax_price.set_title("Strategy View", fontsize=9)
        ax_price.grid(True, alpha=0.3)
        ax_price.legend(loc="upper left", fontsize=7, ncol=3)

        # Oscillator pane (RSI / MACD lines + histogram).
        if ax_osc is not None:
            for spec in schema:
                if spec.get("scale") != "osc":
                    continue
                xs, ys = self._plot_series(plots, spec["key"])
                if not xs:
                    continue
                if spec.get("type") == "histogram":
                    ax_osc.vlines(xs, 0, ys, color=spec.get("color", "#90a4ae"),
                                  linewidth=1.0, label=spec.get("label", spec["key"]))
                else:
                    ax_osc.plot(xs, ys, color=spec.get("color", "#000"),
                                linewidth=1.0, label=spec.get("label", spec["key"]))
            ax_osc.axhline(0, color="#cccccc", linewidth=0.8)
            ax_osc.grid(True, alpha=0.3)
            ax_osc.legend(loc="upper left", fontsize=7, ncol=3)

        self.sv_fig.autofmt_xdate()
        self.sv_fig.tight_layout()
        self.sv_canvas.draw()

    @staticmethod
    def _plot_series(plots, key):
        xs, ys = [], []
        for p in plots:
            v = p.get("values", {}).get(key)
            if v is not None:
                xs.append(_dtime(p["time"]))
                ys.append(v)
        return xs, ys

    @staticmethod
    def _mark_trades(ax, trades):
        buys_x, buys_y, sells_x, sells_y = [], [], [], []
        for t in trades:
            x = _dtime(t["time"])
            if t["side"] > 0:
                buys_x.append(x); buys_y.append(t["price"])
            else:
                sells_x.append(x); sells_y.append(t["price"])
        if buys_x:
            ax.scatter(buys_x, buys_y, marker="^", color="#26a69a", s=36, zorder=5, label="buy")
        if sells_x:
            ax.scatter(sells_x, sells_y, marker="v", color="#ef5350", s=36, zorder=5, label="sell")

    def _render_trades(self, trades):
        self.tree.delete(*self.tree.get_children())
        closed = [t for t in trades if t.get("closing")]
        if not closed:
            self.tree.insert("", "end", values=("No closed trades", "", "", "", "", ""))
            return
        # Newest first, cap 200 (JSDemo parity).
        for t in reversed(closed[-200:]):
            net = (t.get("pnl") or 0) - (t.get("commission") or 0)
            # The closing fill's side tells us the direction of the position it
            # closed: a sell (-1) closed a long; a buy (+1) closed a short.
            direction = "Long" if t["side"] < 0 else "Short"
            tag = "win" if net > 0 else ("loss" if net < 0 else "")
            self.tree.insert("", "end", tags=(tag,), values=(
                f"{_dtime(t['time']):%Y-%m-%d %H:%M}",
                direction,
                int(t.get("closed_qty") or t.get("qty") or 0),
                _fmt_num(t.get("entry_price")),
                _fmt_num(t.get("price")),
                _fmt_money(net),
            ))

    # -- helpers ---------------------------------------------------------------
    def _tz_offset(self) -> float:
        try:
            cfg = (getattr(self.client, "config", None) or {}).get("chart", {}) or {}
            return float(cfg.get("tz_offset_hours", 0.0) or 0.0)
        except Exception:  # noqa: BLE001
            return 0.0

    @staticmethod
    def _parse_dt(raw: str, end: bool) -> str:
        """Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' to a T4 ISO string."""
        raw = raw.strip().replace("T", " ")
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                dt = _dt.datetime.strptime(raw, fmt)
                if fmt == "%Y-%m-%d" and end:
                    dt = dt.replace(hour=23, minute=59, second=59)
                return dt.strftime("%Y-%m-%dT%H:%M:%S")
            except ValueError:
                continue
        raise ValueError(f"unrecognized date: {raw!r}")

    def _set_status(self, text, error=False):
        self.status.config(text=text, fg="#c0392b" if error else "#555")
