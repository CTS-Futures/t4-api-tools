"""Toolbox drawings with per-symbol persistence.

Thin manager around the library's built-in toolbox (``Chart(toolbox=True)``),
which provides trendline / ray / box / vertical-line tools and a per-drawing
right-click menu natively. We add:

* per-symbol save/load - drawings are keyed by the contract symbol via a topbar
  textbox widget, so each contract keeps its own drawings;
* cross-session persistence - drawings are imported from / exported to a JSON
  file on disk.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("pydemo.chart.drawings")


class Drawings:
    def __init__(self, chart, symbol_widget, persist_path: str | None = None) -> None:
        self._chart = chart
        self._widget = symbol_widget
        self._path = persist_path
        self._tag = None

        toolbox = getattr(chart, "toolbox", None)
        if toolbox is None:
            log.warning("chart has no toolbox; drawings disabled")
            self._toolbox = None
            return
        self._toolbox = toolbox
        if self._path and os.path.exists(self._path):
            try:
                toolbox.import_drawings(self._path)
            except Exception:  # noqa: BLE001
                log.exception("failed to import drawings from %s", self._path)
        toolbox.save_drawings_under(symbol_widget)

    def set_symbol(self, symbol: str) -> None:
        """Switch the active drawing set to ``symbol`` (persist the previous)."""
        if self._toolbox is None or not symbol:
            return
        # Persist whatever was drawn under the previous tag before switching.
        self._export()
        self._tag = symbol
        try:
            self._widget.set(symbol)
            self._toolbox.load_drawings(symbol)
        except Exception:  # noqa: BLE001
            log.exception("failed to load drawings for %s", symbol)

    def _export(self) -> None:
        if self._toolbox is None or not self._path:
            return
        try:
            self._toolbox.export_drawings(self._path)
        except Exception:  # noqa: BLE001
            log.exception("failed to export drawings to %s", self._path)
