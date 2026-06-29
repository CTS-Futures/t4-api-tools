# Drop your data here

Put one CSV per instrument in this folder:

| File | Instrument |
|------|------------|
| `es.csv` | E-mini S&P 500 (ES) |
| `cl.csv` | Crude oil / WTI (CL) |
| `gc.csv` | Gold (GC) |

Then run from `algo-py/`:

```bash
python -m research.run_study           # --source csv is the default
```

## Format

Headers are matched **case-insensitively**, so both a Yahoo Finance export and a
generic OHLCV file work without editing:

```
Date,Open,High,Low,Close,Adj Close,Volume      <- Yahoo style
2024-06-03,5283.5,5290.0,5275.25,5288.75,5288.75,1250000
...
```

```
date,open,high,low,close,volume                <- generic
2024-06-03,5283.5,5290.0,5275.25,5288.75,1250000
...
```

Rules the loader applies (`research/data.py:load_csv_symbol`):
- A date column is **required** — any of `date / datetime / time / timestamp`.
- A close is **required** — any of `close / adj close / last / price / c`.
- `open / high / low` are optional; if missing they fall back to `close`
  (a close-only series still runs).
- `volume` is optional (defaults to 0).
- Daily bars expected; the study slices the calibration year and the war window
  by date from whatever range the files contain.

To cover the full study, each file should span roughly **2024-06-01 → 2025-06-30**
(≈1 year of calibration + the June-2025 war window). Less is fine — the report
just narrows to what overlaps across all three instruments.

> These CSVs are gitignored (see `algo-py/.gitignore`) — they're your data, not
> committed to the repo.
