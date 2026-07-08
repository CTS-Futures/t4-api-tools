"""
research/report.py

Render the study to disk: matplotlib PNGs + a Markdown report. Uses the non-
interactive Agg backend so it runs headless. All outputs land in an output dir
(default research/output/).
"""

from __future__ import annotations

import os
from typing import Optional

import matplotlib
matplotlib.use("Agg")  # headless; must precede pyplot import
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd

from . import config
from .backtest import BacktestResult


def _ensure(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)


def plot_price_positions(model_frame: pd.DataFrame, positions: pd.Series, out_dir: str) -> str:
    _ensure(out_dir)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, height_ratios=[3, 1])
    ax1.plot(model_frame.index, model_frame["es_close"], color="#1f77b4", lw=1.0, label="ES close")
    ax1.set_title("ES price & model positions (calibration span)")
    ax1.legend(loc="upper left"); ax1.grid(alpha=0.3)
    ax2.fill_between(positions.index, positions.values, step="pre", color="#ff7f0e", alpha=0.6)
    ax2.axhline(0, color="k", lw=0.6)
    ax2.set_ylabel("contracts"); ax2.grid(alpha=0.3)
    fig.autofmt_xdate()
    path = os.path.join(out_dir, "price_positions.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def plot_equity(result: BacktestResult, out_dir: str) -> str:
    _ensure(out_dir)
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(result.equity.index, result.equity.values, color="#2ca02c", lw=1.3, label="Combo model")
    ax.plot(result.buy_hold_equity.index, result.buy_hold_equity.values,
            color="#888", lw=1.0, ls="--", label="ES buy & hold (1 lot)")
    ax.set_title("Equity curve ($)"); ax.legend(loc="upper left"); ax.grid(alpha=0.3)
    fig.autofmt_xdate()
    path = os.path.join(out_dir, "equity.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def plot_war_zoom(model_frame: pd.DataFrame, positions: pd.Series, out_dir: str) -> str:
    """Event-window zoom: ES/CL/GC normalised to 100 at window start, with the
    risk-off shading and ES position underneath."""
    _ensure(out_dir)
    pad_start = (pd.Timestamp(config.EVENT_START) - pd.Timedelta(days=20))
    pad_end = (pd.Timestamp(config.EVENT_END) + pd.Timedelta(days=10))
    z = model_frame.loc[pad_start:pad_end]
    if z.empty:
        z = model_frame
    base = z.iloc[0]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True, height_ratios=[3, 1])
    for key, color in (("es_close", "#1f77b4"), ("cl_close", "#000000"), ("gc_close", "#d4af37")):
        ax1.plot(z.index, z[key] / base[key] * 100.0, color=color, lw=1.2, label=key.split("_")[0].upper())
    ax1.axvspan(pd.Timestamp(config.EVENT_START), pd.Timestamp(config.EVENT_END),
                color="red", alpha=0.08, label="war window")
    ax1.set_title("June 2025 war window — ES / oil / gold (normalised = 100 at start)")
    ax1.legend(loc="upper left"); ax1.grid(alpha=0.3)

    ax2.fill_between(z.index, z["risk_off"], step="pre", color="red", alpha=0.3, label="risk-off intensity")
    pos = positions.reindex(z.index).fillna(0.0)
    ax2b = ax2.twinx()
    ax2b.step(z.index, pos.values, where="pre", color="#ff7f0e", lw=1.2, label="ES position")
    ax2.set_ylabel("risk-off"); ax2b.set_ylabel("contracts")
    ax2.grid(alpha=0.3)
    ax2.legend(loc="upper left"); ax2b.legend(loc="upper right")
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    fig.autofmt_xdate()
    path = os.path.join(out_dir, "war_zoom.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def _fmt(v: float, pct: bool = False) -> str:
    if v == float("inf"):
        return "∞"
    return f"{v:,.2f}{'%' if pct else ''}"


def write_report(
    *,
    out_dir: str,
    full_stats: dict,
    event_stats: dict,
    calib_info: dict,
    data_summary: dict,
    images: list[str],
    resolution: str,
) -> str:
    """Write report.md tying the artifacts together with honest caveats."""
    _ensure(out_dir)
    img_md = "\n".join(f"![{os.path.basename(p)}]({os.path.basename(p)})" for p in images)

    def stats_table(s: dict) -> str:
        return (
            "| metric | value |\n|---|---|\n"
            f"| Net PnL | ${_fmt(s['net_pnl'])} |\n"
            f"| Return | {_fmt(s['return_pct'], pct=True)} |\n"
            f"| Sharpe (annualised) | {_fmt(s['sharpe'])} |\n"
            f"| Max drawdown | ${_fmt(s['max_drawdown'])} ({_fmt(s['max_drawdown_pct'], pct=True)}) |\n"
            f"| Trades | {s['n_trades']} |\n"
            f"| Hit rate | {_fmt(s['hit_rate'] * 100, pct=True)} |\n"
            f"| Profit factor | {_fmt(s['profit_factor'])} |\n"
            f"| Time in market | {_fmt(s['time_in_market_pct'], pct=True)} |\n"
        )

    md = f"""# ES combo-signal study — June 2025 US–Iran war

Momentum + mean-reversion on **ES**, with oil/gold **conditional weighting**,
evaluated through the June 2025 "12-Day War" ({config.EVENT_START} → {config.EVENT_END}).

## 1. Data
- Instruments: {data_summary.get('symbols')}
- Span fetched: {config.FETCH_START} → {config.FETCH_END}
- Resolution: **{resolution}**
- Bars: {data_summary.get('rows')} aligned rows

## 2. Regime calibration (prior year)
- Calibration span: {config.CALIB_START} → {config.CALIB_END} ({calib_info.get('calib_days')} days)
- Risk-off days flagged: {calib_info.get('risk_off_days')} ({_fmt(calib_info.get('risk_off_frac', 0) * 100, pct=True)})
- Mean risk-off intensity: {_fmt(calib_info.get('risk_off_mean_intensity', 0))}

## 3. Backtest — full span (calibration + event)
{stats_table(full_stats)}

## 4. War-window performance ({config.EVENT_START} → {config.EVENT_END})
{stats_table(event_stats)}

## 5. Charts
{img_md}

## 6. Caveats (read these)
- **Single event = case study, not validation.** A ~2-week war is one regime
  observation. These numbers illustrate behaviour; they are **not** statistically
  significant evidence the strategy "works".
- **Nothing was fit on the event window.** Indicator lookbacks and the regime
  trigger are calibrated on the prior year only; the event is held out.
- **Rules-based, not optimised.** Weights/thresholds are hand-set defaults
  (`config.py`), chosen for transparency, not tuned for returns.
- **Costs are modelled, not real fills.** Slippage/commission are approximations;
  gaps around the strikes would be worse in practice.
- **Resolution matters.** If only daily data was available, intraday dynamics of
  the strikes (Jun 21–22) are invisible here.
"""
    path = os.path.join(out_dir, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


# =============================================================================
# Portfolio rotation study (research/run_portfolio_study.py)
# =============================================================================
# Decoupled from multi_backtest's types on purpose — these take plain Series /
# DataFrames so report.py keeps depending only on pandas/matplotlib.

def plot_portfolio_equity(equity: pd.Series, baseline_equity: pd.Series, out_dir: str,
                          label: str = "Rotation (walk-forward, OOS)",
                          baseline_label: str = "Equal-weight buy & hold",
                          title: str = "Portfolio equity ($) — out-of-sample") -> str:
    """Out-of-sample portfolio equity vs the equal-weight buy-&-hold baseline."""
    _ensure(out_dir)
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(equity.index, equity.values, color="#2ca02c", lw=1.4, label=label)
    ax.plot(baseline_equity.index, baseline_equity.values, color="#888", lw=1.0, ls="--",
            label=baseline_label)
    ax.set_title(title); ax.legend(loc="upper left"); ax.grid(alpha=0.3)
    fig.autofmt_xdate()
    path = os.path.join(out_dir, "portfolio_equity.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def plot_param_drift(params_log: pd.DataFrame, out_dir: str) -> str:
    """Show how slowly the re-tuned parameters move — the 'rebuild' made visible.
    Vertical marks flag re-tunes where the parameter set actually switched."""
    _ensure(out_dir)
    fig, axes = plt.subplots(3, 1, figsize=(12, 8), sharex=True)
    if not params_log.empty:
        idx = params_log.index
        axes[0].step(idx, params_log["mom_lookback"], where="post", color="#1f77b4", label="mom_lookback")
        axes[0].step(idx, params_log["value_lookback"], where="post", color="#9467bd", label="value_lookback")
        axes[0].set_ylabel("bars"); axes[0].legend(loc="upper left"); axes[0].grid(alpha=0.3)
        axes[1].step(idx, params_log["mom_skip"], where="post", color="#ff7f0e", label="mom_skip")
        axes[1].set_ylabel("skip bars"); axes[1].legend(loc="upper left"); axes[1].grid(alpha=0.3)
        axes[2].step(idx, params_log["top_n"], where="post", color="#2ca02c", label="top_n")
        axes[2].set_ylabel("held names"); axes[2].legend(loc="upper left"); axes[2].grid(alpha=0.3)
        if "switched" in params_log.columns:
            for ts in params_log.index[params_log["switched"].astype(bool)]:
                for ax in axes:
                    ax.axvline(ts, color="red", alpha=0.25, lw=0.8)
    axes[0].set_title("Re-tuned parameters over time (red = parameter set switched)")
    fig.autofmt_xdate()
    path = os.path.join(out_dir, "param_drift.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def plot_holdings_heatmap(targets: pd.DataFrame, out_dir: str) -> str:
    """Heatmap of target weight per instrument over time (what's held when)."""
    _ensure(out_dir)
    fig, ax = plt.subplots(figsize=(12, 0.6 * len(targets.columns) + 2))
    mat = targets.T  # instruments x time
    im = ax.imshow(mat.values, aspect="auto", cmap="RdYlGn", vmin=-1.0, vmax=1.0,
                   interpolation="nearest")
    ax.set_yticks(range(len(mat.index))); ax.set_yticklabels([k.upper() for k in mat.index])
    n = len(targets.index)
    ticks = range(0, n, max(1, n // 10))
    ax.set_xticks(list(ticks))
    ax.set_xticklabels([targets.index[i].strftime("%Y-%m") for i in ticks], rotation=45, ha="right")
    ax.set_title("Holdings over time (target weight per instrument)")
    fig.colorbar(im, ax=ax, fraction=0.025, pad=0.01, label="target weight")
    path = os.path.join(out_dir, "holdings_heatmap.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


# =============================================================================
# Defensive trend-overlay study (research/run_overlay_study.py)
# =============================================================================

def write_overlay_report(
    *,
    out_dir: str,
    window: int,
    below: float,
    overlay_m: dict,
    buyhold_m: dict,
    data_summary: dict,
    images: list[str],
    resolution: str,
) -> str:
    """Write report.md for the trend-overlay-vs-buy&hold study. The goal here is
    risk-adjusted growth, so the table leads with drawdown / Sharpe, not win rate.
    Metrics come from the equity curves (scale-invariant), not starting-cash %."""
    _ensure(out_dir)
    img_md = "\n".join(f"![{os.path.basename(p)}]({os.path.basename(p)})" for p in images)
    below_desc = "to cash" if below == 0.0 else f"to {below:.0%} invested"

    def col(m):
        return (m['cagr'], m['sharpe'], m['max_dd_pct'], m['worst_week_pct'],
                m['pct_winning_weeks'], m['time_in_market_pct'])
    o = col(overlay_m)
    b = col(buyhold_m)

    md = f"""# Defensive trend overlay vs buy & hold — research backtest

A broad-equity core (**SPY**) with a **{window}-day moving-average trend filter**: hold
SPY while price is above its {window}-day SMA, otherwise step {below_desc}. This is the
most-replicated tactical rule (time-series momentum / Faber). The goal is **smoother
risk-adjusted growth** — cut the deep drawdowns — not to win every week.

## 1. Data
- Core: SPY ({resolution})
- Bars: {data_summary.get('rows')} rows ({data_summary.get('span')})

## 2. Results — overlay vs buy & hold
| metric | trend overlay | buy & hold |
|---|---|---|
| CAGR | {_fmt(o[0], pct=True)} | {_fmt(b[0], pct=True)} |
| Sharpe (annualised) | {_fmt(o[1])} | {_fmt(b[1])} |
| **Max drawdown** | {_fmt(o[2], pct=True)} | {_fmt(b[2], pct=True)} |
| Worst week | {_fmt(o[3], pct=True)} | {_fmt(b[3], pct=True)} |
| % winning weeks | {_fmt(o[4], pct=True)} | {_fmt(b[4], pct=True)} |
| Time in market | {_fmt(o[5], pct=True)} | {_fmt(b[5], pct=True)} |

## 3. Chart
{img_md}

## 4. Read
The overlay's edge is **risk reduction**: it sidesteps the worst of sustained
downtrends (price below its long MA), so max drawdown shrinks and Sharpe rises,
typically for a CAGR within a point or two of buy & hold. It does **not** raise the
weekly win rate — it just makes the bad stretches shallower.

## 5. Caveats (read these)
- **Whipsaws in choppy/flat markets.** When price oscillates around the MA, the
  overlay sells low and buys back higher repeatedly — a drag in range-bound years.
- **It lags the turn.** A {window}-day MA reacts slowly; you give back some gains
  before exiting and re-enter after the bottom.
- **Taxes & fills not modelled.** Frequent in/out is tax-inefficient in a taxable
  account; costs here are approximations.
- **Backtest only.** One core asset, one rule, one history — illustrative of the
  drawdown-reduction effect, not a guarantee.
"""
    path = os.path.join(out_dir, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


# =============================================================================
# Market-neutral pairs study (research/run_pairs_study.py)
# =============================================================================

def plot_spread_zscore(wide, pair, z, params, out_dir: str) -> str:
    """Per-pair chart: the two legs normalised to 100 at the OOS start, plus the
    spread z-score with entry/exit bands and shading where a position is open."""
    _ensure(out_dir)
    a = wide[f"{pair.a}_close"]
    b = wide[f"{pair.b}_close"]
    oos = z.loc[params.calib_end:].dropna()
    if len(oos) < 2:
        oos = z.dropna()
    start = oos.index[0]
    az = a.loc[start:]
    bz = b.loc[start:]
    zz = z.loc[start:]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, height_ratios=[2, 1.4])
    ax1.plot(az.index, az / az.iloc[0] * 100.0, color="#1f77b4", lw=1.1, label=pair.a.upper())
    ax1.plot(bz.index, bz / bz.iloc[0] * 100.0, color="#ff7f0e", lw=1.1, label=pair.b.upper())
    ax1.set_title(f"{pair.a.upper()} vs {pair.b.upper()}  (β={pair.beta:.2f}, coint p={pair.pvalue:.3f}) "
                  f"— normalised = 100 at OOS start")
    ax1.legend(loc="upper left"); ax1.grid(alpha=0.3); ax1.set_ylabel("price (=100)")

    ax2.plot(zz.index, zz.values, color="#2ca02c", lw=1.0, label="spread z-score")
    for lvl, c in ((params.entry_z, "red"), (-params.entry_z, "red"),
                   (params.exit_z, "#888"), (-params.exit_z, "#888"),
                   (params.stop_z, "#7a0000"), (-params.stop_z, "#7a0000")):
        ax2.axhline(lvl, color=c, lw=0.8, ls="--", alpha=0.7)
    ax2.axhline(0, color="k", lw=0.6)
    # shade where |z| is beyond the entry band (a position is open / opening)
    ax2.fill_between(zz.index, -params.entry_z, params.entry_z, color="#cccccc", alpha=0.25)
    ax2.set_ylabel("z"); ax2.grid(alpha=0.3); ax2.legend(loc="upper left")
    fig.autofmt_xdate()
    path = os.path.join(out_dir, f"spread_{pair.a}_{pair.b}.png")
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    return path


def _weekly_table(label_strat: str, strat: dict, base: dict) -> str:
    """Two-column weekly-consistency table (strategy vs a reference)."""
    def row(name, key, pct=False, suffix=""):
        sv = _fmt(strat.get(key, 0.0), pct=pct)
        bv = _fmt(base.get(key, 0.0), pct=pct)
        return f"| {name} | {sv}{suffix} | {bv}{suffix} |\n"
    return (
        f"| weekly metric | {label_strat} | buy & hold |\n|---|---|---|\n"
        + f"| Active weeks | {strat.get('n_active_weeks')}/{strat.get('n_weeks')} "
          f"| {base.get('n_active_weeks')}/{base.get('n_weeks')} |\n"
        + row("% winning weeks", "pct_winning_weeks", pct=True)
        + row("Avg week", "avg_week_pct", pct=True)
        + row("Avg WIN week", "avg_win_week_pct", pct=True)
        + row("Avg LOSS week", "avg_loss_week_pct", pct=True)
        + row("Win/loss size ratio", "win_loss_ratio")
        + row("Best week", "best_week_pct", pct=True)
        + row("Worst week", "worst_week_pct", pct=True)
        + f"| Longest losing streak | {strat.get('max_losing_streak_weeks')}w "
          f"| {base.get('max_losing_streak_weeks')}w |\n"
        + row("Weekly Sharpe", "weekly_sharpe")
    )


def write_pairs_report(
    *,
    out_dir: str,
    stats: dict,
    baseline_return_pct: float,
    strat_weekly: dict,
    base_weekly: dict,
    spy_corr: float,
    pairs: list,
    data_summary: dict,
    images: list[str],
    params,
    resolution: str,
) -> str:
    """Write report.md for the market-neutral pairs study."""
    _ensure(out_dir)
    img_md = "\n".join(f"![{os.path.basename(p)}]({os.path.basename(p)})" for p in images)
    pairs_md = "| pair | hedge β | coint p-value | in-sample corr |\n|---|---|---|---|\n" + "".join(
        f"| {p.a.upper()}–{p.b.upper()} | {p.beta:.2f} | {p.pvalue:.3f} | {p.corr:.2f} |\n"
        for p in pairs
    )

    md = f"""# Market-neutral cross-sector pairs — research backtest

Long the laggard leg, short the leader leg, bet the **spread reverts**. Pairs are
chosen on the calibration window by **return correlation + Engle-Granger
cointegration** (so only statistically mean-reverting spreads are traded), then
the rolling spread z-score is traded **out-of-sample**. Each pair is dollar-neutral
(≈ ${params.dollar_per_leg:,.0f} per leg), so the book carries little market direction.

## 1. Data
- Universe: {data_summary.get('n_universe')} instruments (stocks + sector ETFs)
- Resolution: **{resolution}**
- Bars: {data_summary.get('rows')} aligned rows ({data_summary.get('span')})
- Selection window (in-sample): start → {params.calib_end}; everything after is OOS.

## 2. Selected pairs (disjoint, top {params.top_pairs} by cointegration)
{pairs_md}

## 3. Signal
- Spread = log(A) − β·log(B); rolling z over **{params.z_lookback}** bars.
- Enter at **|z| > {params.entry_z}**, flatten at **|z| < {params.exit_z}** (hysteresis).
- **Divergence stop at |z| > {params.stop_z}**: bail if the spread blows out (de-cohering)
  and stay out until it normalises — caps the fat-tail loss weeks.

## 4. Out-of-sample results
| metric | value |
|---|---|
| Net PnL | ${_fmt(stats['net_pnl'])} |
| Return | {_fmt(stats['return_pct'], pct=True)} |
| Long-basket buy & hold (ref) | {_fmt(baseline_return_pct, pct=True)} |
| Sharpe (annualised) | {_fmt(stats['sharpe'])} |
| Max drawdown | ${_fmt(stats['max_drawdown'])} ({_fmt(stats['max_drawdown_pct'], pct=True)}) |
| Trades | {stats['n_trades']} |
| **Trades / week** | {_fmt(stats['trades_per_week'])} |
| Hit rate | {_fmt(stats['hit_rate'] * 100, pct=True)} |
| Profit factor | {_fmt(stats['profit_factor'])} |
| Time in market | {_fmt(stats['time_in_market_pct'], pct=True)} |
| **Weekly-return corr to SPY** | {_fmt(spy_corr)} |

## 5. Weekly consistency (the goal: win most weeks)
{_weekly_table("pairs", strat_weekly, base_weekly)}

A **weekly-return correlation to SPY near 0** ({_fmt(spy_corr)}) is the point:
profits come from spreads reverting, not from the market rising.

## 6. Charts
{img_md}

## 7. Caveats (read these)
- **Mean-reversion has fat-tail risk.** A high win rate is paid for with the
  occasional sharp loss week when a spread keeps diverging (a leg re-rates, gets
  acquired, or a sector breaks). Watch the **worst week** and **longest losing
  streak** above — not just the win rate.
- **Cointegration is in-sample.** A pair stationary over the calibration window
  can de-cohere out-of-sample; this is the dominant failure mode of stat-arb.
- **Costs are modelled.** Shares assume cheap commission and ~1bp slippage;
  shorting also incurs borrow costs not modelled here.
- **Dollar-neutral ≈ not perfectly market/beta-neutral.** Legs are balanced by
  notional at entry, not by live beta; residual market exposure remains.
- **Backtest only.** No live wiring; shorting + borrow handling is a later phase.
"""
    path = os.path.join(out_dir, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


def write_portfolio_report(
    *,
    out_dir: str,
    stats: dict,
    baseline_return_pct: float,
    params_log: pd.DataFrame,
    data_summary: dict,
    images: list[str],
    cfg,
    resolution: str,
) -> str:
    """Write report.md for the slow-rebuild rotation study."""
    _ensure(out_dir)
    img_md = "\n".join(f"![{os.path.basename(p)}]({os.path.basename(p)})" for p in images)
    sw = int(params_log["switched"].astype(bool).sum()) if (len(params_log) and "switched" in params_log) else 0
    n_retunes = int(len(params_log))

    md = f"""# Slow-rebuild momentum/value rotation — research backtest

A low-frequency rotation across a basket of equity-index "stock trackers".
Each name is scored on **skip-recent momentum** + **value (mean-reversion)**,
guarded by an **overextension** filter and a **long-term trend** gate, ranked
cross-sectionally, and the top-N held. Parameters are **re-tuned on a trailing
window every ~{cfg.walk.retune_days} bars** (the "rebuild") and held steady
unless a new set clearly beats the incumbent — so the book turns over slowly and
doesn't chase the freshest spike.

## 1. Data
- Basket: {data_summary.get('symbols')}
- Resolution: **{resolution}**
- Bars: {data_summary.get('rows')} aligned rows ({data_summary.get('span')})

## 2. Configuration
- Signals: momentum (lookback {cfg.signals.mom_lookback}, skip {cfg.signals.mom_skip}),
  value (lookback {cfg.signals.value_lookback}), overext z>{cfg.signals.overext_z},
  trend SMA {cfg.signals.trend_lookback}
- Portfolio: top {cfg.portfolio.top_n}, {cfg.portfolio.weighting}-weight,
  shorts={cfg.portfolio.allow_short}, ≤{cfg.portfolio.max_trades_per_week} trades/rebalance,
  no-trade band {cfg.portfolio.no_trade_band}
- Walk-forward: warmup {cfg.walk.warmup}, trailing {cfg.walk.trailing_window},
  rebalance {cfg.walk.rebalance_days}d, re-tune {cfg.walk.retune_days}d,
  hysteresis {cfg.walk.hysteresis}
- Re-tunes: {n_retunes} ({sw} actually switched parameters — the rest kept the incumbent)

## 3. Out-of-sample results
| metric | value |
|---|---|
| Net PnL | ${_fmt(stats['net_pnl'])} |
| Return | {_fmt(stats['return_pct'], pct=True)} |
| Equal-weight buy & hold | {_fmt(baseline_return_pct, pct=True)} |
| Sharpe (annualised) | {_fmt(stats['sharpe'])} |
| Max drawdown | ${_fmt(stats['max_drawdown'])} ({_fmt(stats['max_drawdown_pct'], pct=True)}) |
| Trades | {stats['n_trades']} |
| **Trades / week** | {_fmt(stats['trades_per_week'])} |
| Avg turnover / rebalance | {_fmt(stats['avg_turnover'])} |
| Hit rate | {_fmt(stats['hit_rate'] * 100, pct=True)} |
| Profit factor | {_fmt(stats['profit_factor'])} |
| Time in market | {_fmt(stats['time_in_market_pct'], pct=True)} |

## 4. Charts
{img_md}

## 5. Caveats (read these)
- **Walk-forward, not look-ahead-free of bias entirely.** Parameters are chosen
  on trailing data only (no look-ahead), but the grid, objective and guard
  thresholds are design choices — treat results as a research signal, not proof.
- **'Value' ≠ fundamentals.** With futures/ETF prices only, value means price vs
  its own long-run mean (z-score), not valuation multiples.
- **Costs are modelled, not real fills.** Per-symbol commission/slippage are
  approximations; thin/after-hours fills would be worse.
- **Basket is small.** A handful of correlated equity indices is a narrow
  cross-section; momentum rotation is strongest over broader universes.
- **Backtest only.** No live wiring — porting to a live JS Strategy behind
  RiskManager is a separate, later phase.
"""
    path = os.path.join(out_dir, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path
