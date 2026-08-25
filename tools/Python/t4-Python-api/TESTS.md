# Running the tests

This project ships two tiers of tests:

| Tier            | What it covers                                                    | Network? | Marker        |
| --------------- | ------------------------------------------------------------------ | -------- | ------------- |
| **Unit**        | Pure-Python logic, binary decoder, JSON shaping, mocked HTTP calls | No       | _(none)_      |
| **Integration** | Live hits against the T4 sim API (`api-sim.t4login.com/chart`)     | Yes      | `integration` |

By default `pytest` only runs the **unit** tier — `pyproject.toml` configures
`addopts = -m 'not integration'` so a vanilla `pytest` command never touches
the network or requires credentials.

---

## One-time setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

> All commands below assume the venv is activated.

---

## Unit tests (default)

Run the whole unit suite:

```powershell
pytest
```

Common variants:

```powershell
pytest -q                                 # quiet output
pytest tests/client                       # one folder
pytest tests/client/test_chart_client.py  # one file
pytest -k "barchart"                      # name filter
pytest -x --pdb                           # stop on first failure, drop into debugger
```

These tests use [`pytest-httpx`](https://pypi.org/project/pytest-httpx/) to
stub every HTTP call, so they are deterministic and offline.

---

## Integration tests (opt-in)

The integration tests live in
[tests/client/test_chart_client_integration.py](tests/client/test_chart_client_integration.py)
and are gated behind the `integration` marker. They require a valid bearer
token for the T4 sim environment.

### Provide a token

Either pass it on the command line:

```powershell
pytest -m integration --token=YOUR_BEARER_TOKEN
```

…or export it as an environment variable (preferred for repeat runs and CI):

```powershell
$env:T4_API_TOKEN = "YOUR_BEARER_TOKEN"
pytest -m integration
```

If neither is supplied, the `api_token` fixture in
[tests/client/conftest.py](tests/client/conftest.py) calls `pytest.skip(...)`
so the integration tests are skipped rather than failing.

### Run a single integration test

```powershell
pytest -m integration tests/client/test_chart_client_integration.py::TestBarchartIntegration::test_binary_response_decodes_bars
```

### Run both tiers in one invocation

```powershell
pytest -m "integration or not integration"
```

---

## Lint and type-check

The same `dev` extra installs `ruff` and `mypy`:

```powershell
ruff check src tests
mypy --strict src
```

---

## Regenerating binary test fixtures

The golden fixtures used by `tests/definitions/chartdata/` are:

| File | Purpose |
|------|---------|
| `tests/fixtures/sample_expected.csv` | Checked-in golden CSV — expected decoded output |
| `tests/fixtures/sample.bin` | _(not checked in)_ — binary payload used to generate the CSV |

If you change the binary decoder (e.g. add new tags or fix parsing), regenerate the golden CSV by running:

```powershell
python tests/fixtures/generate_fixtures.py
```

This writes a fresh `sample_expected.csv` in place.  Commit the updated CSV so the next `pytest` run compares against the new expected values.

> **Note:** `generate_fixtures.py` is **not** run automatically by pytest — it is a manual utility to be re-run only after intentional decoder changes.

---

## Where things live

```
tests/
  client/
    conftest.py                          # --token option, `client` fixture, CollectingHandler
    test_chart_client.py                 # unit tests (offline, pytest-httpx)
    test_chart_client_integration.py     # live API tests (marker: integration)
  ...                                    # mirror of src/t4login/ layout
```
