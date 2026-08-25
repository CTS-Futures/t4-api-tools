"""backtest/portfolio.py

Position + PnL accounting for the backtester — a faithful port of
``algo/Portfolio.js``. Tracks net position, average entry, realized PnL (net of
commission), an equity curve sampled per bar, and a trade blotter. PnL is in
money via ``point_value`` (the contract's $ per price point); leave it 1 for PnL
in points.

Sign convention: net > 0 = long, net < 0 = short. side is +1 (buy) / -1 (sell).
"""

from __future__ import annotations

import math


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


class Portfolio:
    def __init__(self, point_value: float = 1, commission: float = 0,
                 starting_cash: float = 100000) -> None:
        self.point_value = point_value
        self.commission = commission       # per contract, per fill
        self.starting_cash = starting_cash

        self.net = 0
        self.avg_price = None
        self.realized = 0.0                # includes commission costs
        self.trades = []                   # {time, side, qty, price, pnl, commission, ...}
        self.equity_curve = []             # {time, value}
        self._last_close = None

    def apply_fill(self, side: int, qty: float, price: float, time_sec) -> None:
        """Apply an execution. Handles opening, adding, reducing, closing, and
        flipping in one path."""
        qty = abs(qty)
        if not qty or not math.isfinite(price):
            return
        signed = qty if side >= 0 else -qty
        pnl = 0.0
        closed_qty = 0          # contracts this fill closed (0 for pure opens/adds)
        entry_avg = None        # avg entry price of the closed contracts

        if self.net == 0 or _sign(self.net) == _sign(signed):
            # Opening or adding to the position -> recompute weighted avg.
            abs_net = abs(self.net)
            self.avg_price = (price if self.avg_price is None
                              else (self.avg_price * abs_net + price * qty) / (abs_net + qty))
            self.net += signed
        else:
            # Reducing, closing, or flipping.
            closing = min(qty, abs(self.net))
            entry_avg = self.avg_price      # capture entry BEFORE it's mutated
            closed_qty = closing
            pnl = (price - self.avg_price) * closing * _sign(self.net) * self.point_value
            self.realized += pnl
            remaining = qty - closing       # > 0 means we flipped sides
            self.net += signed
            if self.net == 0:
                self.avg_price = None
            elif remaining > 0:
                self.avg_price = price      # new position at fill price
            # partial reduce leaves avg_price unchanged

        commission_cost = self.commission * qty
        self.realized -= commission_cost
        self.trades.append({
            "time": time_sec,
            "side": 1 if signed > 0 else -1,
            "qty": qty,
            "price": price,
            "pnl": pnl,                 # gross realized from this fill (0 when opening/adding)
            "commission": commission_cost,
            # A "closing" fill reduced/closed a position, so it completes a trade.
            # Identified by closed_qty (not pnl != 0) so scratch trades still count.
            "closing": closed_qty > 0,
            "closed_qty": closed_qty,
            "entry_price": entry_avg,
        })

    def unrealized(self, price) -> float:
        if self.net == 0 or self.avg_price is None or price is None or not math.isfinite(price):
            return 0.0
        return (price - self.avg_price) * self.net * self.point_value

    def mark_equity(self, time_sec, price) -> None:
        """Record equity (cash + realized + open MTM) at a bar close."""
        self._last_close = price
        value = self.starting_cash + self.realized + self.unrealized(price)
        self.equity_curve.append({"time": time_sec, "value": value})

    def force_close(self, price, time_sec) -> None:
        """Force-close any open position at ``price`` (end of a run)."""
        if self.net == 0:
            return
        self.apply_fill(-1 if self.net > 0 else 1, abs(self.net), price, time_sec)

    def stats(self, interval_ms=None) -> dict:
        """Summary statistics. ``interval_ms`` (optional) annualizes the Sharpe
        ratio under an approximate continuous-trading assumption."""
        eq = self.equity_curve
        final_equity = eq[-1]["value"] if eq else self.starting_cash
        net_profit = self.realized
        total_return_pct = (net_profit / self.starting_cash * 100) if self.starting_cash else None

        # Max drawdown (peak-to-trough on the equity curve).
        peak = -math.inf
        max_dd = 0.0
        max_dd_pct = 0.0
        for p in eq:
            if p["value"] > peak:
                peak = p["value"]
            dd = peak - p["value"]
            if dd > max_dd:
                max_dd = dd
                max_dd_pct = (dd / abs(peak) * 100) if peak else 0.0

        # Closed trades = fills that reduced/closed a position (keyed on
        # 'closing', not pnl != 0, so scratch trades still count).
        closed = [t for t in self.trades if t["closing"]]
        wins = [t for t in closed if t["pnl"] > 0]
        losses = [t for t in closed if t["pnl"] < 0]
        gross_win = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))

        # Per-bar returns -> (approx annualized) Sharpe.
        rets = []
        for i in range(1, len(eq)):
            prev = eq[i - 1]["value"]
            if prev:
                rets.append((eq[i]["value"] - prev) / abs(prev))
        mean = sum(rets) / len(rets) if rets else 0.0
        variance = sum((r - mean) ** 2 for r in rets) / len(rets) if rets else 0.0
        std = math.sqrt(variance)
        sharpe = (mean / std) if std else 0.0
        if interval_ms and std:
            bars_per_year = (365 * 24 * 3600 * 1000) / interval_ms
            sharpe *= math.sqrt(bars_per_year)

        if gross_loss:
            profit_factor = gross_win / gross_loss
        else:
            profit_factor = math.inf if gross_win else None

        return {
            "finalEquity": final_equity,
            "netProfit": net_profit,
            "totalReturnPct": total_return_pct,
            "maxDrawdown": max_dd,
            "maxDrawdownPct": max_dd_pct,
            "numFills": len(self.trades),
            "numTrades": len(closed),
            "wins": len(wins),
            "losses": len(losses),
            "winRatePct": (len(wins) / len(closed) * 100) if closed else None,
            "profitFactor": profit_factor,
            "sharpe": sharpe,
            "sharpeAnnualized": bool(interval_ms),
        }
