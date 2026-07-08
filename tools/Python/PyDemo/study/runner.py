"""study/runner.py

Run the walk-forward portfolio rotation backtest by shelling out to the existing
``research.run_portfolio_study`` module (in the sibling ``algo-py`` package) with
its ``--json`` mode, then return the parsed result dict.

This mirrors JSDemo's ``server.js::handlePortfolioStudy`` — we reuse the tested
Python pipeline verbatim (fetch -> walk-forward re-tune -> multi-asset OOS
backtest -> JSON) rather than duplicating any of it. The subprocess keeps the
research package's heavy deps (numpy/pandas) isolated from PyDemo's interpreter
state and avoids any sys.path surgery.

The study runs on the live T4 **futures** basket (ES/NQ/YM/RTY) over a chosen date
window by default; the CSV/ETF path is still supported via ``source="csv"`` for the
research CLI but is no longer surfaced in PyDemo's study window.

``run_study`` is BLOCKING (a run takes several minutes — the walk-forward is
CPU-bound) — call it from a worker thread, never on the Tk/asyncio main thread.
"""

from __future__ import annotations

import collections
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Callable, Optional

from . import t4_fetch

# PyDemo/study/ -> PyDemo/ -> Python/ -> Python/algo-py
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ALGO_PY_DIR = os.path.normpath(os.path.join(_BASE_DIR, "..", "..", "algo-py"))


class StudyError(RuntimeError):
    """Raised when the study subprocess fails or returns no/invalid JSON."""


def default_csv_dir() -> str:
    """The research package's bundled CSV directory (spy.csv/qqq.csv/...)."""
    return os.path.join(ALGO_PY_DIR, "research", "data_csv")


def run_study(basket: str = "futures", source: str = "t4",
              csv_dir: str | None = None, token: str | None = None,
              client=None, start: str | None = None, end: str | None = None,
              timeout: float = 600.0,
              on_line: Optional[Callable[[str], None]] = None) -> dict:
    """Run the portfolio study and return its JSON result dict.

    For source='t4' the futures bars are fetched IN THIS PROCESS via
    ``study.t4_fetch`` (which reuses the chart's binary→JSON ChartHistory path),
    written to a temp dir of per-key CSVs, and handed to the study through its
    reliable ``--source csv`` path — so the subprocess never touches T4 directly.

    Args:
        basket: 'futures' (ES/NQ/YM/RTY, the default for the live T4 path) or
            'etf' (SPY/QQQ/DIA/IWM, CSV path).
        source: 't4' (live T4 daily bars, fetched in-process, the default) or
            'csv' (reads per-key OHLCV files; research CLI fallback).
        csv_dir: directory of per-key CSVs (csv source). Defaults to the research
            package's bundled data_csv dir.
        token: unused legacy arg (kept for back-compat); the t4 path uses `client`.
        client: the live T4APIClient — required for source='t4' (provides apiUrl,
            jw_token, config for the in-process fetch).
        start: fetch window start (YYYY-MM-DD). Forwarded as --start. When unset the
            research config default window is used.
        end: fetch window end (YYYY-MM-DD). Forwarded as --end.
        timeout: hard cap on the subprocess (seconds).
        on_line: optional callback invoked with each line the subprocess prints
            (the research scripts emit progress to stdout — '[portfolio] …'). The
            run is slow (several minutes), so this is how the UI shows it's alive.
            Called on the calling thread; keep it cheap and thread-safe.

    Returns:
        The dict written by research.result_json.to_result_dict (equity[],
        baseline_equity[], stats{}, params_log[], holdings{}, meta{}, config{}, ...).

    Raises:
        StudyError: on a non-zero exit, timeout, or unreadable/non-ok JSON.
    """
    if not os.path.isdir(ALGO_PY_DIR):
        raise StudyError(
            f"algo-py package not found at {ALGO_PY_DIR} — the research code must "
            "be a sibling of PyDemo for the study to run."
        )

    tmp_csv_dir = None
    try:
        # T4 source: fetch the futures bars in-process (the proven binary→JSON
        # ChartHistory path) into a temp dir of per-key CSVs, then run the study
        # over them via the reliable CSV path. The subprocess never touches T4.
        run_source, run_csv_dir = source, csv_dir
        keys: list[str] | None = None
        if source == "t4":
            if client is None:
                raise StudyError("Internal error: the T4 study needs a live client.")
            tmp_csv_dir = tempfile.mkdtemp(prefix="pydemo_study_t4_")
            try:
                fetched = t4_fetch.fetch_futures_csvs(client, start or "", end or "",
                                                      tmp_csv_dir, on_line=on_line)
            except t4_fetch.FetchError as exc:
                raise StudyError(str(exc)) from exc
            # Run on exactly the instruments that returned data (some may be dropped,
            # e.g. YM on a feed without the Dow), so the basket matches the CSVs.
            keys = [k for k, _ in fetched]
            run_source, run_csv_dir = "csv", tmp_csv_dir

        # Write the result to a temp file the subprocess owns, then read it back.
        fd, out_path = tempfile.mkstemp(prefix="pydemo_study_", suffix=".json")
        os.close(fd)

        argv = [
            sys.executable, "-m", "research.run_portfolio_study",
            "--json", out_path,
            "--source", run_source,
            "--basket", basket,
        ]
        if run_source == "csv":
            argv += ["--csv-dir", run_csv_dir or default_csv_dir()]
        if keys:
            argv += ["--keys", ",".join(keys)]
        if start:
            argv += ["--start", start]
        if end:
            argv += ["--end", end]

        return _run_json_subprocess(argv, out_path, timeout, env=None, on_line=on_line)
    finally:
        if tmp_csv_dir:
            shutil.rmtree(tmp_csv_dir, ignore_errors=True)


def _run_json_subprocess(argv: list[str], out_path: str, timeout: float,
                         env: dict | None = None,
                         on_line: Optional[Callable[[str], None]] = None) -> dict:
    """Run a research --json subprocess, read its temp-file result, return the dict.

    Streams the subprocess's combined stdout/stderr line by line so the UI can
    show progress (the research scripts print '[portfolio] …' steps and actionable
    errors — bad CSV dir, missing token, too few bars). We keep the tail of those
    lines to surface a meaningful message on failure.
    """
    # stderr -> stdout so a single reader sees everything in order; bufsize=1 +
    # text mode gives line-buffered reads.
    proc = subprocess.Popen(
        argv, cwd=ALGO_PY_DIR, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    tail = collections.deque(maxlen=20)
    deadline = time.monotonic() + timeout
    try:
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                tail.append(line)
                if on_line is not None:
                    try:
                        on_line(line)
                    except Exception:  # noqa: BLE001 - progress is best-effort
                        pass
            if time.monotonic() > deadline:
                proc.kill()
                _safe_unlink(out_path)
                raise StudyError(f"Run timed out after {timeout:.0f}s")
        returncode = proc.wait()
    finally:
        if proc.stdout:
            proc.stdout.close()

    if returncode != 0:
        _safe_unlink(out_path)
        msg = tail[-1] if tail else f"exit code {returncode}"
        raise StudyError(msg)

    try:
        with open(out_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise StudyError(f"Could not read run output: {exc}") from exc
    finally:
        _safe_unlink(out_path)

    if not isinstance(data, dict) or not data.get("ok"):
        raise StudyError(data.get("error", "Run returned no result")
                         if isinstance(data, dict) else "Run returned no result")
    return data


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
