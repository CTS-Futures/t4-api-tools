"""study/study_window.py

Tkinter results viewer for the walk-forward portfolio rotation backtest.

Shows a run form (basket / source / CSV dir / Run), an embedded matplotlib equity
curve (rotation vs equal-weight buy & hold), a stats grid, and a re-tune log
table. The backtest itself runs in ``study.runner.run_study`` on a worker thread
so PyDemo's tkinter/asyncio loop and price chart stay responsive; results are
marshalled back onto the Tk thread via ``after()`` (tkinter is not thread-safe —
never draw from the worker).

Layout/labels mirror JSDemo's algo/ui/PortfolioStudyPanel.js so the two front
ends stay consistent. Importing this module requires matplotlib; callers should
guard the import (see t4_gui) so a missing dep disables the feature gracefully.
"""

from __future__ import annotations

import datetime as _dt
import queue
import threading
import tkinter as tk
from tkinter import ttk

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from . import runner


# --- formatting helpers (mirror PortfolioStudyPanel.js) ----------------------
def _fmt_money(v) -> str:
    return "—" if v is None else f"${float(v):,.0f}"


def _fmt_pct(v) -> str:
    return "—" if v is None else f"{float(v):.2f}%"


def _fmt_num(v) -> str:
    return "—" if v is None else f"{float(v):.2f}"


def _iso_day(unix_sec) -> str:
    if unix_sec is None:
        return "—"
    return _dt.datetime.utcfromtimestamp(int(unix_sec)).strftime("%Y-%m-%d")


class PortfolioStudyWindow(tk.Toplevel):
    def __init__(self, parent, client=None):
        super().__init__(parent)
        self.client = client
        self.title("Portfolio Study — walk-forward rotation")
        self.geometry("820x720")
        self.configure(bg="white")
        self._running = False
        self._elapsed = 0
        self._elapsed_after = None
        # Worker results are marshalled back to the Tk thread through this queue
        # and drained by a main-thread poller; never touch tkinter from _worker.
        self._result_q = queue.Queue()
        self._build()

    # -- UI construction -------------------------------------------------------
    def _build(self):
        form = tk.Frame(self, bg="white", padx=16, pady=12)
        form.pack(fill="x")

        tk.Label(form, text="Basket: ES/NQ/YM/RTY (futures) · Source: live T4",
                 bg="white", fg="#555").grid(row=0, column=0, columnspan=4, sticky="w")

        tk.Label(form, text="From:", bg="white").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.start = tk.Entry(form, width=14)
        self.start.grid(row=1, column=1, sticky="w", padx=(4, 16), pady=(8, 0))
        tk.Label(form, text="To:", bg="white").grid(row=1, column=2, sticky="w", pady=(8, 0))
        self.end = tk.Entry(form, width=14)
        self.end.grid(row=1, column=3, sticky="w", padx=(4, 16), pady=(8, 0))

        self.run_btn = tk.Button(form, text="Run Study", bg="#3b82f6", fg="white",
                                 command=self._run)
        self.run_btn.grid(row=0, column=4, rowspan=2, padx=(8, 0))

        self.status = tk.Label(self, text="", bg="white", fg="#555", anchor="w")
        self.status.pack(fill="x", padx=16)

        # Indeterminate progress bar — the run is slow (several minutes), so this
        # plus the streamed status lines make it obvious the study is alive.
        self.progress = ttk.Progressbar(self, mode="indeterminate")
        self.progress.pack(fill="x", padx=16, pady=(2, 0))

        note = tk.Label(
            self, bg="white", fg="#777", justify="left", anchor="w", wraplength=780,
            text=("Runs the walk-forward rotation on the ES/NQ/YM/RTY futures basket "
                  "using live T4 daily bars over the From/To window, and shows the "
                  "out-of-sample equity vs an equal-weight buy & hold. Instruments your "
                  "feed doesn't carry (e.g. YM on some sims) are skipped automatically. "
                  "Requires a T4 login. The window needs ~13+ months so the walk-forward "
                  "has enough history. A run takes several minutes — progress is shown above."),
        )
        note.pack(fill="x", padx=16, pady=(2, 8))

        # Equity chart (embedded matplotlib).
        self.fig = Figure(figsize=(7.6, 3.0), dpi=100)
        self.ax = self.fig.add_subplot(111)
        self.ax.set_title("Equity — rotation (blue) vs equal-weight buy & hold (red)",
                          fontsize=9)
        self.fig.tight_layout()
        self.canvas = FigureCanvasTkAgg(self.fig, master=self)
        self.canvas.get_tk_widget().pack(fill="both", expand=False, padx=16)

        # Stats grid.
        self.stats_frame = tk.Frame(self, bg="white", padx=16, pady=8)
        self.stats_frame.pack(fill="x")

        # Re-tune log table.
        tk.Label(self, text='Re-tunes (the "rebuild")', bg="white",
                 font=("Arial", 11, "bold")).pack(anchor="w", padx=16)
        cols = ("date", "mom", "value_lb", "top_n", "objective", "switched")
        headers = ("Date", "Mom (lookback/skip)", "Value lb", "Top N", "Objective", "Switched")
        tree_wrap = tk.Frame(self)
        tree_wrap.pack(fill="both", expand=True, padx=16, pady=(2, 12))
        self.tree = ttk.Treeview(tree_wrap, columns=cols, show="headings", height=8)
        for c, h in zip(cols, headers):
            self.tree.heading(c, text=h)
            self.tree.column(c, width=120, anchor="center")
        vsb = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")

        self._apply_prefill()

    def _apply_prefill(self):
        """Prefill the From/To window: a recent default, overridable via the optional
        config 'portfolio_study' block ('start'/'end', or 'lookback_days').

        The walk-forward needs > warmup(252) + retune(10) daily bars, so the default
        spans ~18 months of calendar time to comfortably clear ~262 trading days.
        """
        cfg = {}
        try:
            cfg = (getattr(self.client, "config", None) or {}).get("portfolio_study", {}) or {}
        except Exception:  # noqa: BLE001 - prefill is best-effort
            cfg = {}
        try:
            lookback = int(cfg.get("lookback_days") or 550)
        except (TypeError, ValueError):
            lookback = 550
        today = _dt.date.today()
        start_default = (today - _dt.timedelta(days=lookback)).strftime("%Y-%m-%d")
        end_default = today.strftime("%Y-%m-%d")
        self.start.insert(0, str(cfg.get("start") or start_default))
        self.end.insert(0, str(cfg.get("end") or end_default))

    # -- run / worker ----------------------------------------------------------
    def _run(self):
        if self._running:
            return
        token = getattr(self.client, "jw_token", None)
        if not token:
            self._set_status("Connect/login to T4 first — the study runs on live "
                             "T4 futures data and needs a token.", error=True)
            return
        try:
            start = self._norm_date(self.start.get())
            end = self._norm_date(self.end.get())
        except ValueError:
            self._set_status("From/To must be dates in 'YYYY-MM-DD' format.", error=True)
            return
        opts = {
            "basket": "futures",
            "source": "t4",
            "client": self.client,
            "start": start,
            "end": end,
        }
        self._running = True
        self.run_btn.config(state="disabled")
        self._last_progress = ""
        self.progress.start(12)
        self._elapsed = 0
        self._refresh_running_status()
        self._elapsed_after = self.after(1000, self._tick_elapsed)
        threading.Thread(target=self._worker, args=(opts,), daemon=True).start()
        # Poll from the main (Tk) thread — after() is only safe to call here.
        self._poll_results()

    def _worker(self, opts):
        # Runs off the Tk thread: must not call any tkinter method (including
        # after()). Push the outcome onto the queue; the poller does the UI work.
        try:
            data = runner.run_study(
                on_line=lambda ln: self._result_q.put(("progress", ln)), **opts)
        except runner.StudyError as exc:
            self._result_q.put(("error", str(exc)))
            return
        except Exception as exc:  # noqa: BLE001 - never let the worker die silently
            self._result_q.put(("error", f"Unexpected error: {exc}"))
            return
        self._result_q.put(("render", data))

    def _poll_results(self):
        """Drain worker results on the Tk thread; reschedule until done.

        'progress' lines just update the status; 'error'/'render' are terminal.
        Drains everything currently queued each tick so progress stays current.
        """
        try:
            while True:
                kind, payload = self._result_q.get_nowait()
                if kind == "progress":
                    self._last_progress = payload
                    self._refresh_running_status()
                    continue
                if kind == "error":
                    self._on_error(payload)
                else:
                    self._render(payload)
                return  # terminal message handled — stop polling
        except queue.Empty:
            if self._running:
                self.after(100, self._poll_results)

    def _tick_elapsed(self):
        """Once-a-second elapsed counter while a run is in flight."""
        if not self._running:
            return
        self._elapsed += 1
        self._refresh_running_status()
        self._elapsed_after = self.after(1000, self._tick_elapsed)

    def _refresh_running_status(self):
        base = f"Running… {self._elapsed}s (several minutes)"
        self._set_status(f"{base} — {self._last_progress}" if self._last_progress else base)

    def _stop_progress(self):
        self._running = False
        try:
            self.progress.stop()
        except Exception:  # noqa: BLE001
            pass
        if self._elapsed_after is not None:
            try:
                self.after_cancel(self._elapsed_after)
            except Exception:  # noqa: BLE001
                pass
            self._elapsed_after = None

    def _on_error(self, msg):
        self._stop_progress()
        self.run_btn.config(state="normal")
        self._set_status(f"Failed: {msg}", error=True)

    # -- rendering -------------------------------------------------------------
    def _render(self, data):
        self._stop_progress()
        self.run_btn.config(state="normal")
        try:
            self._render_equity(data.get("equity", []), data.get("baseline_equity", []))
            self._render_stats(data)
            self._render_params(data.get("params_log", []))
            meta = data.get("meta", {}) or {}
            basket = ", ".join(meta.get("basket") or []) or "futures"
            self._set_status(f"Done — {basket} via {meta.get('source', 't4')} "
                             f"({meta.get('rows', '?')} bars, {meta.get('span', '')}).")
        except Exception as exc:  # noqa: BLE001
            self._set_status(f"Render failed: {exc}", error=True)

    def _render_equity(self, equity, baseline):
        self.ax.clear()
        self.ax.set_title("Equity — rotation (blue) vs equal-weight buy & hold (red)",
                          fontsize=9)
        if equity:
            xs = [_dt.datetime.utcfromtimestamp(p["time"]) for p in equity if p.get("value") is not None]
            ys = [p["value"] for p in equity if p.get("value") is not None]
            self.ax.plot(xs, ys, color="#2962ff", linewidth=1.5, label="rotation")
        if baseline:
            bxs = [_dt.datetime.utcfromtimestamp(p["time"]) for p in baseline if p.get("value") is not None]
            bys = [p["value"] for p in baseline if p.get("value") is not None]
            self.ax.plot(bxs, bys, color="#ff6b6b", linewidth=1.5, label="buy & hold")
        self.ax.legend(loc="upper left", fontsize=8)
        self.ax.grid(True, alpha=0.3)
        self.fig.autofmt_xdate()
        self.fig.tight_layout()
        self.canvas.draw()

    def _render_stats(self, data):
        for w in self.stats_frame.winfo_children():
            w.destroy()
        s = data.get("stats", {}) or {}
        cells = [
            ("Return", _fmt_pct(s.get("return_pct"))),
            ("vs Buy & Hold", _fmt_pct(data.get("baseline_return_pct"))),
            ("Sharpe", _fmt_num(s.get("sharpe"))),
            ("Max Drawdown", _fmt_pct(s.get("max_drawdown_pct"))),
            ("Trades / week", _fmt_num(s.get("trades_per_week"))),
            ("Re-tunes (switched/total)", f"{data.get('n_switched', 0)}/{data.get('n_retunes', 0)}"),
            ("Time in Market", _fmt_pct(s.get("time_in_market_pct"))),
            ("Net P&L", _fmt_money(s.get("net_pnl"))),
        ]
        for i, (label, value) in enumerate(cells):
            col = i % 4
            row = (i // 4) * 2
            tk.Label(self.stats_frame, text=label, bg="white", fg="#777",
                     font=("Arial", 9)).grid(row=row, column=col, sticky="w", padx=(0, 18))
            tk.Label(self.stats_frame, text=value, bg="white",
                     font=("Arial", 12, "bold")).grid(row=row + 1, column=col, sticky="w", padx=(0, 18))

    def _render_params(self, plog):
        self.tree.delete(*self.tree.get_children())
        # Newest first, matching the JS panel.
        for p in reversed(plog):
            self.tree.insert("", "end", values=(
                _iso_day(p.get("time")),
                f"{p.get('mom_lookback')}/{p.get('mom_skip')}",
                p.get("value_lookback"),
                p.get("top_n"),
                _fmt_num(p.get("objective")),
                "✓ switched" if p.get("switched") else "held",
            ))
        if not plog:
            self.tree.insert("", "end", values=("No re-tunes", "", "", "", "", ""))

    # -- misc ------------------------------------------------------------------
    @staticmethod
    def _norm_date(raw: str) -> str:
        """Validate a 'YYYY-MM-DD' date and return it normalized (the study uses
        daily bars, so no intraday component). Raises ValueError if malformed."""
        return _dt.datetime.strptime(raw.strip(), "%Y-%m-%d").strftime("%Y-%m-%d")

    def _set_status(self, text, error=False):
        self.status.config(text=text, fg="#c0392b" if error else "#555")
