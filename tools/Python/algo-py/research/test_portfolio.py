"""
research/test_portfolio.py

Synthetic-data verification for the slow-rebuild rotation study — no market data
or T4 needed. Run directly:

    python -m research.test_portfolio

Checks:
  1. NO LOOK-AHEAD — perturbing FUTURE prices cannot change any earlier signal
     score or walk-forward target.
  2. RECONCILIATION — portfolio equity delta equals summed per-bar PnL.
  3. TRADE THROTTLE — no rebalance changes more than max_trades_per_week names,
     and sub-band tweaks are ignored.
  4. GUARDS — the overextension and long-term-trend gates disqualify the names
     they should.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from . import config, multi_backtest, portfolio as pf, signals as sig, walkforward


# Small, fast config so lookbacks fit a synthetic series.
TEST_CFG = replace(
    config.DEFAULT,
    signals=replace(config.DEFAULT.signals, mom_lookback=10, mom_skip=2,
                    value_lookback=20, trend_lookback=15, overext_z=2.0),
    portfolio=replace(config.DEFAULT.portfolio, top_n=2, max_trades_per_week=2,
                      no_trade_band=0.1),
    walk=replace(config.DEFAULT.walk, warmup=30, trailing_window=40,
                 rebalance_days=5, retune_days=5,
                 grid_mom_lookback=(5, 10), grid_mom_skip=(0, 2),
                 grid_value_lookback=(20,), grid_top_n=(1, 2)),
)

KEYS = ["a", "b", "c", "d"]


def _make_closes(n: int = 160, seed: int = 7) -> dict[str, pd.Series]:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2022-01-03", periods=n)
    out = {}
    for i, k in enumerate(KEYS):
        drift = 0.0004 * (i - 1)            # mix of up/down trends
        steps = rng.normal(drift, 0.01, n)
        out[k] = pd.Series(100.0 * np.exp(np.cumsum(steps)), index=idx)
    return out


def test_no_lookahead_scores() -> None:
    closes = _make_closes()
    p = TEST_CFG.signals
    base = pf.composite_scores(closes, p)

    n = len(base.index)
    cut = int(0.7 * n)
    perturbed = {k: v.copy() for k, v in closes.items()}
    perturbed["a"].iloc[cut:] *= 1.8        # blow up the FUTURE
    after = pf.composite_scores(perturbed, p)

    a, b = base.iloc[:cut], after.iloc[:cut]
    assert a.equals(b) or np.allclose(a.fillna(-999).values, b.fillna(-999).values), \
        "look-ahead: future price change altered earlier composite scores"
    print("  [1a] composite_scores is causal (no look-ahead) - OK")


def test_no_lookahead_walkforward() -> None:
    closes = _make_closes()
    base = walkforward.run_walkforward(closes, TEST_CFG).targets

    n = len(base.index)
    cut = int(0.7 * n)
    perturbed = {k: v.copy() for k, v in closes.items()}
    perturbed["a"].iloc[cut:] *= 1.8
    after = walkforward.run_walkforward(perturbed, TEST_CFG).targets

    a, b = base.iloc[:cut], after.iloc[:cut]
    assert np.allclose(a.values, b.values), \
        "look-ahead: future price change altered earlier walk-forward targets"
    print("  [1b] walk-forward targets are causal (no look-ahead) - OK")


def test_reconciliation() -> None:
    closes = _make_closes()
    wf = walkforward.run_walkforward(closes, TEST_CFG)
    res = multi_backtest.backtest_portfolio(wf.targets, closes, TEST_CFG)
    start = TEST_CFG.costs.starting_cash
    assert abs((res.equity.iloc[-1] - start) - res.pnl.sum()) < 1e-6, \
        "portfolio equity does not reconcile with summed PnL"
    print(f"  [2] equity reconciles (net ${res.pnl.sum():,.0f}, "
          f"{res.stats['trades_per_week']:.2f} trades/wk) - OK")


def test_trade_throttle() -> None:
    cap = TEST_CFG.portfolio.max_trades_per_week
    closes = _make_closes()
    targets = walkforward.run_walkforward(closes, TEST_CFG).targets
    changes = (targets.diff().abs() > 1e-9).sum(axis=1)
    assert changes.max() <= cap, f"a rebalance changed {changes.max()} names (cap {cap})"

    # Direct unit checks on the throttle.
    keys = pd.Index(KEYS)
    prev = pd.Series([0.0, 0.0, 0.0, 0.0], index=keys)
    desired = pd.Series([0.25, 0.25, 0.25, 0.25], index=keys)  # 4 would-be changes
    out = pf._throttle(prev, desired, TEST_CFG.portfolio)
    assert int((out != prev).sum()) <= cap, "throttle exceeded the per-rebalance trade cap"

    prev2 = pd.Series([0.5, 0.5, 0.0, 0.0], index=keys)
    tweak = pd.Series([0.55, 0.5, 0.0, 0.0], index=keys)       # 0.05 < no_trade_band
    out2 = pf._throttle(prev2, tweak, TEST_CFG.portfolio)
    assert out2.equals(prev2), "throttle traded inside the no-trade band"
    print(f"  [3] trade throttle holds (<={cap}/rebalance, no-trade band) - OK")


def test_guards() -> None:
    idx = pd.bdate_range("2022-01-03", periods=60)
    # normal: gentle uptrend (eligible). overext: flat then a huge spike at the
    # end (z ≫ overext_z). downtrend: monotone decline (below its SMA).
    normal = pd.Series(100.0 * (1 + 0.002) ** np.arange(60), index=idx)
    overext = pd.Series(100.0, index=idx).copy()
    overext.iloc[-3:] = [180.0, 220.0, 260.0]
    downtrend = pd.Series(100.0 * (1 - 0.01) ** np.arange(60), index=idx)
    flat = pd.Series(100.0 + np.sin(np.arange(60) / 3.0), index=idx)

    p = replace(TEST_CFG.signals, value_lookback=20, trend_lookback=15, overext_z=2.0)
    scores = pf.composite_scores(
        {"normal": normal, "overext": overext, "down": downtrend, "flat": flat}, p)
    last = scores.iloc[-1]
    assert pd.isna(last["overext"]), "overextension guard failed to drop the spiking name"
    assert pd.isna(last["down"]), "trend gate failed to drop the down-trending name"
    assert last[["normal", "flat"]].notna().any(), "guards disqualified every name"

    # Sanity on the raw component.
    assert sig.trend_ok(downtrend, 15).iloc[-1] == False  # noqa: E712
    assert sig.overextension(overext, 20).iloc[-1] > 2.0
    print("  [4] overextension + trend guards drop the right names - OK")


def main() -> int:
    print("[test_portfolio] synthetic verification")
    test_no_lookahead_scores()
    test_no_lookahead_walkforward()
    test_reconciliation()
    test_trade_throttle()
    test_guards()
    print("[test_portfolio] ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
