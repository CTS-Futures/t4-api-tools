# Research findings — "a strategy that profits most weeks and wins"

A record of what we tested, on **real market data**, in pursuit of a strategy with a high
**weekly win rate**, and where it led. Short version up front, evidence below.

## TL;DR

- **Nothing we built beats simply holding the market on weekly win rate.** A broad equity
  index is green in **~57% of weeks** for free. None of the added machinery (rotation,
  market-neutral pairs, divergence stops, scaling to 80 names) raised that — most lowered it
  or lost money.
- **"Profit every week and win" is not a real target.** Anything that appears to do it is
  hiding tail risk. The honest target is *a high fraction of winning weeks with a bounded
  worst week* — and on liquid US equities that bar is set by buy & hold itself.
- **Cross-sector pairs trading failed out-of-sample.** Historical cointegration is largely
  spurious; the relationships break in the live window. Scaling to more pairs made it *worse*,
  not better (shared selection bias, not independent bets).
- **The one defensible edge we found is risk reduction, not weekly income:** a simple
  **trend overlay** (hold SPY above its 200-day average, else go to cash) cut max drawdown by
  roughly a third and raised Sharpe, for ~2 points less CAGR. It does **not** win more weeks —
  it makes the bad stretches shallower.

## Data & method

- **Source:** real daily OHLCV from Yahoo Finance (`research/data.py:fetch_yahoo_*`), adjusted.
  The original `data_csv/*.csv` were **synthetic** (e.g. SPY ≈ $300 in 2021 vs the real ~$368) —
  all results here are on genuine data, cached to `data_csv/`.
- **Discipline:** parameters/pairs are selected in-sample and evaluated **out-of-sample** (never
  fit on the evaluation window).
- **Weekly lens:** `multi_backtest.weekly_consistency()` measures % of *active* weeks that win,
  average win vs loss week, worst week, and longest losing streak. (An early version counted
  flat warm-up / out-of-market weeks as losses — producing a fake "57-week losing streak"; fixed
  to judge active weeks only.)

## Results across everything tested

| Strategy | Window | Return / CAGR | % winning weeks | Worst week | Max DD | SPY corr |
|---|---|---|---|---|---|---|
| **Buy & hold (the benchmark)** | — | reference | **~57%** | −14.6% | −33.7% | 1.0 |
| Momentum/value rotation (full invest) | 2018–25 | +9.2% | 59.3%¹ | — | small² | high |
| Cross-sector pairs (4) | 2022–25 | −7.1% | 44.4% | −2.1% | −10.1% | 0.04 |
| Cross-sector pairs (4) + divergence stop | 2022–25 | −5.4% | 46.1% | −2.1% | −8.9% | 0.06 |
| Large universe pairs (15) + stop | 2022–25 | −8.7% | 47.0% | −2.5% | −11.2% | −0.11 |
| Tethered pair V–MA + stop | 2022–25 | +2.0% | 54.5% | −0.35% | −1.4% | 0.08 |
| **Trend overlay (SPY, 200-day)** | 2018–25 | +12.3% CAGR | 46.0%³ | −12.0% | **−22.6%** | ~1.0 |

¹ Rotation's ~59% is essentially the market's own weekly cadence — it *is* equity beta.
² Rotation drawdown looks tiny only because it deploys little capital (gross_target ≈ 1.0).
³ Overlay wins *fewer* weeks than buy & hold because it sits in cash ~31% of the time; its win
  rate among invested weeks is market-like. Its value is the drawdown column, not this one.
(Pair win-rates are over *active* weeks; pair returns are over the 2022–25 OOS window.)

## Why the pairs idea failed (the interesting part)

The thesis — instruments that look unrelated (fast food / tech / commerce) but co-move under
macro shifts — is appealing, and the cointegration filter *did* surface exactly those pairs
(GOOGL–UNH, CMG–WMT, MSFT–JNJ, WMT–V…). But out-of-sample they **lost money**, for a structural
reason:

- **In-sample cointegration is mostly spurious.** Ranking thousands of pairs and keeping the few
  with the lowest historical p-value selects *statistical flukes*, not durable economic links.
- **Cross-sector pairs have no economic tether,** so nothing pulls a diverged spread back. The
  clearest example: **GOOGL–UNH** tracked tightly through 2024, then UnitedHealth collapsed
  (~120→60 in 2025) while Google held — the spread blew out past z = 4 and never reverted. Being
  short that spread just bled.
- **Scaling made it worse.** 15 pairs lost more than 4, because the bets weren't independent —
  they shared one hidden common cause (selection on a spurious fit) and failed together. The
  divergence stop trimmed the bleed but never turned it positive.
- **What *did* hold up was the lone same-sector pair, V–MA** (two card networks with a real
  economic link): +2%, market-neutral, −0.35% worst week. Robust pairs need a tether — which
  usually means they *do* look correlated on the surface, the opposite of the original idea.

## The defensible pivot: risk-adjusted growth, not weekly wins

`research/run_overlay_study.py` — SPY held while above its 200-day SMA, otherwise to cash
(time-series momentum / Faber, the most-replicated tactical rule). Over 2018–2025 on real SPY:

| metric | trend overlay | buy & hold |
|---|---|---|
| CAGR | +12.3% | +14.3% |
| Sharpe | **0.88** | 0.76 |
| Max drawdown | **−22.6%** | −33.7% |
| Worst week | −12.0% | −14.6% |
| Time in market | 68.8% | 100% |

It trades ~2 points of CAGR for a **one-third cut in max drawdown** and a higher Sharpe — by
sitting out sustained downtrends (flat in cash through 2022 and near the 2020 bottom). This is a
genuine, well-documented edge — but it is **risk reduction**, not a weekly-income engine; it
wins fewer weeks, just loses less in the bad ones. Caveats: whipsaws in choppy markets, lags the
turn, tax-inefficient, and is one rule on one asset over one history.

## How to reproduce

From `tools/Python/algo-py/` (`pip install -r requirements.txt` first):

```bash
# Trend overlay (the defensible result)
python -m research.run_overlay_study --source csv --sma 200      # SPY is cached
python -m research.run_overlay_study --source yahoo --sma 200 --below 0.5

# Market-neutral pairs (the negative result)
python -m research.run_pairs_study --source yahoo --cache-csv --calib-end 2021-12-31   # ~24-name universe
python -m research.run_pairs_study --source csv --universe large --top-pairs 15        # 80-name universe
python -m research.run_pairs_study --source csv --min-corr 0.7                          # tethered (V–MA)

# Rotation + weekly lens
python -m research.run_portfolio_study --source csv --gross-target 2.0 --max-contracts 100
```

Each writes a `report.md` + charts under its own `research/output_*/` directory.

## Bottom line

If the goal is *winning most weeks*, the answer is **buy and hold a broad index** — ~57% of weeks
green, zero machinery, hard to beat. If the goal is *a smoother ride for similar growth*, add a
**trend overlay** to cut the deep drawdowns. The complexity we explored (rotation, pairs,
shorts, stops, scale) did not add a weekly-consistency edge on liquid US equities — and the
investigation is more valuable for ruling those out cleanly than any of them would have been if
we'd shipped it on faith.
