"""backtest/param_form.py

Tk port of ``algo/ui/ParamForm.js`` — render a strategy's PARAMS schema into
form inputs and read them back, so the Backtester window stays generic: a new
strategy that declares its own params just works, no panel edits.

``build_param_inputs`` returns a dict of ``{key: Entry}`` widgets packed into the
given parent; ``read_param_inputs`` coerces them by declared type and clamps to
min/max, falling back to the schema default when blank or unparseable.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk


def build_param_inputs(parent, schema) -> dict:
    """Create a labelled entry per schema item; return {key: Entry}. Clears the
    parent first (safe to call on strategy re-select)."""
    for w in parent.winfo_children():
        w.destroy()
    widgets = {}
    for i, p in enumerate(schema or []):
        row = i // 2
        col = (i % 2) * 2
        label = tk.Label(parent, text=f"{p['label']}:", bg="white")
        label.grid(row=row, column=col, sticky="w", padx=(0, 4), pady=2)
        ent = tk.Entry(parent, width=8)
        ent.insert(0, str(p["default"]))
        ent.grid(row=row, column=col + 1, sticky="w", padx=(0, 16), pady=2)
        widgets[p["key"]] = ent
    return widgets


def read_param_inputs(widgets: dict, schema) -> dict:
    """Read the inputs back into a params dict, coercing by declared type and
    clamping to min/max; falls back to the schema default when blank/unparseable."""
    out = {}
    for p in (schema or []):
        ent = widgets.get(p["key"])
        raw = ent.get().strip() if ent is not None else ""
        try:
            v = int(raw) if p["type"] == "int" else float(raw)
        except (TypeError, ValueError):
            v = p["default"]
        if p.get("min") is not None and v < p["min"]:
            v = p["min"]
        if p.get("max") is not None and v > p["max"]:
            v = p["max"]
        out[p["key"]] = v
    return out
