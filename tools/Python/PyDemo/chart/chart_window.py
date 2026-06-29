"""Companion lightweight-charts window: candles + volume + live ticks + overlays.

Phase 1: live candlesticks + volume for the subscribed contract, topbar interval
switcher, up-front history load. Phase 2 adds native overlays driven by account
updates: working-order lines (draggable to revise), a net-position / average-fill
line, fill markers, SMA/EMA/VWAP indicators, and toolbox drawings with per-symbol
persistence. The window runs in its own process via ``show_async`` on the app loop.

Wiring (done in ``main.py``):
    cw = ChartWindow(client, loop)
    client.on_market_update = cw.on_market_update      # live ticks + market switch
    client.on_account_update = cw.on_account_update    # orders / positions / fills
    asyncio.ensure_future(cw.run())                    # opens the window

The chart pulls historical bars itself through :class:`chart.history.ChartHistory`
(run in a thread executor so the synchronous HTTP call never blocks the loop).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd
from lightweight_charts import Chart

from . import _lwc_patches
from .aggregator import CandleAggregator, TickStore
from .bridge import CallbackBridge
from .convert import parse_trade_string
from .history import ChartHistory
from .features.order_lines import OrderLines
from .features.position_line import PositionLine
from .features.fill_markers import FillMarkers
from .features.indicators import Indicators
from .features.drawings import Drawings
from .features.order_tools import OrderTools

log = logging.getLogger("pydemo.chart.window")

# Shrink setData payloads (compact JSON) so large initial loads and scroll-grown
# history render fully instead of partially. Applied at import (parent process).
_lwc_patches.apply_patches()

# Interval switcher: label -> seconds.
_INTERVALS: list[tuple[str, int]] = [("15s", 15), ("1m", 60), ("5m", 300), ("15m", 900)]
_LABEL_TO_SEC = dict(_INTERVALS)
_SEC_TO_LABEL = {s: l for l, s in _INTERVALS}

# Injected once, post-load. lightweight-charts' Line.delete() (used by our
# indicator overlays) runs `legend.div.removeChild(legendItem.row)` — but the
# legend row is actually a child of a nested `seriesContainer`, NOT `legend.div`
# (bundle.js builds it with `seriesContainer.appendChild(row)`). So removeChild
# is called on the WRONG parent: natively it throws `NotFoundError`, which
# surfaces in the webview message-pump thread (chart.py loop), gets RE-RAISED,
# and kills the pump — freezing the chart wherever it was left.
#
# We can't patch that loop (it runs in the webview subprocess), so we fix it at
# the source in the page: redirect removeChild to the node's REAL parent. This
# (1) never throws, so the pump survives, and (2) actually detaches the legend
# row, so stale SMA/EMA/VWAP entries don't pile up on every reload. The normal
# case (node is a direct child) is unchanged.
_DOM_GUARD_JS = r"""
(function () {
  if (window.__pydemoDomGuard) return;
  window.__pydemoDomGuard = true;
  var orig = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child == null) return child;
    var p = child.parentNode;
    if (p == null) return child;                 // already detached: no-op, don't throw
    if (p !== this) return p.removeChild(child);  // wrong parent: detach from the real one
    return orig.call(this, child);                // normal path
  };
})();
"""


def lookback_days(interval_seconds: int, target_bars: int,
                  initial_load_days: int, max_load_days: int) -> int:
    """How many days of history to request so each interval loads a comparable
    bar count. The T4 endpoint takes a date range (not a bar count), so we derive
    the span from the interval: a fixed window made higher intervals look
    truncated (e.g. ~184 bars at 15m vs ~2880 at 1m over the same 2 days).
    Targets ``target_bars`` using a conservative ~23h trading day (futures run
    nearly 24h), floored at ``initial_load_days`` and clamped to ``max_load_days``.
    """
    import math
    target = max(1, target_bars)
    if interval_seconds >= 86400:        # daily+ -> calendar days ~= bars
        days = target
    else:
        seconds_per_trading_day = 23 * 3600
        days = math.ceil(target * interval_seconds / seconds_per_trading_day)
    days = max(initial_load_days, days)
    return min(days, max_load_days)


def scroll_buffer_bars(interval_seconds: int, scroll_buffer_days: float,
                       floor: int = 20) -> int:
    """How many loaded bars to keep off the left edge before prefetching older
    history. Scales with the interval so the look-ahead is a consistent span of
    time at every zoom (JSDemo parity: ``max(20, ceil(bars_per_day *
    SCROLL_BUFFER_DAYS))``, ``SCROLL_BUFFER_DAYS = 1``). Once fewer than this many
    bars remain to the left of the viewport, the loader pulls the next chunk so
    bars are already there by the time the user scrolls to them."""
    import math
    bars_per_day = 86400 / max(1, interval_seconds)
    return max(floor, math.ceil(bars_per_day * max(0.0, scroll_buffer_days)))


def _fmt_range_ts(dt: datetime) -> str:
    """Format a datetime as the T4 barchart range string (``YYYY-MM-DDThh:mm:ss``)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def older_window(oldest_time: datetime, chunk_days: int) -> tuple[datetime, str, str]:
    """One older chunk to fetch: ``[oldest - chunk_days .. oldest]``.

    Returns ``(start_dt, start_str, end_str)``. End is the current oldest loaded
    bar; start steps ``chunk_days`` back, floored to that day's 00:00 so a partial
    leading day is fully covered. ``start_dt`` (tz preserved from ``oldest_time``)
    is the next walk-back cursor; the strings are for the T4 range params."""
    end = oldest_time
    start_dt = (end - timedelta(days=max(1, chunk_days))).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return start_dt, _fmt_range_ts(start_dt), _fmt_range_ts(end)


def merge_older_bars(existing: list[dict], older: list[dict]) -> tuple[list[dict], int]:
    """Prepend ``older`` bars before ``existing``, returning ``(merged, prepended)``.

    Sorts ascending and drops duplicates at whole-second resolution (keeping the
    last bar at each second), matching ``ChartWindow._bars_df``'s rule so the
    candle series stays strictly ascending/unique. ``prepended`` is how many bars
    were actually added to the left (after de-dup) — used to restore scroll pos.
    """
    if not older:
        return existing, 0
    before = len(existing)
    by_sec: dict[int, dict] = {}
    for bar in [*older, *existing]:           # existing wins on a tie (later)
        sec = int(pd.Timestamp(bar["time"]).timestamp())
        by_sec[sec] = bar
    merged = [by_sec[s] for s in sorted(by_sec)]
    return merged, max(0, len(merged) - before)


class _Tag:
    """Minimal stand-in for a topbar widget, exposing ``value`` + ``set``.

    This bundled lightweight-charts build's topbar misbehaves with multiple
    widgets, so drawings persistence keys off this in-memory tag instead of a
    real textbox widget.
    """

    def __init__(self, value: str = "") -> None:
        self.value = value

    def set(self, value: str) -> None:
        self.value = value


class ChartWindow:
    def __init__(
        self,
        client,
        loop: asyncio.AbstractEventLoop,
        *,
        default_interval_seconds: int = 60,
        initial_load_days: int = 2,
        tz_offset_hours: float = 0.0,
        target_bars: int = 500,
        max_load_days: int = 120,
        chunk_days: int = 1,
        scroll_buffer_days: float = 1.0,
        history_floor: str = "2000-01-01",
    ) -> None:
        self._client = client
        self._loop = loop
        self._bridge = CallbackBridge(loop)
        self._interval = default_interval_seconds
        self._initial_load_days = initial_load_days
        self._target_bars = target_bars
        self._max_load_days = max_load_days
        self._chunk_days = max(1, chunk_days)            # older-history paging step
        self._scroll_buffer_days = scroll_buffer_days    # interval-scaled trigger span
        self._history_floor = self._parse_floor(history_floor)
        self._tz_offset_hours = tz_offset_hours

        self._chart: Optional[Chart] = None
        self._ticks = TickStore()
        self._agg = CandleAggregator(default_interval_seconds)

        # Phase 2 features (created in run() once the chart exists).
        self._order_lines: Optional[OrderLines] = None
        self._position_line: Optional[PositionLine] = None
        self._fill_markers: Optional[FillMarkers] = None
        self._indicators: Optional[Indicators] = None
        self._drawings: Optional[Drawings] = None
        self._order_tools: Optional[OrderTools] = None
        self._tools_installed = False  # order-tools JS injected post-load (once)

        # Per-active-market state.
        self._loaded_market_id: Optional[str] = None
        self._load_gen = 0           # bumped per load request; stale loads abort
        self._ready = False          # history loaded for the active market?
        self._last_ttv = 0           # cumulative traded volume seen (de-dupe)
        self._last_price: Optional[float] = None  # latest numeric trade price
        self._history_bars: list = []            # last-loaded bars (for backtester)
        self._history_interval = default_interval_seconds  # their interval (seconds)

        # Infinite scroll-back state: the cumulative ascending bar set currently
        # rendered, the oldest-loaded time (paging cursor), and re-entrancy/stop
        # guards. Reset whenever a base load starts (market switch / interval).
        self._loaded_bars: list = []
        self._oldest_loaded_time: Optional[datetime] = None
        self._loading_older = False
        self._no_more_history = False
        # Latest off-left-edge bar count seen on a range_change, plus a pending
        # re-arm timer. The lightweight-charts range_change event self-throttles
        # (unsubscribes, fires once, re-subscribes 50ms later), so events during
        # an in-flight fetch are dropped; after each fetch we re-check this cached
        # position and re-fire while the user is still pinned at the edge.
        self._last_bars_before: Optional[float] = None
        self._rearm_handle = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Build the chart and run its window until closed."""
        chart = Chart(title="PyDemo Chart", inner_width=1, inner_height=1, toolbox=True)
        self._chart = chart
        chart.legend(visible=True)
        chart.candle_style(
            up_color="#26a69a", down_color="#ef5350",
            wick_up_color="#26a69a", wick_down_color="#ef5350",
        )
        chart.volume_config(up_color="#26a69a64", down_color="#ef535064")
        chart.topbar.switcher(
            "interval", tuple(l for l, _ in _INTERVALS),
            default=_SEC_TO_LABEL.get(self._interval, "1m"),
            func=self._bridge.guard(self._on_interval_change),
        )
        # NOTE: only the interval switcher lives on the topbar — this bundled
        # build breaks with multiple topbar widgets. All Phase 3 controls live in
        # the custom-JS context menu instead. Indicators are shown by default.
        self._draw_tag = _Tag()

        # Instantiate features now that the chart exists.
        self._order_lines = OrderLines(chart, self._bridge, self._client)
        self._position_line = PositionLine(chart)
        self._fill_markers = FillMarkers(chart)
        self._indicators = Indicators(chart)
        self._drawings = Drawings(chart, self._draw_tag,
                                  persist_path=self._drawings_path())
        self._order_tools = OrderTools(
            chart, self._bridge, self._client,
            order_provider=lambda: {
                uid: info["price"]
                for uid, info in (self._order_lines._orders.items()
                                  if self._order_lines else [])
            },
            last_price_provider=lambda: self._last_price,
            indicators=self._indicators,
        )
        # NOTE: order-tools JS and the click subscription are installed *after*
        # the window loads (in _load_history) — injecting custom JS into the
        # pre-load script batch corrupts the topbar in this bundled build.

        try:
            await chart.show_async()
        except Exception:  # noqa: BLE001
            log.exception("chart window terminated unexpectedly")
        finally:
            self._chart = None


    def _install_dom_guards(self) -> None:
        """Make page DOM removal tolerant of already-detached nodes so a stale
        legend-row delete can't throw and kill the webview message pump.

        See ``_DOM_GUARD_JS``. Runs once, post-load (pre-load injection corrupts
        the topbar in this bundled build); persists in the page across
        ``chart.set()`` (which only re-sets data, it does not reload the page).
        """
        if self._chart is None:
            return
        try:
            self._chart.run_script(_DOM_GUARD_JS)
        except Exception:  # noqa: BLE001
            log.exception("chart: failed to install DOM guards")

    @staticmethod
    def _drawings_path() -> str:
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "config")
        return os.path.join(base, "chart_drawings.json")

    # ------------------------------------------------------------------
    # App -> chart
    # ------------------------------------------------------------------

    def _chart_live(self) -> bool:
        """True while the chart window is usable. ``is_alive`` flips False when
        the window closes (in show_async), *before* run()'s finally nulls
        ``self._chart`` — so checking it stops callbacks issuing operations on a
        disposed WebView2 (the ``ObjectDisposedException`` teardown race)."""
        return self._chart is not None and getattr(self._chart, "is_alive", True)

    def on_market_update(self, data: dict) -> None:
        """Sync callback from ``client.on_market_update`` (on the asyncio loop)."""
        if not self._chart_live():
            return
        market_id = data.get("market_id")
        if not market_id:
            return

        # Market switch -> reset overlays and (re)load history for the new market.
        if market_id != self._loaded_market_id:
            self._loaded_market_id = market_id
            self._ready = False
            self._last_ttv = 0
            for feat in (self._order_lines, self._position_line, self._fill_markers):
                if feat is not None:
                    feat.set_market(market_id)
            self._load_gen += 1
            gen = self._load_gen
            self._bridge.run_coro(lambda mid=market_id, g=gen: self._load_history(mid, g))
            return

        if not self._ready:
            # Capture a live price for JSON scale calibration while loading.
            self._capture_price(data)
            return

        self._handle_trade(data)

    def _capture_price(self, data: dict) -> None:
        price, _ = self._extract_trade(data)
        if price is not None:
            self._last_price = price

    def _handle_trade(self, data: dict) -> None:
        price, volume = self._extract_trade(data)
        if price is None:
            return
        self._last_price = price

        # De-dupe: only aggregate when cumulative traded volume advances.
        ttv = int(data.get("total_traded_volume") or 0)
        if ttv:
            if ttv <= self._last_ttv:
                return
            self._last_ttv = ttv
        # else: ttv unavailable - process each trade tick (may slightly
        # over-count volume; OHLC remains correct).

        ts = time.time()
        self._ticks.push(self._loaded_market_id, {"price": price, "volume": volume, "time": ts})
        bar = self._agg.add_tick(price, volume, ts)
        if bar is not None:
            self._chart.update(self._bar_series(bar))
            if self._indicators is not None:
                self._indicators.on_bar(bar)

    def on_account_update(self, data: dict) -> None:
        """Sync callback from ``client.on_account_update`` (on the asyncio loop).

        Routes order/position/fill events to the matching overlay feature,
        filtered to the chart's active market.
        """
        if not self._chart_live() or not self._loaded_market_id:
            return
        kind = data.get("type")
        market_id = self._loaded_market_id
        try:
            if kind == "orders" and self._order_lines is not None:
                self._order_lines.update(data.get("orders", []), market_id)
            elif kind == "positions" and self._position_line is not None:
                self._position_line.update(data.get("positions", []), market_id)
            elif kind == "fill" and self._fill_markers is not None:
                self._fill_markers.add(data, market_id)
        except Exception:  # noqa: BLE001
            log.exception("chart on_account_update(%s) failed", kind)

    @staticmethod
    def _extract_trade(data: dict) -> tuple[Optional[float], int]:
        """Pull (price, volume) from the market-update payload."""
        price = data.get("last_trade_price")
        volume = data.get("last_trade_volume") or 0
        if price is not None:
            try:
                return float(price), int(volume)
            except (ValueError, TypeError):
                pass
        # Fallback to the formatted "volume@price" string.
        parsed = parse_trade_string(data.get("last_trade", "-"))
        if parsed:
            return parsed
        return None, 0

    # ------------------------------------------------------------------
    # History loading
    # ------------------------------------------------------------------

    async def _fetch_bars(self, market_id, exchange_id, contract_id, interval,
                          start, end, live_price):
        """Fetch + normalise bars for one date window (in the executor so the
        synchronous HTTP/decoder never blocks the loop). Returns ``(bars, source)``;
        ``([], "none")`` on failure."""
        token = self._client.jw_token
        base_url = self._chart_base_url()

        def _fetch():
            hist = ChartHistory(token, base_url=base_url,
                                tz_offset_hours=self._tz_offset_hours)
            try:
                return hist.fetch(
                    exchange_id=exchange_id,
                    contract_id=contract_id,
                    market_id=market_id,
                    interval_seconds=interval,
                    trade_date_start=start,
                    trade_date_end=end,
                    live_price=live_price,
                )
            finally:
                hist.close()

        try:
            return await self._loop.run_in_executor(None, _fetch)
        except Exception:  # noqa: BLE001
            log.exception("chart: history fetch failed for %s [%s .. %s]",
                          market_id, start, end)
            return [], "none"

    async def _load_history(self, market_id: str, gen: int) -> None:
        """Base load for the active market/interval. Replaces the rendered data
        and resets the scroll-back cursor; older bars are then paged in lazily by
        :meth:`_load_older` as the user scrolls left."""
        details = self._client.market_details.get(market_id)
        exchange_id = getattr(details, "exchange_id", None) or self._client.md_exchange_id
        contract_id = getattr(details, "contract_id", None) or self._client.md_contract_id
        decimals = self._decimals(details)

        if not self._client.jw_token:
            log.warning("chart: no auth token yet; skipping history load")
            return

        start, end = self._date_range()
        interval = self._interval
        bars, source = await self._fetch_bars(
            market_id, exchange_id, contract_id, interval, start, end, self._last_price)

        # A later load request (interval switch or market switch) may have
        # superseded this one. Abort BEFORE any chart mutation so only the newest
        # load runs set()/recompute() — otherwise concurrent passes stack
        # duplicate indicator line series (chart.set() doesn't wipe create_line).
        # The mutate block below has no await, so once past here it's atomic.
        if gen != self._load_gen or market_id != self._loaded_market_id \
                or not self._chart_live():
            return

        # This is the base load: reset the cumulative scroll-back state.
        self._history_bars = bars            # backtester reads on-screen bars
        self._history_interval = interval
        self._loaded_bars = list(bars)
        self._oldest_loaded_time = bars[0]["time"] if bars else None
        self._no_more_history = False
        self._loading_older = False
        self._last_bars_before = None
        if self._rearm_handle is not None:
            self._rearm_handle.cancel()
            self._rearm_handle = None

        df = self._bars_df(self._loaded_bars)
        try:
            self._chart.precision(decimals)
            self._chart.set(df)
            # Fit only on a base load: show the freshly-loaded window. (Scroll-back
            # prepends must NOT fit — that would jump the viewport.)
            self._chart.fit()
            self._chart.watermark(f"{contract_id} {_SEC_TO_LABEL.get(interval, '')}")
        except Exception:  # noqa: BLE001 - surface webview/data errors, don't blank silently
            log.exception("chart: failed to render %d bars for %s", len(df), market_id)
            return

        self._agg.reset(interval)
        if bars:
            self._agg.seed_last_bar(bars[-1])
        self._ready = True

        # Install order-tools JS + event subscriptions once, now that the window
        # has loaded (pre-load injection corrupts the topbar in this build).
        if not self._tools_installed and self._order_tools is not None:
            self._install_dom_guards()  # must precede any line.delete() (later loads)
            self._order_tools.install()
            self._chart.events.click += self._bridge.guard(self._order_tools.on_click)
            self._chart.events.range_change += self._bridge.guard(self._on_range_change)
            self._tools_installed = True

        self._render_overlays(df, contract_id or market_id)
        self._log_loaded(df, source, exchange_id, contract_id)

    def _render_overlays(self, df, contract_id) -> None:
        """Rebuild indicator/order/position/fill/drawing overlays after a
        ``chart.set()`` (which wipes toolbox drawings and leaves stale line refs)."""
        try:
            if self._indicators is not None:
                self._indicators.recompute(df)
            if self._order_lines is not None:
                self._order_lines.rebuild()
            if self._position_line is not None:
                self._position_line.rebuild()
            if self._fill_markers is not None:
                self._fill_markers.rebuild()
            if self._drawings is not None:
                self._drawings.set_symbol(contract_id)
        except Exception:  # noqa: BLE001
            log.exception("chart: overlay rebuild failed")

    @staticmethod
    def _log_loaded(df, source, exchange_id, contract_id) -> None:
        first_t = df["time"].iloc[0] if not df.empty else None
        last_t = df["time"].iloc[-1] if not df.empty else None
        log.info("chart: loaded %d bars (%s) for %s/%s [%s .. %s]",
                 len(df), source, exchange_id, contract_id, first_t, last_t)

    # ------------------------------------------------------------------
    # Scroll-back (infinite history) loading
    # ------------------------------------------------------------------

    def _on_range_change(self, chart, bars_before: float, bars_after: float) -> None:
        """Fires on scroll/pan (on the asyncio loop). When the user nears the left
        edge, lazily fetch + prepend older history (JSDemo-style)."""
        # Track the latest position even when guarded below — the re-arm uses it.
        if bars_before is not None:
            self._last_bars_before = bars_before
        if not self._ready or not self._chart_live():
            return
        if self._loading_older or self._no_more_history:
            return
        if self._oldest_loaded_time is None or bars_before is None:
            return
        if bars_before >= self._scroll_buffer_bars():
            return
        asyncio.ensure_future(self._load_older(self._load_gen))

    def _scroll_buffer_bars(self) -> int:
        """Interval-scaled left-edge trigger threshold (see module helper)."""
        return scroll_buffer_bars(self._interval, self._scroll_buffer_days)

    async def _load_older(self, gen: int) -> None:
        """Fetch the next older chunk(s) and prepend them, preserving scroll
        position. Walks backward over empty (weekend/holiday) windows up to a few
        attempts; stops at ``history_floor``."""
        if (self._loading_older or self._no_more_history or not self._ready
                or self._oldest_loaded_time is None or not self._chart_live()):
            return
        market_id = self._loaded_market_id
        details = self._client.market_details.get(market_id)
        exchange_id = getattr(details, "exchange_id", None) or self._client.md_exchange_id
        contract_id = getattr(details, "contract_id", None) or self._client.md_contract_id
        interval = self._interval

        self._loading_older = True
        try:
            end = self._oldest_loaded_time
            older: list = []
            for _attempt in range(14):           # skip empty weekend/holiday windows
                if end <= self._history_floor:
                    self._no_more_history = True
                    break
                start_dt, start_s, end_s = older_window(end, self._chunk_days)
                bars, _src = await self._fetch_bars(
                    market_id, exchange_id, contract_id, interval,
                    start_s, end_s, self._last_price)
                # Superseded by a market/interval switch while fetching?
                if gen != self._load_gen or market_id != self._loaded_market_id \
                        or not self._chart_live():
                    return
                older = [b for b in bars if b["time"] < self._oldest_loaded_time]
                if older:
                    break
                end = start_dt                   # nothing new here; step further back
                if end <= self._history_floor:
                    self._no_more_history = True
                    break

            if not older:
                return

            merged, prepended = merge_older_bars(self._loaded_bars, older)
            if prepended == 0:
                return
            self._loaded_bars = merged
            self._oldest_loaded_time = merged[0]["time"]
            self._history_bars = merged          # keep backtester cache in sync
            # _restore_scroll shifts the view right by `prepended`; mirror that on
            # the cached position so the re-arm sees the post-shift edge distance
            # without waiting on the (throttled) range_change to re-fire.
            self._last_bars_before = (self._last_bars_before or 0) + prepended

            df = self._bars_df(self._loaded_bars)
            try:
                self._chart.set(df)              # NO fit() — would jump the viewport
                self._restore_scroll(prepended)  # shift view right by prepended bars
            except Exception:  # noqa: BLE001
                log.exception("chart: failed to render older bars for %s", market_id)
                return
            self._render_overlays(df, contract_id or market_id)
            log.info("chart: +%d older bars (%d total) for %s, oldest now %s",
                     prepended, len(df), contract_id,
                     df["time"].iloc[0] if not df.empty else None)
        finally:
            self._loading_older = False
            # A single drag fires range_change once, then the lib goes deaf for
            # ~50ms; events arriving mid-fetch are dropped by the guard above. Re-
            # check on the next tick so continuous scrolling keeps pulling chunks
            # instead of stalling after one (JSDemo _scheduleOlderHistoryRearm).
            self._schedule_older_rearm()

    def _schedule_older_rearm(self) -> None:
        """Re-fire ``_load_older`` shortly after a fetch if the user is still near
        the left edge. Self-terminating: each chunk's ``_restore_scroll`` pushes
        ``_last_bars_before`` back above the threshold once the buffer refills."""
        if self._no_more_history or self._rearm_handle is not None:
            return

        def _rearm():
            self._rearm_handle = None
            if (self._loading_older or self._no_more_history
                    or not self._ready or not self._chart_live()):
                return
            if (self._last_bars_before is not None
                    and self._last_bars_before < self._scroll_buffer_bars()):
                asyncio.ensure_future(self._load_older(self._load_gen))

        # 50ms > the lib's range_change re-subscribe delay, ≈ JSDemo's rAF re-arm.
        self._rearm_handle = self._loop.call_later(0.05, _rearm)

    def _restore_scroll(self, prepended: int) -> None:
        """After prepending ``prepended`` bars and re-``set()``-ing, shift the
        visible logical range right by that many bars so the user stays on the same
        candles (``set()`` preserves logical indices, which now point further back)."""
        if prepended <= 0 or self._chart is None:
            return
        try:
            self._chart.run_script(f'''
            (function () {{
                var ts = {self._chart.id}.chart.timeScale();
                var r = ts.getVisibleLogicalRange();
                if (r) ts.setVisibleLogicalRange({{from: r.from + {prepended}, to: r.to + {prepended}}});
            }})()''')
        except Exception:  # noqa: BLE001
            log.exception("chart: failed to restore scroll position")

    def _on_interval_change(self, chart) -> None:
        label = chart.topbar["interval"].value
        seconds = _LABEL_TO_SEC.get(label)
        if not seconds or seconds == self._interval:
            return
        self._interval = seconds
        self._agg.reset(seconds)
        self._ready = False
        if self._loaded_market_id:
            mid = self._loaded_market_id
            self._load_gen += 1
            gen = self._load_gen
            self._bridge.run_coro(lambda m=mid, g=gen: self._load_history(m, g))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_floor(s: str) -> datetime:
        """Parse the configured history floor into a tz-aware UTC datetime (the
        oldest date scroll-back will page to). Falls back to 2000-01-01 on junk."""
        try:
            dt = datetime.fromisoformat(str(s))
        except (ValueError, TypeError):
            dt = datetime(2000, 1, 1)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    def _decimals(self, details) -> int:
        if details is None:
            return 2
        if getattr(self._client, "priceFormat", 0):
            return int(getattr(details, "real_decimals", None)
                       or getattr(details, "decimals", 2) or 2)
        return int(getattr(details, "decimals", 2) or 2)

    def _chart_base_url(self) -> Optional[str]:
        api = getattr(self._client, "apiUrl", None)
        if not api:
            return None
        return api.rstrip("/") + "/chart"

    def _date_range(self) -> tuple[str, str]:
        now = datetime.now(timezone.utc)
        days = self._lookback_days(self._interval)
        start = (now - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")
        end = now.strftime("%Y-%m-%dT23:59:59")
        return start, end

    def _lookback_days(self, interval_seconds: int) -> int:
        return lookback_days(interval_seconds, self._target_bars,
                             self._initial_load_days, self._max_load_days)

    @staticmethod
    def _to_ns(times) -> pd.Series:
        """Normalise a time column/series to tz-naive ``datetime64[ns]``.

        lightweight-charts converts time with ``astype('int64') // 10**9``,
        which assumes nanosecond resolution. pandas >= 3.0 defaults to
        microsecond (``datetime64[us]``) resolution, so without this the
        library's conversion collapses every bar to a single timestamp and the
        chart renders one candle. Forcing ``[ns]`` keeps it correct on any
        pandas version.
        """
        return pd.to_datetime(times, utc=True).dt.tz_localize(None).astype("datetime64[ns]")

    @classmethod
    def _bars_df(cls, bars: list[dict], max_bars: Optional[int] = None) -> pd.DataFrame:
        cols = ["time", "open", "high", "low", "close", "volume"]
        if not bars:
            return pd.DataFrame(columns=cols)
        df = pd.DataFrame(bars, columns=cols)
        df["time"] = cls._to_ns(df["time"])
        # Force float OHLC so a later fractional live update() never hits pandas
        # 3.0's "Invalid value for dtype int64" when prices happen to be whole.
        for col in ("open", "high", "low", "close"):
            df[col] = df[col].astype("float64")
        # lightweight-charts truncates `time` to whole seconds and requires
        # strictly-ascending, unique timestamps; otherwise setData rejects the
        # whole array in the webview. Sort and drop second-level duplicates
        # (keeping the last/most-complete bar at each second).
        df = df.sort_values("time")
        sec = df["time"].astype("int64") // 10 ** 9
        df = df[~sec.duplicated(keep="last")].reset_index(drop=True)
        # Cap the *rendered* bar count. At dense intervals (e.g. 15s) the load
        # window yields ~15k bars; lightweight-charts serialises them with
        # json.dumps(indent=2) into a multi-MB setData() script that WebView2
        # renders only partially ("half-loaded"). Keep the most recent max_bars
        # for display; the caller still caches the full set for the backtester.
        if max_bars and len(df) > max_bars:
            df = df.iloc[-max_bars:].reset_index(drop=True)
        return df

    @staticmethod
    def _bar_series(bar: dict) -> pd.Series:
        return pd.Series({
            "time": bar["time"],
            "open": bar["open"],
            "high": bar["high"],
            "low": bar["low"],
            "close": bar["close"],
            "volume": bar["volume"],
        })
