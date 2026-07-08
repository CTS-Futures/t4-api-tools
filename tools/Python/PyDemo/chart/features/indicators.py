"""SMA / EMA / VWAP indicator overlays.

Pure math (``sma``/``ema``/``vwap``) is separated from the chart-bound
``Indicators`` feature so it can be unit-tested. Indicators are drawn as
additional line series via ``chart.create_line``; the full series is set on
history load and the latest point is updated as bars close.
"""

from __future__ import annotations

import logging
from typing import Optional

import pandas as pd

log = logging.getLogger("pydemo.chart.indicators")


# --- pure math ---------------------------------------------------------------

def sma(close: pd.Series, period: int) -> pd.Series:
    return close.rolling(period).mean()


def ema(close: pd.Series, period: int) -> pd.Series:
    return close.ewm(span=period, adjust=False).mean()


def vwap(df: pd.DataFrame, day_reset: bool = True) -> pd.Series:
    """Volume-weighted average price; resets each UTC day by default."""
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = typical * df["volume"]
    vol = df["volume"]
    if day_reset and not df.empty:
        day = pd.to_datetime(df["time"]).dt.normalize()
        cum_pv = pv.groupby(day).cumsum()
        cum_v = vol.groupby(day).cumsum()
    else:
        cum_pv = pv.cumsum()
        cum_v = vol.cumsum()
    return cum_pv / cum_v.where(cum_v != 0)


def compute(df: pd.DataFrame, kind: str, period: Optional[int]) -> pd.Series:
    if kind == "sma":
        return sma(df["close"], period or 20)
    if kind == "ema":
        return ema(df["close"], period or 50)
    if kind == "vwap":
        return vwap(df)
    raise ValueError(f"unknown indicator kind: {kind}")


# --- feature -----------------------------------------------------------------

# (key, display name, kind, period, color)
DEFAULT_SPECS = [
    ("sma20", "SMA 20", "sma", 20, "#f0b90b"),
    ("ema50", "EMA 50", "ema", 50, "#2196f3"),
    ("vwap", "VWAP", "vwap", None, "#ab47bc"),
]


class Indicators:
    def __init__(self, chart, specs=None) -> None:
        self._chart = chart
        self._specs = specs or DEFAULT_SPECS
        self._spec_by_key = {s[0]: s for s in self._specs}
        self._lines: dict[str, object] = {}
        # _visible is the single source of truth: an indicator is on the chart
        # iff it's visible. Default off; the context-menu toggle turns them on.
        self._visible: dict[str, bool] = {s[0]: False for s in self._specs}
        self._df: Optional[pd.DataFrame] = None
        self._last_bar: Optional[dict] = None

    def _build_line(self, key: str, name: str, kind: str, period, color: str) -> None:
        """Create a fresh line series for one indicator and set its full series
        from the current df. Caller guarantees df is present and the key is
        meant to be visible."""
        try:
            values = compute(self._df, kind, period)
            ldf = pd.DataFrame({"time": self._df["time"], name: values}).dropna()
            line = self._chart.create_line(name=name, color=color, width=1,
                                           price_line=False, price_label=False)
            line.set(ldf)
            self._lines[key] = line
        except Exception:  # noqa: BLE001
            log.exception("indicator %s build failed", key)

    def _delete_all(self) -> None:
        """Remove every indicator line series from the chart.

        Unlike toolbox drawings (OrderLines' horizontal_line), ``create_line``
        series are NOT wiped by ``chart.set()`` — so we must delete them
        explicitly or they linger and overlap freshly-built lines.
        """
        for line in self._lines.values():
            try:
                line.delete()
            except Exception:  # noqa: BLE001
                pass
        self._lines.clear()

    def recompute(self, df: pd.DataFrame) -> None:
        """Rebuild indicator series from freshly-loaded history.

        ``chart.set()`` does NOT delete ``create_line`` series (it only resets
        the candle data), so we delete the old indicator lines ourselves before
        recreating ONLY the indicators that are currently visible. A toggled-off
        indicator is simply never recreated, so "off" persists across switches.
        """
        self._df = df.copy() if df is not None else None
        self._last_bar = None
        self._delete_all()  # create_line series survive chart.set(); kill them
        if self._df is None or self._df.empty:
            return
        for key, name, kind, period, color in self._specs:
            if not self._visible.get(key, True):
                continue
            self._build_line(key, name, kind, period, color)

    def on_bar(self, bar: dict) -> None:
        """Advance indicators when a bar closes (one recompute per new bar)."""
        if self._df is None:
            return
        ts = pd.Timestamp(bar["time"]).tz_localize(None)
        prev = self._last_bar
        self._last_bar = {**bar, "time": ts}

        if prev is None or pd.Timestamp(prev["time"]).tz_localize(None) == ts:
            # First bar seen, or still the same forming bar — wait for close.
            return

        # A new bar started: commit the previous (now-closed) bar and update.
        self._df = pd.concat([self._df, pd.DataFrame([prev])], ignore_index=True)
        sec = pd.to_datetime(self._df["time"]).astype("int64") // 10 ** 9
        self._df = self._df[~sec.duplicated(keep="last")].reset_index(drop=True)

        committed_time = pd.Timestamp(prev["time"]).tz_localize(None)
        for key, name, kind, period, color in self._specs:
            # Only update lines that exist (i.e. visible ones); skip toggled-off.
            line = self._lines.get(key)
            if line is None or not self._visible.get(key, True):
                continue
            try:
                values = compute(self._df, kind, period)
                last = values.iloc[-1]
                if pd.notna(last):
                    line.update(pd.Series({"time": committed_time, name: float(last)}))
            except Exception:  # noqa: BLE001
                log.exception("indicator %s update failed", key)

    # -- toggle API (wired to the chart context menu) -------------------------
    def is_visible(self, key: str) -> bool:
        return bool(self._visible.get(key, True))

    def specs_for_menu(self) -> list[dict]:
        """[{key, label}] for building the context-menu toggle items."""
        return [{"key": k, "label": name} for (k, name, _kind, _p, _c) in self._specs]

    def set_visible(self, key: str, visible: bool) -> None:
        """Live toggle (no reload). Builds the line on demand when turned on and
        hides it when turned off; recompute() then honors the state on the next
        history load / interval switch."""
        self._visible[key] = visible
        line = self._lines.get(key)
        if visible:
            if line is None:
                if self._df is not None and not self._df.empty:
                    spec = self._spec_by_key.get(key)
                    if spec:
                        self._build_line(*spec)
            else:
                try:
                    line.show_data()
                except Exception:  # noqa: BLE001
                    pass
        elif line is not None:
            try:
                line.hide_data()
            except Exception:  # noqa: BLE001
                pass
