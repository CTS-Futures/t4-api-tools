"""Phase 3 custom-JS order interactions.

Adds, via injected JavaScript and the ``window.callbackFunction`` bridge:

* **Crosshair tracking** - stores the price/time under the cursor in
  ``window.__pyc`` (JS-only; not emitted to Python to avoid flooding the queue).
* **Right-click context menu** - Buy / Sell limit at the crosshair price, and
  "Cancel nearest order"; selections call back into Python.
* **Drag-to-place** - in drag mode, press-and-release on the chart places a
  limit order at the release price.
* **Click-to-place** - in order mode, a left click (native ``events.click``)
  places a limit order at the clicked price.

All order actions route through the callback bridge to ``client.submit_order`` /
``client.pull_order``. Buy vs sell is inferred from the price relative to the
last trade (below = buy, above = sell).
"""

from __future__ import annotations

import logging

log = logging.getLogger("pydemo.chart.order_tools")

# JS injected once on load. `CID` is replaced with the chart's JS object name.
# Braces are literal JS (this is a plain string, not an f-string).
_JS = r"""
(function () {
  if (window.__pydemoTools) return;
  window.__pydemoTools = true;
  window.__pydemoDragMode = false;
  var C = CID;

  // --- crosshair tracking (JS-only) ---
  C.chart.subscribeCrosshairMove(function (param) {
    if (param && param.point) {
      var price = C.series.coordinateToPrice(param.point.y);
      var t = C.chart.timeScale().coordinateToTime(param.point.x);
      if (price !== undefined && price !== null) {
        window.__pyc = { price: price, time: t };
      }
    }
  });

  // --- right-click context menu ---
  var menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:99999;display:none;background:#222;'
    + 'border:1px solid #555;border-radius:4px;font:12px sans-serif;color:#eee;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;';
  document.body.appendChild(menu);

  function addItem(label, onClick) {
    var d = document.createElement('div');
    d.textContent = label;
    d.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
    d.onmouseenter = function () { d.style.background = '#3a3a3a'; };
    d.onmouseleave = function () { d.style.background = 'transparent'; };
    d.onclick = function () { menu.style.display = 'none'; onClick(); };
    menu.appendChild(d);
  }

  function sep() {
    var d = document.createElement('div');
    d.style.cssText = 'border-top:1px solid #444;margin:2px 0;';
    menu.appendChild(d);
  }

  function buildMenu(price) {
    menu.innerHTML = '';
    var p = Math.round(price * 1e6) / 1e6;
    addItem('Buy limit @ ' + p, function () {
      window.callbackFunction('pydemoCtx_~_buy;;;' + price);
    });
    addItem('Sell limit @ ' + p, function () {
      window.callbackFunction('pydemoCtx_~_sell;;;' + price);
    });
    addItem('Cancel nearest order', function () {
      window.callbackFunction('pydemoCtx_~_cancel;;;' + price);
    });
    sep();
    addItem('Click-to-place: ' + (window.__pydemoClick ? 'ON' : 'OFF'), function () {
      window.callbackFunction('pydemoMode_~_click');
    });
    addItem('Drag-to-place: ' + (window.__pydemoDragMode ? 'ON' : 'OFF'), function () {
      window.callbackFunction('pydemoMode_~_drag');
    });
    // --- indicator on/off toggles (seeded from Python) ---
    var inds = window.__pydemoIndSpecs || [];
    var indState = window.__pydemoInd || {};
    if (inds.length) {
      sep();
      for (var i = 0; i < inds.length; i++) {
        (function (spec) {
          addItem(spec.label + ': ' + (indState[spec.key] ? 'ON' : 'OFF'), function () {
            window.callbackFunction('pydemoInd_~_' + spec.key);
          });
        })(inds[i]);
      }
    }
  }

  document.addEventListener('contextmenu', function (e) {
    if (!window.__pyc || window.__pyc.price == null) return;
    e.preventDefault();
    buildMenu(window.__pyc.price);
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.display = 'block';
  });
  document.addEventListener('click', function () { menu.style.display = 'none'; });

  // --- drag-to-place ---
  var dragStart = null;
  document.addEventListener('mousedown', function (e) {
    if (!window.__pydemoDragMode || e.button !== 0 || !window.__pyc) return;
    dragStart = window.__pyc.price;
  });
  document.addEventListener('mouseup', function () {
    if (!window.__pydemoDragMode || dragStart == null) return;
    var end = window.__pyc ? window.__pyc.price : null;
    var start = dragStart;
    dragStart = null;
    if (end != null) {
      window.callbackFunction('pydemoDrag_~_' + start + ';;;' + end);
    }
  });
})();
"""


class OrderTools:
    def __init__(self, chart, bridge, client, *, order_provider,
                 last_price_provider, default_volume: int = 1,
                 indicators=None) -> None:
        self._chart = chart
        self._bridge = bridge
        self._client = client
        self._order_provider = order_provider        # () -> {uid: price}
        self._last_price_provider = last_price_provider  # () -> float | None
        self._default_volume = default_volume
        self._indicators = indicators                # Indicators feature (toggles)
        self._click_mode = False
        self._drag_mode = False

    # ------------------------------------------------------------------
    # Install (called before show; scripts queue and run on load)
    # ------------------------------------------------------------------

    def install(self) -> None:
        win = self._chart.win
        win.handlers["pydemoCtx"] = self._bridge.guard(self._on_context_action)
        win.handlers["pydemoDrag"] = self._bridge.guard(self._on_drag)
        win.handlers["pydemoMode"] = self._bridge.guard(self._on_mode)
        win.handlers["pydemoInd"] = self._bridge.guard(self._on_indicator_toggle)
        try:
            self._chart.run_script(_JS.replace("CID", self._chart.id))
            self._seed_indicator_menu()
        except Exception:  # noqa: BLE001
            log.exception("failed to inject order-tools JS")

    def _seed_indicator_menu(self) -> None:
        """Push the indicator specs + current on/off state to JS so the context
        menu can render a toggle per indicator."""
        if self._indicators is None:
            return
        import json
        specs = self._indicators.specs_for_menu()
        state = {s["key"]: self._indicators.is_visible(s["key"]) for s in specs}
        try:
            self._chart.run_script(
                f"window.__pydemoIndSpecs = {json.dumps(specs)};"
                f"window.__pydemoInd = {json.dumps(state)};")
        except Exception:  # noqa: BLE001
            log.exception("failed to seed indicator menu")

    # ------------------------------------------------------------------
    # Mode toggles
    # ------------------------------------------------------------------

    def set_drag_mode(self, enabled: bool) -> None:
        self._drag_mode = enabled
        try:
            self._chart.run_script(
                f"window.__pydemoDragMode = {'true' if enabled else 'false'}")
        except Exception:  # noqa: BLE001
            log.exception("failed to set drag mode")

    def set_click_mode(self, enabled: bool) -> None:
        self._click_mode = enabled
        try:
            self._chart.run_script(
                f"window.__pydemoClick = {'true' if enabled else 'false'}")
        except Exception:  # noqa: BLE001
            log.exception("failed to set click mode")

    def _on_mode(self, which) -> None:
        """Context-menu toggle for click/drag placement modes."""
        if which == "click":
            self.set_click_mode(not self._click_mode)
        elif which == "drag":
            self.set_drag_mode(not self._drag_mode)

    def on_click(self, chart, time, price) -> None:
        """Wired to native chart.events.click; places on left click in order mode."""
        if not self._click_mode or price is None:
            return
        self._place_limit(float(price))

    # ------------------------------------------------------------------
    # JS callbacks
    # ------------------------------------------------------------------

    def _on_context_action(self, action, price) -> None:
        price = float(price)
        if action == "buy":
            self._submit("buy", price)
        elif action == "sell":
            self._submit("sell", price)
        elif action == "cancel":
            self._cancel_nearest(price)

    def _on_drag(self, start, end) -> None:
        # Entry is the release price; start is informational.
        self._place_limit(float(end))

    def _on_indicator_toggle(self, key) -> None:
        """Context-menu toggle: flip one indicator on/off and reflect the new
        state back to JS so the menu label updates next time it opens."""
        if self._indicators is None:
            return
        new_state = not self._indicators.is_visible(key)
        self._indicators.set_visible(key, new_state)
        try:
            self._chart.run_script(
                f"window.__pydemoInd['{key}'] = {'true' if new_state else 'false'};")
        except Exception:  # noqa: BLE001
            log.exception("failed to push indicator state for %s", key)

    # ------------------------------------------------------------------
    # Order helpers
    # ------------------------------------------------------------------

    def _place_limit(self, price: float) -> None:
        side = self._infer_side(price)
        self._submit(side, price)

    def _infer_side(self, price: float) -> str:
        last = self._last_price_provider()
        # Resting buy limits sit below the market, sell limits above.
        if last is not None and price > last:
            return "sell"
        return "buy"

    def _submit(self, side: str, price: float) -> None:
        vol = self._default_volume
        self._bridge.run_coro(
            lambda: self._client.submit_order(side, vol, price, "limit"))
        log.info("chart order: %s %s @ %s", side, vol, price)

    def _cancel_nearest(self, price: float) -> None:
        orders = self._order_provider() or {}
        if not orders:
            log.info("cancel nearest: no working orders")
            return
        uid = min(orders, key=lambda u: abs(orders[u] - price))
        self._bridge.run_coro(lambda: self._client.pull_order(uid))
        log.info("chart cancel nearest order %s (near %s)", uid, price)
