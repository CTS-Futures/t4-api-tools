"""Runtime patches to the bundled ``lightweight-charts`` library.

These run in the *parent* process (where the chart command strings are built),
so unlike the webview message-pump loop they actually take effect.

Currently one patch: make ``js_data`` emit COMPACT JSON. The stock implementation
(`lightweight_charts/util.py`) serialises every ``setData`` payload with
``json.dumps(..., indent=2)``. For a large/scroll-grown candle set that pretty-
printing inflates the embedded script to multiple MB, which WebView2 renders only
partially ("half-loaded" candles). Dropping the indent shrinks the payload ~40%
and is what makes large initial loads and infinite scroll-back render reliably.

``abstract.py`` does ``from .util import js_data``, so it holds its own name
binding — we patch BOTH module attributes. Idempotent and defensive: a future
library version that changes ``js_data`` simply isn't patched (no crash).
"""

from __future__ import annotations

import json
import logging

import pandas as pd

log = logging.getLogger("pydemo.chart.lwc_patches")

_applied = False


def _compact_js_data(data):
    """Compact (no-indent) drop-in for ``lightweight_charts.util.js_data``.

    Mirrors the stock record shaping (drop None/NaN cells for DataFrames; pass
    Series through) but serialises without ``indent=2``.
    """
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
        filtered = [
            {k: v for k, v in record.items() if v is not None and not pd.isna(v)}
            for record in records
        ]
    else:
        filtered = dict(data.to_dict())
    return json.dumps(filtered)


def apply_patches() -> None:
    """Install the compact-``js_data`` patch on every lightweight-charts module
    that imported it. Safe to call more than once."""
    global _applied
    if _applied:
        return
    try:
        from lightweight_charts import util as _util
        patched_any = False
        if hasattr(_util, "js_data"):
            _util.js_data = _compact_js_data
            patched_any = True
        # abstract.py did `from .util import js_data`, so it has its own binding.
        try:
            from lightweight_charts import abstract as _abstract
            if hasattr(_abstract, "js_data"):
                _abstract.js_data = _compact_js_data
                patched_any = True
        except Exception:  # noqa: BLE001 - abstract layout may differ
            pass
        _applied = patched_any
        if patched_any:
            log.debug("chart: applied compact js_data patch")
    except Exception:  # noqa: BLE001 - never let a patch failure break the chart
        log.exception("chart: failed to apply lightweight-charts patches")
