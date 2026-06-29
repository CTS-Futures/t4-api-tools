# algo-py — ES combo-signal research/backtest study (June 2025 US–Iran war)

An **offline research/backtest** deliverable (no live trading). It
decodes T4 binary chart history, computes **momentum + mean-reversion** signals
on **ES**, applies a **rules-based conditional weighting driven by oil (CL) and
gold (GC)**, and analyzes the combined model through the June 2025 "12-Day War"
(≈Jun 13 → Jun 25). Output: charts + a Markdown report in `research/output/`.

The model only *decides* on ES; weights shift toward mean-reversion and trim
exposure when oil and gold spike together (the geopolitical-stress tell). It is
**calibrated on the ~1 year before** the war and **evaluated** on the war window —
nothing is fit on the event itself (a ~2-week event is one observation; tuning on
it would overfit). All knobs live in `research/config.py`.

## Setup

```bash
cd algo-py                              # tools/Python/algo-py
pip install -r requirements.txt
pip install -e ../t4-Python-api   # sibling package; provides the `t4login` chart client
```

## Run — CSV source (default)

CSV is the default, token-free source — convenient for offline iteration. Drop
one OHLCV file per instrument into `research/data_csv/` (`es.csv`, `cl.csv`,
`gc.csv` — see that folder's README for the format), then:

```bash
python -m research.run_study                       # --source csv is the default
python -m research.run_study --csv-dir /some/dir   # files elsewhere
```

Output → `research/output/` (`report.md` + PNGs).

## T4 source (live data)

The conversion repo has no login flow, so you supply a bearer token from an
authenticated T4 session, then run the probe gate:

```bash
export T4_API_TOKEN=...           # PowerShell: $env:T4_API_TOKEN = "..."
python -m research.probe_data     # GO / NO-GO coverage check
python -m research.run_study --source t4            # daily
python -m research.run_study --source t4 --intraday # minute (if retained)
```

The barchart calls fetch **volume-continuation** bars
(`continuationType=Volume` — the only value the endpoint supports; `marketID`
is omitted, which is valid with a continuation type). Equity-index futures use
the `CME_Eq` exchange id (with `CME_E`/`CME` as ordered fallbacks). If a symbol
comes back NO-GO from the probe, adjust its `exchange_candidates` in
`config.SYMBOLS` to the spelling the probe table reports.

> From the JSDemo UI you don't need the manual `export`: the **Portfolio Study**
> panel forwards the browser's live JWT to the server, which sets `T4_API_TOKEN`
> for the spawned study process — just Connect, pick **Source: T4**, and Run.

## research/ layout

| File | Purpose |
|------|---------|
| `config.py` | All knobs: dates, instruments, indicator/regime params, ES cost model. |
| `probe_data.py` | **Step 0** auth/symbol/retention/resolution check → GO/NO-GO. |
| `data.py` | Fetch + binary-decode ES/CL/GC via `ChartClient`; align to a common index. |
| `indicators.py` | Pure indicators: ROC, RSI, MACD, MA-slope, z-score. |
| `model.py` | Rules-based combo: oil/gold regime → conditional weights → ES target. |
| `backtest.py` | Vectorized backtest (1-bar-lag, costs) → equity, trades, stats. |
| `report.py` | matplotlib charts + Markdown report with caveats. |
| `run_study.py` | Orchestrates fetch → model → backtest → report. |

## Caveats (also written into every report)

Single event = illustrative **case study, not statistical validation**; nothing
fit on the window; weights are transparent defaults, not optimised; costs are
modelled approximations; daily-only data hides intraday strike dynamics.
