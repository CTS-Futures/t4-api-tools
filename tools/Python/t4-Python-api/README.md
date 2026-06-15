# t4-pythonConversion-api

Python port of the `t4login` Java API. Phase 1 ports the
`com.t4login.definitions.chartdata` package and the minimum shims it depends on
(`NDateTime`, `BidOffer`, `MarketMode`, `Price`, `VPT`, `IMarketConversion`).

## Layout

```
src/t4login/
  datetime_/         # NDateTime shim (stdlib `datetime` is reserved)
  definitions/
    priceconversion/ # Price / VPT / IMarketConversion shims
    chartdata/       # ported package
tests/                # mirrors src layout
```

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

## Checks (per-file gating)

```powershell
ruff check src tests
mypy --strict src
pytest -q
```

See [TESTS.md](TESTS.md) for full details on running unit and integration
tests (including how to supply a bearer token for the live API).
