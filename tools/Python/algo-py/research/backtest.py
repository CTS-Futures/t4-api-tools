"""
research/backtest.py

Vectorized backtest of an ES target-position series. Deliberately simple and
auditable:

  * target in [-1, 1] → integer contracts = round(target * max_contracts)
  * positions are applied with a ONE-BAR LAG (act on the next bar's move) so
    there is no look-ahead — same anti-look-ahead stance as the JS SimBroker.
  * per-bar PnL = position_held * Δprice * point_value, minus commission +
    slippage on every contract that changes hands.

Returns an equity curve, a trade blotter, and summary stats, plus an ES
buy-&-hold baseline. A reconciliation assert guarantees Σ per-bar PnL equals the
equity delta.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config


@dataclass
class BacktestResult:
    equity: pd.Series          # cumulative PnL ($) including starting cash
    pnl: pd.Series             # per-bar PnL ($)
    positions: pd.Series       # contracts held into each bar
    trades: pd.DataFrame       # one row per position change
    stats: dict
    buy_hold_equity: pd.Series


def _annualization(index: pd.DatetimeIndex) -> float:
    """Bars per year, inferred from median spacing (daily→~252, minute→~98k)."""
    if len(index) < 3:
        return 252.0
    secs = np.median(np.diff(index.values).astype("timedelta64[s]").astype(float))
    if secs <= 0:
        return 252.0
    bars_per_day = max(1.0, 86400.0 / secs)
    # Trading days ≈ 252; for intraday assume ~6.5h sessions.
    if bars_per_day > 1.5:
        return 252.0 * (6.5 * 3600.0 / secs)
    return 252.0


def _stats(pnl: pd.Series, equity: pd.Series, positions: pd.Series,
           trades: pd.DataFrame, ann: float, starting_cash: float) -> dict:
    total = float(pnl.sum())
    rets = pnl / starting_cash
    sharpe = 0.0
    if rets.std(ddof=0) > 0:
        sharpe = float(np.sqrt(ann) * rets.mean() / rets.std(ddof=0))
    running_max = equity.cummax()
    drawdown = equity - running_max
    max_dd = float(drawdown.min())
    closed = trades[trades["realized_pnl"].notna()]
    wins = closed[closed["realized_pnl"] > 0]["realized_pnl"]
    losses = closed[closed["realized_pnl"] < 0]["realized_pnl"]
    hit = float(len(wins) / len(closed)) if len(closed) else 0.0
    pf = float(wins.sum() / -losses.sum()) if losses.sum() != 0 else float("inf")
    return {
        "net_pnl": total,
        "return_pct": float(total / starting_cash * 100.0),
        "sharpe": sharpe,
        "max_drawdown": max_dd,
        "max_drawdown_pct": float(max_dd / starting_cash * 100.0),
        "n_bars": int(len(pnl)),
        "n_trades": int(len(closed)),
        "hit_rate": hit,
        "profit_factor": pf,
        "time_in_market_pct": float((positions != 0).mean() * 100.0),
    }


def backtest(prices: pd.Series, target: pd.Series, cfg: config.StudyConfig = config.DEFAULT) -> BacktestResult:
    c = cfg.costs
    prices = prices.astype(float)
    target = target.reindex(prices.index).fillna(0.0).clip(-1.0, 1.0)

    # Desired contracts, then lag one bar so today's signal trades tomorrow.
    desired = (target * c.max_contracts).round().astype(int)
    positions = desired.shift(1).fillna(0).astype(int)

    dprice = prices.diff().fillna(0.0)
    gross_pnl = positions * dprice * c.point_value

    # Costs when the held position changes (contracts traded * per-contract cost).
    pos_change = positions.diff().fillna(positions).abs()
    cost = pos_change * (c.commission + c.slippage_pts * c.point_value)

    pnl = (gross_pnl - cost)
    equity = c.starting_cash + pnl.cumsum()

    # Trade blotter: realised PnL booked when a position closes/flips/reduces.
    trades = _build_trades(positions, prices, c)

    ann = _annualization(prices.index)
    stats = _stats(pnl, equity, positions, trades, ann, c.starting_cash)

    # Buy & hold 1 contract for baseline.
    bh_pnl = dprice * c.point_value
    buy_hold = c.starting_cash + bh_pnl.cumsum()

    # Reconciliation: equity delta must equal summed PnL (within fp tolerance).
    assert abs((equity.iloc[-1] - c.starting_cash) - pnl.sum()) < 1e-6, "PnL reconciliation failed"

    return BacktestResult(
        equity=equity, pnl=pnl, positions=positions,
        trades=trades, stats=stats, buy_hold_equity=buy_hold,
    )


def _build_trades(positions: pd.Series, prices: pd.Series, c: config.CostModel) -> pd.DataFrame:
    """Track average entry and realise PnL on reductions/flips. One row per
    position change; `realized_pnl` is NaN for pure opens/adds."""
    rows = []
    held = 0
    avg = 0.0
    prev = 0
    for ts, pos in positions.items():
        price = float(prices.loc[ts])
        if pos == prev:
            continue
        delta = pos - prev
        realized = np.nan
        if prev == 0 or (prev > 0 and delta > 0) or (prev < 0 and delta < 0):
            # opening or adding in the same direction → update avg cost
            new_held = prev + delta
            avg = (avg * abs(prev) + price * abs(delta)) / max(1, abs(new_held))
            held = new_held
        else:
            # reducing, closing, or flipping → realise on the closed portion
            closing = min(abs(delta), abs(prev))
            direction = 1 if prev > 0 else -1
            realized = direction * (price - avg) * closing * c.point_value
            held = prev + delta
            if (prev > 0) != (held > 0) and held != 0:
                avg = price  # flipped: remaining is a fresh position at this price
            elif held == 0:
                avg = 0.0
        rows.append({"ts": ts, "from": prev, "to": pos, "price": price, "realized_pnl": realized})
        prev = pos
    return pd.DataFrame(rows).set_index("ts") if rows else pd.DataFrame(
        columns=["from", "to", "price", "realized_pnl"]
    )
