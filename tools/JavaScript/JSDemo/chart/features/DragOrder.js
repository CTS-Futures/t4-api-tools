/**
 * chart/features/DragOrder.js
 *
 * Feature module: click-and-drag on the chart price area to place a working
 * order (limit or stop) at the drop price. With Bracket mode enabled, the
 * entry drop opens a TradingView-style position tool with shaded green TP
 * and red SL zones whose edges drag to set absolute prices; the user then
 * clicks Submit to fire an AOCO_P bracket.
 *
 * Activation is explicit, via a toolbar toggle (see chart/ui/OrderToolbar.js):
 *
 *   feature.beginTool('buy')   // arm Buy tool
 *   feature.beginTool('sell')  // arm Sell tool
 *   feature.setBracketMode(true|false)
 *   feature.cancelTool()       // disarm
 *
 * While armed:
 *   - Chart pan/zoom is disabled (otherwise drag would scroll the chart).
 *   - Pointerdown anywhere in the chart area starts a drag and shows a live
 *     dashed preview price line that tracks the cursor (snapped to tick).
 *   - On pointerup the intent is sent to the host via `onOrder` (simple mode)
 *     OR the bracket setup opens (bracket mode). The tool stays armed so the
 *     user can place multiple orders in a row.
 *   - The order TYPE (limit vs stop) is inferred from the drop price vs the
 *     last traded price, so a single tool covers both:
 *         Buy  : below last = Limit,  above last = Stop
 *         Sell : above last = Limit,  below last = Stop
 *
 * Bracket setup:
 *   - Two shaded zones extend right from entry: green TP, red SL.
 *   - The TP and SL edges are full-width price lines that drag to revise.
 *   - Live $risk / $reward and R:R badges anchor at the zone mid-prices.
 *   - A floating Submit / Cancel bar fires the bracket via `onOrder` with
 *     takeProfitPrice/stopLossPrice set; the host submits an AOCO_P.
 *
 * Host wiring (set by index.html):
 *   feature.onOrder = ({ side, priceType, price, volume, anchor, label,
 *                        takeProfitPrice, stopLossPrice, isBracket }) => { ... }
 */
(function (global) {
    'use strict';

    const QTY_INPUT_ID = 'chartQuickQty';
    const EDGE_HIT_PX = 8;          // tolerance for grabbing a TP/SL edge
    const DEFAULT_OFFSET_TICKS = 10; // initial TP/SL distance when bracket opens
    // Bracket setup framing. When setup opens we zoom IN on the right-hand area
    // where the entry/TP/SL sit rather than zooming out: a short recent lookback
    // for context on the left plus a slab of whitespace on the right where the
    // bracket is drafted. Framed deterministically by LOGICAL bar index (not by
    // time) so the far-future zone points can't distort the visible range, and
    // the zone band is anchored to the real current candle so it sits right
    // next to it. Restored on exit.
    const SETUP_VIEW_LOOKBACK = 40;  // recent candles shown to the left for context
    const SETUP_VIEW_FORWARD = 20;   // whitespace bars shown to the right (in view)
    const ZONE_FORWARD_BARS = 60;    // how far the shaded band extends right (>= VIEW_FORWARD)
    // Edge-drag sensitivity: cursor pixels are scaled by this factor before
    // converting to price, so TP/SL adjust at a fraction of cursor speed for
    // finer control. <1 = slower/finer.
    const EDGE_DRAG_SENSITIVITY = 0.33;

    class DragOrderFeature {
        constructor() {
            this.id = 'order-drag';
            this._chart = null;
            this._series = null;
            this._container = null;
            this._host = null;
            this._client = null;
            this._bus = null;

            this._toolMode = null;       // null | 'buy' | 'sell'
            this._bracketMode = false;
            this._orderType = 'auto';    // 'auto' | 'limit' | 'stop' | 'market' | 'oco'
            this._onToolChange = null;
            this._onStateChange = null;
            this._dragging = false;
            this._activePointerId = null;
            this._previewLine = null;
            this._previewType = null;    // 'limit' | 'stop' (last computed)
            this._previewPrice = NaN;
            this._lastClient = { x: 0, y: 0 };

            // Bracket setup state. Null when not in setup.
            //   { side, entry, priceType, tp, sl, qty, decimals, pointValue,
            //     tStart, tEnd, tpLine, slLine, entryLine, tpFill, slFill,
            //     tpBadge, slBadge, confirmBar }
            this._setup = null;
            // OCO setup state. Null when not building an OCO. Two independent,
            // simultaneously-working legs (one cancels the other):
            //   { side, leg1, leg2, qty, decimals, leg1Line, leg2Line,
            //     confirmBar, anchor }
            this._oco = null;
            this._edgeDrag = null;       // null | 'tp' | 'sl'
            this._edgeStartY = NaN;      // grab anchor for sensitivity scaling
            this._edgeStartPrice = NaN;
            this._setupRaf = 0;

            // Chart scroll/scale options to restore on disarm.
            this._savedHandle = null;
            // Time-scale shape ({ rightOffset, fixRightEdge }) saved on bracket
            // setup so the right-side draft buffer can be unwound on exit.
            this._savedTimeScale = null;

            this._unsubSymbol = null;

            this._onPointerDown = this._onPointerDown.bind(this);
            this._onPointerMove = this._onPointerMove.bind(this);
            this._onPointerUp = this._onPointerUp.bind(this);
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onContextMenu = this._onContextMenu.bind(this);
            this._tickBadges = this._tickBadges.bind(this);

            this.onOrder = null;
        }

        attach(ctx) {
            this._chart = ctx.chart;
            this._series = ctx.candleSeries;
            this._container = ctx.container;
            this._host = ctx.host;
            this._client = ctx.client;
            this._bus = ctx.bus;
            // Disarm on symbol switch so a stale tool doesn't apply to a new
            // contract with different tick size / decimals.
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => {
                this._exitSetup(true);
                this._exitOco(true);
                this.cancelTool();
            });
        }

        detach() {
            this.cancelTool();
            if (this._unsubSymbol) this._unsubSymbol();
            this._chart = null;
            this._series = null;
            this._container = null;
            this._host = null;
            this._client = null;
            this._bus = null;
        }

        setCallbacks({ onToolChange, onStateChange } = {}) {
            this._onToolChange = typeof onToolChange === 'function' ? onToolChange : null;
            this._onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
        }

        setBracketMode(on) {
            this._bracketMode = !!on;
            // Don't tear down an open setup if the user toggles mid-flight;
            // they can still Submit/Cancel the current bracket.
        }

        // Force the order type for chart-placed entries. 'auto' keeps the
        // drop-vs-last inference (_inferType); 'limit'/'stop'/'market' force it;
        // 'oco' makes a drop open the two-line OCO builder.
        setOrderType(type) {
            const t = (typeof type === 'string' ? type : 'auto').toLowerCase();
            this._orderType = ['auto', 'limit', 'stop', 'market', 'oco'].includes(t) ? t : 'auto';
            // Leaving OCO mode with a build open: tear it down so a stale
            // overlay doesn't linger.
            if (this._orderType !== 'oco') this._exitOco(true);
        }

        // ---------- arm / disarm -----------------------------------------
        beginTool(mode) {
            if (mode !== 'buy' && mode !== 'sell') return;
            if (this._toolMode === mode) return;
            // Switching mode mid-flight: clean current drag + setup first.
            this._exitSetup(true);
            this._exitOco(true);
            this._endDrag(true);
            this._toolMode = mode;
            this._armChart();
            this._emitToolChange();
        }

        cancelTool() {
            if (!this._toolMode) return;
            this._exitSetup(true);
            this._exitOco(true);
            this._endDrag(true);
            this._disarmChart();
            this._toolMode = null;
            this._emitToolChange();
        }

        _emitToolChange() {
            if (this._onToolChange) {
                try { this._onToolChange(this._toolMode); }
                catch (err) { console.error('[DragOrder] onToolChange failed:', err); }
            }
        }

        _emitStateChange() {
            if (this._onStateChange) {
                const state = (this._setup || this._oco) ? 'setup' : (this._toolMode ? 'armed' : 'idle');
                try { this._onStateChange(state); }
                catch (err) { console.error('[DragOrder] onStateChange failed:', err); }
            }
        }

        _armChart() {
            if (!this._container || !this._chart) return;
            // Save and disable chart pan/zoom so our drag isn't a chart scroll.
            try {
                this._savedHandle = {
                    handleScroll: true,
                    handleScale: true
                };
                this._chart.applyOptions({
                    handleScroll: false,
                    handleScale: false
                });
            } catch (_) { /* older builds may not support — ignore */ }

            this._container.classList.add('chart-drag-armed');
            // Capture-phase so we beat any chart-internal handlers.
            this._container.addEventListener('pointerdown', this._onPointerDown, true);
            this._container.addEventListener('pointermove', this._onPointerMove, true);
            this._container.addEventListener('pointerup', this._onPointerUp, true);
            this._container.addEventListener('pointercancel', this._onPointerUp, true);
            this._container.addEventListener('contextmenu', this._onContextMenu, true);
            global.addEventListener('keydown', this._onKeyDown, true);
        }

        _disarmChart() {
            if (!this._container) return;
            this._container.classList.remove('chart-drag-armed');
            this._container.removeEventListener('pointerdown', this._onPointerDown, true);
            this._container.removeEventListener('pointermove', this._onPointerMove, true);
            this._container.removeEventListener('pointerup', this._onPointerUp, true);
            this._container.removeEventListener('pointercancel', this._onPointerUp, true);
            this._container.removeEventListener('contextmenu', this._onContextMenu, true);
            global.removeEventListener('keydown', this._onKeyDown, true);

            if (this._savedHandle && this._chart) {
                try {
                    this._chart.applyOptions({
                        handleScroll: this._savedHandle.handleScroll,
                        handleScale: this._savedHandle.handleScale
                    });
                } catch (_) { /* ignore */ }
            }
            this._savedHandle = null;
        }

        // ---------- pointer handlers --------------------------------------
        _onPointerDown(e) {
            if (!this._toolMode) return;
            // Right-click while armed = cancel (setup first, else disarm).
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                if (this._setup) this._exitSetup(true);
                else if (this._oco) this._exitOco(true);
                else this.cancelTool();
                return;
            }
            if (e.button !== 0) return;

            // In OCO setup: only leg-line grabs are allowed, same as bracket setup.
            if (this._oco) {
                const rect = this._container.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const edge = this._hitTestEdge(y);
                if (!edge) return;
                e.preventDefault();
                e.stopPropagation();
                this._edgeDrag = edge;              // 'leg1' | 'leg2'
                this._edgeStartY = y;
                this._edgeStartPrice = (edge === 'leg1') ? this._oco.leg1 : this._oco.leg2;
                this._activePointerId = e.pointerId;
                try { this._container.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                return;
            }

            // In setup mode: only edge grabs are allowed. Other clicks are
            // ignored so the user can't accidentally start a new entry drag
            // on top of an in-progress bracket setup.
            if (this._setup) {
                const rect = this._container.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const edge = this._hitTestEdge(y);
                if (!edge) return;
                e.preventDefault();
                e.stopPropagation();
                this._edgeDrag = edge;
                // Anchor the drag so motion is measured as a pixel delta from
                // the grab point and scaled down (see _edgePriceFromEvent).
                this._edgeStartY = y;
                this._edgeStartPrice = (edge === 'tp') ? this._setup.tp : this._setup.sl;
                this._activePointerId = e.pointerId;
                try { this._container.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                return;
            }

            const price = this._priceFromEvent(e);
            if (!Number.isFinite(price)) return;

            e.preventDefault();
            e.stopPropagation();
            this._dragging = true;
            this._activePointerId = e.pointerId;
            this._lastClient = { x: e.clientX, y: e.clientY };

            try { this._container.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            this._updatePreview(price);
        }

        _onPointerMove(e) {
            // Edge-drag during bracket setup.
            if (this._edgeDrag) {
                if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
                const price = this._edgePriceFromEvent(e);
                if (!Number.isFinite(price)) return;
                this._updateEdge(this._edgeDrag, price);
                return;
            }
            // Hover feedback over an edge while in setup: ns-resize cursor.
            if ((this._setup || this._oco) && !this._dragging) {
                const rect = this._container.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const edge = this._hitTestEdge(y);
                this._container.classList.toggle('chart-bracket-edge-hover', !!edge);
                return;
            }
            if (!this._dragging) return;
            if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
            const price = this._priceFromEvent(e);
            if (!Number.isFinite(price)) return;
            this._lastClient = { x: e.clientX, y: e.clientY };
            this._updatePreview(price);
        }

        _onPointerUp(e) {
            // End edge-drag.
            if (this._edgeDrag) {
                if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
                try { this._container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
                this._edgeDrag = null;
                this._edgeStartY = NaN;
                this._edgeStartPrice = NaN;
                this._activePointerId = null;
                return;
            }
            if (!this._dragging) return;
            if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
            const price = this._priceFromEvent(e) || this._previewPrice;
            const anchor = { clientX: e.clientX, clientY: e.clientY };
            try { this._container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            this._endDrag(false);

            if (e.type === 'pointercancel') return;
            if (!Number.isFinite(price)) return;

            if (this._orderType === 'oco') {
                this._enterOcoSetup(price, anchor);
            } else if (this._bracketMode) {
                this._enterSetup(price, anchor);
            } else {
                this._fireOrder(price, anchor);
            }
        }

        _onKeyDown(e) {
            if (e.key !== 'Escape') return;
            if (this._edgeDrag) {
                this._edgeDrag = null;
                this._edgeStartY = NaN;
                this._edgeStartPrice = NaN;
                this._activePointerId = null;
                return;
            }
            if (this._setup) {
                this._exitSetup(true);
                return;
            }
            if (this._oco) {
                this._exitOco(true);
                return;
            }
            if (this._dragging) {
                // Drop the in-flight drag but stay armed.
                this._endDrag(true);
            } else {
                this.cancelTool();
            }
        }

        _onContextMenu(e) {
            // While armed, suppress the price/order context menu — right-click
            // is reserved for "disarm" via _onPointerDown.
            if (!this._toolMode) return;
            e.preventDefault();
            e.stopPropagation();
        }

        // ---------- preview rendering -------------------------------------
        _priceFromEvent(e) {
            if (!this._container || !this._series) return NaN;
            const rect = this._container.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const raw = this._series.coordinateToPrice(y);
            if (raw == null || !Number.isFinite(raw)) return NaN;
            const snap = (this._host && typeof this._host._snapToTick === 'function')
                ? this._host._snapToTick(raw)
                : raw;
            return Number(snap);
        }

        // Price for a TP/SL edge drag, scaled for finer control: the pixel delta
        // from the grab point is shrunk by EDGE_DRAG_SENSITIVITY before being
        // converted to price, so the edge tracks at a fraction of cursor speed.
        // Still snapped to tick. Falls back to the 1:1 path if no drag anchor.
        _edgePriceFromEvent(e) {
            if (!this._container || !this._series) return NaN;
            if (!Number.isFinite(this._edgeStartY)) return this._priceFromEvent(e);
            const rect = this._container.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const scaledY = this._edgeStartY + (y - this._edgeStartY) * EDGE_DRAG_SENSITIVITY;
            const raw = this._series.coordinateToPrice(scaledY);
            if (raw == null || !Number.isFinite(raw)) return NaN;
            const snap = (this._host && typeof this._host._snapToTick === 'function')
                ? this._host._snapToTick(raw)
                : raw;
            return Number(snap);
        }

        _updatePreview(price) {
            if (!this._series) return;
            const side = this._toolMode === 'buy' ? 1 : -1;
            const type = this._effectiveType(side, price);
            const color = side === 1 ? '#26a69a' : '#ef5350';
            const decimals = this._host?.knownDecimals ?? 2;
            const sideText = side === 1 ? 'BUY' : 'SELL';
            // Market has no working price — label it as such but still track the
            // cursor line so the gesture has visual feedback.
            const title = type === 'market'
                ? `${sideText} MARKET`
                : `${sideText} ${type.toUpperCase()} @ ${Number(price).toFixed(decimals)}`;

            const LS = global.LightweightCharts?.LineStyle;
            const dashed = LS?.Dashed ?? 2;

            if (!this._previewLine) {
                this._previewLine = this._series.createPriceLine({
                    price,
                    color,
                    lineWidth: 2,
                    lineStyle: dashed,
                    axisLabelVisible: true,
                    title
                });
            } else {
                this._previewLine.applyOptions({ price, color, title });
            }
            this._previewPrice = price;
            this._previewType = type;
        }

        _inferType(side, price) {
            const last = this._lastPrice();
            if (!Number.isFinite(last)) {
                // No reference yet — default to limit; user can revise if wrong.
                return 'limit';
            }
            if (side === 1) return price <= last ? 'limit' : 'stop';
            return price >= last ? 'limit' : 'stop';
        }

        // Effective type for a simple drag entry: honour a forced Type from the
        // toolbar (limit/stop/market), else fall back to drop-vs-last inference.
        // 'oco' never reaches here (it opens the OCO builder instead).
        _effectiveType(side, price) {
            if (this._orderType === 'limit' || this._orderType === 'stop' || this._orderType === 'market') {
                return this._orderType;
            }
            return this._inferType(side, price);
        }

        _lastPrice() {
            const id = this._host?.activeMarketId;
            if (!id || !this._client?.getMarketSnapshot) return NaN;
            const snap = this._client.getMarketSnapshot(id);
            const v = snap?.tradeData?.lastTradePrice?.value;
            const n = v == null ? NaN : Number(v);
            return Number.isFinite(n) ? n : NaN;
        }

        // ---------- finalize ---------------------------------------------
        _endDrag(/* canceled */) {
            this._dragging = false;
            this._activePointerId = null;
            if (this._previewLine && this._series) {
                try { this._series.removePriceLine(this._previewLine); } catch (_) { /* gone */ }
            }
            this._previewLine = null;
            this._previewPrice = NaN;
            this._previewType = null;
        }

        _fireOrder(price, anchor) {
            if (typeof this.onOrder !== 'function') return;
            const side = this._toolMode === 'buy' ? 1 : -1;
            const priceType = this._effectiveType(side, price);
            const volume = this._readQty();
            const decimals = this._host?.knownDecimals ?? 2;
            const sideText = side === 1 ? 'BUY' : 'SELL';
            // Market ignores the drop price (submitOrder sends no limit/stop price).
            const orderPrice = priceType === 'market' ? null : price;
            const label = priceType === 'market'
                ? `${sideText} MARKET`
                : `${sideText} ${priceType.toUpperCase()} @ ${Number(price).toFixed(decimals)}`;
            try {
                this.onOrder({ side, priceType, price: orderPrice, volume, anchor, label });
            } catch (err) {
                console.error('[DragOrder] onOrder failed:', err);
            }
        }

        _readQty() {
            const el = document.getElementById(QTY_INPUT_ID);
            const n = parseInt(el?.value, 10);
            return Number.isFinite(n) && n > 0 ? n : 1;
        }

        // ================================================================
        // Bracket setup mode
        // ================================================================

        _enterSetup(entry, anchor) {
            if (!this._series || !this._chart) return;
            const side = this._toolMode === 'buy' ? 1 : -1;
            const priceType = this._inferType(side, entry);
            const qty = this._readQty();
            const decimals = this._host?.knownDecimals ?? 2;
            const tick = this._tickSize();
            const pointValue = this._pointValue();
            const offset = Number.isFinite(tick) && tick > 0
                ? tick * DEFAULT_OFFSET_TICKS
                : entry * 0.0005;

            // Side-aware defaults: TP in the favorable direction, SL opposite.
            const tp = side === 1 ? entry + offset : entry - offset;
            const sl = side === 1 ? entry - offset : entry + offset;

            // Time window for the shaded zones. Anchored to the REAL current
            // candle (not Date.now) so the band begins right next to it, and it
            // extends forward so the box reads as "from entry onward".
            const intervalSec = Math.max(1, Math.round((this._host?.intervalMs ?? 60000) / 1000));
            const lastBarTime = this._lastBarTime();
            const tStart = lastBarTime;
            const tEnd = lastBarTime + intervalSec * ZONE_FORWARD_BARS;

            this._setup = {
                side, entry, priceType, tp, sl, qty, decimals, pointValue,
                tStart, tEnd, anchor,
                entryLine: null, tpLine: null, slLine: null,
                tpFill: null, slFill: null,
                tpBadge: null, slBadge: null,
                confirmBar: null
            };

            this._renderSetup();
            this._applySetupViewport();
            this._startBadgeLoop();
            this._emitStateChange();
        }

        // Number of candles currently on the chart. Prefers the live series data
        // (reflects intraday updates) and falls back to the host's history.
        _candleCount() {
            try {
                if (typeof this._series.data === 'function') {
                    const d = this._series.data();
                    if (Array.isArray(d)) return d.length;
                }
            } catch (_) { /* fall through */ }
            const hb = this._host && this._host._historyBars;
            return Array.isArray(hb) ? hb.length : 0;
        }

        // Time (UTC seconds) of the most recent candle — the anchor for the zone
        // band so it begins right next to the current candle.
        _lastBarTime() {
            try {
                if (typeof this._series.data === 'function') {
                    const d = this._series.data();
                    if (d && d.length) return d[d.length - 1].time;
                }
            } catch (_) { /* fall through */ }
            const hb = this._host && this._host._historyBars;
            if (Array.isArray(hb) && hb.length) return hb[hb.length - 1].time;
            return Math.floor(Date.now() / 1000);
        }

        // Unpins the right edge, frees pan/zoom, and frames the bracket by
        // logical bar index so the chart zooms IN on the current candle and the
        // whitespace to its right (where the zone band sits). The original
        // time-scale shape is stashed in _savedTimeScale and unwound by
        // _restoreViewport().
        _applySetupViewport() {
            const s = this._setup;
            if (!s || !this._chart) return;
            const ts = this._chart.timeScale();

            // Save the current pinned-right-edge shape so we can restore it.
            try {
                const opts = ts.options();
                this._savedTimeScale = {
                    rightOffset: opts.rightOffset,
                    fixRightEdge: opts.fixRightEdge
                };
            } catch (_) {
                this._savedTimeScale = { rightOffset: 0, fixRightEdge: false };
            }

            // Unpin the right edge. The zone series now provides the forward
            // bars itself (see _setZoneData), so we leave no extra trailing
            // offset — otherwise the offset would be measured from the zone's
            // far end and shove the view past it.
            try {
                ts.applyOptions({ fixRightEdge: false, rightOffset: 0 });
            } catch (_) { /* older builds — ignore */ }

            // Re-enable pan/zoom during setup so the user can give themselves
            // more room. Entry placement is already done; only edge-grabs
            // remain, and those are explicitly hit-tested in _onPointerDown
            // before any native pan would start.
            try {
                this._chart.applyOptions({ handleScroll: true, handleScale: true });
            } catch (_) { /* ignore */ }

            // One-shot auto-frame, by LOGICAL bar index so the far-future zone
            // points can't distort it. Shows the last SETUP_VIEW_LOOKBACK
            // candles for context, the current candle, and SETUP_VIEW_FORWARD
            // whitespace bars to the right (filled by the zone band) where the
            // user drafts. Zoomed in, never out. Set once — we don't re-assert
            // on edge drags, leaving the user in control.
            const n = this._candleCount();
            if (n > 0) {
                const last = n - 1;
                try {
                    ts.setVisibleLogicalRange({
                        from: last - SETUP_VIEW_LOOKBACK,
                        to: last + SETUP_VIEW_FORWARD
                    });
                } catch (_) { /* non-fatal */ }
            }
        }

        // Restores the pinned right edge / offset saved by _applySetupViewport
        // and returns to armed entry-drag behavior (pan/zoom disabled). When
        // called as part of cancelTool/detach, _disarmChart restores the real
        // scroll/scale state afterward, so the re-disable here is harmless.
        _restoreViewport() {
            if (!this._chart) { this._savedTimeScale = null; return; }
            if (this._savedTimeScale) {
                try {
                    this._chart.timeScale().applyOptions({
                        fixRightEdge: this._savedTimeScale.fixRightEdge,
                        rightOffset: this._savedTimeScale.rightOffset
                    });
                } catch (_) { /* ignore */ }
                this._savedTimeScale = null;
            }
            if (this._toolMode) {
                try {
                    this._chart.applyOptions({ handleScroll: false, handleScale: false });
                } catch (_) { /* ignore */ }
            }
        }

        _exitSetup(/* canceled */) {
            if (!this._setup) return;
            this._stopBadgeLoop();
            this._restoreViewport();
            const s = this._setup;
            const removeLine = (l) => {
                if (l && this._series) {
                    try { this._series.removePriceLine(l); } catch (_) { /* gone */ }
                }
            };
            const removeSeries = (sx) => {
                if (sx && this._chart) {
                    try { this._chart.removeSeries(sx); } catch (_) { /* gone */ }
                }
            };
            removeLine(s.entryLine);
            removeLine(s.tpLine);
            removeLine(s.slLine);
            removeSeries(s.tpFill);
            removeSeries(s.slFill);
            if (s.tpBadge?.parentNode) s.tpBadge.parentNode.removeChild(s.tpBadge);
            if (s.slBadge?.parentNode) s.slBadge.parentNode.removeChild(s.slBadge);
            if (s.confirmBar?.parentNode) s.confirmBar.parentNode.removeChild(s.confirmBar);
            this._container?.classList.remove('chart-bracket-edge-hover');
            this._setup = null;
            this._edgeDrag = null;
            // Zone series (which extended the data forward) are now gone, so
            // return to the live right-edge view. Logical-range framing does not
            // auto-undo, so do it explicitly.
            try { this._chart?.timeScale()?.scrollToRealTime(); } catch (_) { /* ignore */ }
            this._emitStateChange();
        }

        _renderSetup() {
            const s = this._setup;
            if (!s || !this._series || !this._chart) return;

            const LS = global.LightweightCharts?.LineStyle;
            const dashed = LS?.Dashed ?? 2;
            const solid = LS?.Solid ?? 0;
            const tpColor = '#26a69a';
            const slColor = '#ef5350';
            const entryColor = '#f0b90b';

            // Entry: full-width dashed line, just a marker.
            s.entryLine = this._series.createPriceLine({
                price: s.entry,
                color: entryColor,
                lineWidth: 1,
                lineStyle: dashed,
                axisLabelVisible: true,
                title: `Entry ${this._fmt(s.entry)}`
            });

            // TP and SL: full-width solid lines that the user grabs.
            s.tpLine = this._series.createPriceLine({
                price: s.tp,
                color: tpColor,
                lineWidth: 2,
                lineStyle: solid,
                axisLabelVisible: true,
                title: `TP ${this._fmt(s.tp)}`
            });
            s.slLine = this._series.createPriceLine({
                price: s.sl,
                color: slColor,
                lineWidth: 2,
                lineStyle: solid,
                axisLabelVisible: true,
                title: `SL ${this._fmt(s.sl)}`
            });

            // Shaded zones via baseline series (entry as the base). Both
            // top and bottom fills are set to the same translucent color so
            // the zone reads correctly whether TP/SL is above or below entry.
            if (typeof this._chart.addBaselineSeries === 'function') {
                s.tpFill = this._mkZoneSeries(tpColor, 'rgba(38, 166, 154, 0.18)', s.entry);
                this._setZoneData(s.tpFill, s.tp, s.tStart, s.tEnd);

                s.slFill = this._mkZoneSeries(slColor, 'rgba(239, 83, 80, 0.18)', s.entry);
                this._setZoneData(s.slFill, s.sl, s.tStart, s.tEnd);
            }

            // DOM badges + confirm bar in the chart container.
            s.tpBadge = this._mkBadge('cbb-tp');
            s.slBadge = this._mkBadge('cbb-sl');
            s.confirmBar = this._mkConfirmBar();
            this._container.appendChild(s.tpBadge);
            this._container.appendChild(s.slBadge);
            this._container.appendChild(s.confirmBar);

            this._updateBadgesText();
            this._repositionBadges();
        }

        _mkZoneSeries(lineColor, fillColor, baseValue) {
            return this._chart.addBaselineSeries({
                baseValue: { type: 'price', price: baseValue },
                topFillColor1: fillColor,
                topFillColor2: fillColor,
                bottomFillColor1: fillColor,
                bottomFillColor2: fillColor,
                topLineColor: 'rgba(0,0,0,0)',
                bottomLineColor: 'rgba(0,0,0,0)',
                lineWidth: 0,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false
            });
        }

        // One point per bar interval from tStart to tEnd, so the band fills a
        // run of real, evenly-spaced logical bars to the right of the current
        // candle instead of collapsing the whole gap into a single logical bar
        // (which would distort the time axis and the framing).
        _setZoneData(series, top, tStart, tEnd) {
            if (!series) return;
            const intervalSec = Math.max(1, Math.round((this._host?.intervalMs ?? 60000) / 1000));
            const pts = [];
            for (let t = tStart; t <= tEnd; t += intervalSec) pts.push({ time: t, value: top });
            if (pts.length < 2) pts.push({ time: tStart + intervalSec, value: top });
            try {
                series.setData(pts);
            } catch (err) { /* time outside range — non-fatal */ }
        }

        _mkBadge(extraClass) {
            const el = document.createElement('div');
            el.className = `chart-bracket-badge ${extraClass}`;
            return el;
        }

        _mkConfirmBar() {
            const s = this._setup;
            const sideText = s.side === 1 ? 'BUY' : 'SELL';
            const sideCls = s.side === 1 ? 'cbc-buy' : 'cbc-sell';

            const bar = document.createElement('div');
            bar.className = 'chart-bracket-confirm';

            const label = document.createElement('span');
            label.className = 'cbc-label';
            label.textContent = `${sideText} ${s.priceType.toUpperCase()} @ ${this._fmt(s.entry)} \u00d7 ${s.qty}`;

            const submit = document.createElement('button');
            submit.type = 'button';
            submit.className = `cbc-btn cbc-submit ${sideCls}`;
            submit.textContent = 'Submit Bracket';
            submit.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._submitBracket();
            });

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'cbc-btn cbc-cancel';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._exitSetup(true);
            });

            bar.appendChild(label);
            bar.appendChild(submit);
            bar.appendChild(cancel);
            // Don't let pointerdown on the bar reach the chart's drag handler.
            bar.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
            return bar;
        }

        // ---------- edge drag --------------------------------------------
        _hitTestEdge(yPx) {
            if (!this._series) return null;
            // OCO build: two independent leg lines.
            if (this._oco) {
                const y1 = this._series.priceToCoordinate(this._oco.leg1);
                const y2 = this._series.priceToCoordinate(this._oco.leg2);
                const d1 = y1 != null ? Math.abs(y1 - yPx) : Infinity;
                const d2 = y2 != null ? Math.abs(y2 - yPx) : Infinity;
                if (Math.min(d1, d2) > EDGE_HIT_PX) return null;
                return d1 <= d2 ? 'leg1' : 'leg2';
            }
            const s = this._setup;
            if (!s) return null;
            const yTp = this._series.priceToCoordinate(s.tp);
            const ySl = this._series.priceToCoordinate(s.sl);
            const dTp = yTp != null ? Math.abs(yTp - yPx) : Infinity;
            const dSl = ySl != null ? Math.abs(ySl - yPx) : Infinity;
            const best = Math.min(dTp, dSl);
            if (best > EDGE_HIT_PX) return null;
            return dTp <= dSl ? 'tp' : 'sl';
        }

        _updateEdge(which, rawPrice) {
            // OCO leg lines move freely (no entry-relative clamping); each just
            // snaps to tick and relabels with its side + inferred type.
            if (this._oco) {
                this._updateOcoLeg(which, rawPrice);
                return;
            }
            const s = this._setup;
            if (!s) return;
            const tick = this._tickSize();
            const minStep = Number.isFinite(tick) && tick > 0 ? tick : Math.pow(10, -(s.decimals || 2));

            // Clamp each edge to the correct side of entry.
            let price = rawPrice;
            if (which === 'tp') {
                if (s.side === 1) price = Math.max(price, s.entry + minStep);
                else price = Math.min(price, s.entry - minStep);
                s.tp = price;
                s.tpLine?.applyOptions({ price, title: `TP ${this._fmt(price)}` });
                this._setZoneData(s.tpFill, price, s.tStart, s.tEnd);
            } else {
                if (s.side === 1) price = Math.min(price, s.entry - minStep);
                else price = Math.max(price, s.entry + minStep);
                s.sl = price;
                s.slLine?.applyOptions({ price, title: `SL ${this._fmt(price)}` });
                this._setZoneData(s.slFill, price, s.tStart, s.tEnd);
            }
            this._updateBadgesText();
            this._repositionBadges();
        }

        // ---------- badges & loop ----------------------------------------
        _startBadgeLoop() {
            if (this._setupRaf) return;
            const tick = () => {
                this._setupRaf = 0;
                if (!this._setup) return;
                this._repositionBadges();
                this._setupRaf = (global.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(tick);
            };
            this._setupRaf = (global.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(tick);
        }

        _stopBadgeLoop() {
            if (!this._setupRaf) return;
            (global.cancelAnimationFrame || clearTimeout)(this._setupRaf);
            this._setupRaf = 0;
        }

        _tickBadges() { /* placeholder — replaced by closure in _startBadgeLoop */ }

        _updateBadgesText() {
            const s = this._setup;
            if (!s) return;
            const reward = this._dollars(s.tp, s.entry, s.qty);
            const risk = this._dollars(s.entry, s.sl, s.qty);
            const rr = (Number.isFinite(reward) && Number.isFinite(risk) && risk > 0)
                ? (reward / risk).toFixed(2)
                : '—';
            const rewardText = Number.isFinite(reward) ? `+$${reward.toFixed(2)}` : '+$—';
            const riskText = Number.isFinite(risk) ? `-$${risk.toFixed(2)}` : '-$—';
            if (s.tpBadge) s.tpBadge.textContent = `TP ${this._fmt(s.tp)}  ${rewardText}  R:R ${rr}`;
            if (s.slBadge) s.slBadge.textContent = `SL ${this._fmt(s.sl)}  ${riskText}`;
        }

        _repositionBadges() {
            const s = this._setup;
            if (!s || !this._series || !this._container) return;
            const place = (badge, price, anchorPrice) => {
                if (!badge) return;
                const y = this._series.priceToCoordinate((price + anchorPrice) / 2);
                if (y == null) { badge.style.display = 'none'; return; }
                badge.style.display = '';
                // Right-aligned via CSS; vertical-centered on the y midpoint.
                badge.style.top = `${y - badge.offsetHeight / 2}px`;
            };
            place(s.tpBadge, s.tp, s.entry);
            place(s.slBadge, s.sl, s.entry);
        }

        // ---------- submit ------------------------------------------------
        _submitBracket() {
            const s = this._setup;
            if (!s) return;
            if (typeof this.onOrder !== 'function') return;
            const sideText = s.side === 1 ? 'BUY' : 'SELL';
            const label = `${sideText} ${s.priceType.toUpperCase()} @ ${this._fmt(s.entry)} ` +
                `[TP ${this._fmt(s.tp)} / SL ${this._fmt(s.sl)}]`;
            const intent = {
                side: s.side,
                priceType: s.priceType,
                price: s.entry,
                volume: s.qty,
                takeProfitPrice: s.tp,
                stopLossPrice: s.sl,
                isBracket: true,
                anchor: s.anchor,
                label
            };
            // Tear down BEFORE firing so a Submit handler that hits the API
            // doesn't race the next pointer event into a half-cleaned setup.
            this._exitSetup(false);
            try {
                this.onOrder(intent);
            } catch (err) {
                console.error('[DragOrder] bracket onOrder failed:', err);
            }
        }

        // ================================================================
        // OCO setup mode (two independent, simultaneously-working legs)
        // ================================================================

        _enterOcoSetup(dropPrice, anchor) {
            if (!this._series || !this._chart) return;
            if (this._oco) this._exitOco(true);
            const side = this._toolMode === 'buy' ? 1 : -1;
            const qty = this._readQty();
            const decimals = this._host?.knownDecimals ?? 2;
            const tick = this._tickSize();
            const offset = Number.isFinite(tick) && tick > 0
                ? tick * DEFAULT_OFFSET_TICKS
                : dropPrice * 0.0005;

            // Leg 1 at the drop; leg 2 a few ticks below it so both lines are
            // visible and grabbable right away. Each is freely draggable after.
            this._oco = {
                side, leg1: dropPrice, leg2: dropPrice - offset, qty, decimals,
                anchor, leg1Line: null, leg2Line: null, confirmBar: null, labelEl: null
            };
            this._renderOco();
            this._emitStateChange();
        }

        _renderOco() {
            const o = this._oco;
            if (!o || !this._series || !this._chart) return;
            const LS = global.LightweightCharts?.LineStyle;
            const solid = LS?.Solid ?? 0;
            const color = o.side === 1 ? '#26a69a' : '#ef5350';

            o.leg1Line = this._series.createPriceLine({
                price: o.leg1, color, lineWidth: 2, lineStyle: solid,
                axisLabelVisible: true, title: this._ocoLegLabel(o.leg1)
            });
            o.leg2Line = this._series.createPriceLine({
                price: o.leg2, color, lineWidth: 2, lineStyle: solid,
                axisLabelVisible: true, title: this._ocoLegLabel(o.leg2)
            });

            o.confirmBar = this._mkOcoConfirmBar();
            this._container.appendChild(o.confirmBar);
        }

        _ocoLegLabel(price) {
            const o = this._oco;
            const sideText = o.side === 1 ? 'BUY' : 'SELL';
            const type = this._inferType(o.side, price).toUpperCase();
            return `${sideText} ${type} @ ${this._fmt(price)}`;
        }

        _ocoConfirmText() {
            const o = this._oco;
            const sideText = o.side === 1 ? 'BUY' : 'SELL';
            const t1 = this._inferType(o.side, o.leg1).toUpperCase();
            const t2 = this._inferType(o.side, o.leg2).toUpperCase();
            return `OCO ${sideText} × ${o.qty}:  ${t1} @ ${this._fmt(o.leg1)}  /  ${t2} @ ${this._fmt(o.leg2)}`;
        }

        _updateOcoConfirmText() {
            if (this._oco?.labelEl) this._oco.labelEl.textContent = this._ocoConfirmText();
        }

        _mkOcoConfirmBar() {
            const o = this._oco;
            const sideCls = o.side === 1 ? 'cbc-buy' : 'cbc-sell';

            const bar = document.createElement('div');
            bar.className = 'chart-bracket-confirm';

            const label = document.createElement('span');
            label.className = 'cbc-label';
            label.textContent = this._ocoConfirmText();
            o.labelEl = label;

            const submit = document.createElement('button');
            submit.type = 'button';
            submit.className = `cbc-btn cbc-submit ${sideCls}`;
            submit.textContent = 'Submit OCO';
            submit.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._submitOco();
            });

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'cbc-btn cbc-cancel';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._exitOco(true);
            });

            bar.appendChild(label);
            bar.appendChild(submit);
            bar.appendChild(cancel);
            // Keep pointerdown on the bar from reaching the chart drag handler.
            bar.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
            return bar;
        }

        _updateOcoLeg(which, rawPrice) {
            const o = this._oco;
            if (!o) return;
            // rawPrice is already tick-snapped by _edgePriceFromEvent.
            if (which === 'leg1') {
                o.leg1 = rawPrice;
                o.leg1Line?.applyOptions({ price: rawPrice, title: this._ocoLegLabel(rawPrice) });
            } else {
                o.leg2 = rawPrice;
                o.leg2Line?.applyOptions({ price: rawPrice, title: this._ocoLegLabel(rawPrice) });
            }
            this._updateOcoConfirmText();
        }

        _submitOco() {
            const o = this._oco;
            if (!o) return;
            if (typeof this.onOrder !== 'function') { this._exitOco(true); return; }
            const legs = [o.leg1, o.leg2].map(p => ({
                side: o.side,
                priceType: this._inferType(o.side, p),
                price: p,
                volume: o.qty
            }));
            const label = this._ocoConfirmText();
            const anchor = o.anchor;
            // Tear down BEFORE firing so a handler that hits the API doesn't race
            // the next pointer event into a half-cleaned setup (mirrors bracket).
            this._exitOco(false);
            try {
                this.onOrder({ isOco: true, legs, anchor, label });
            } catch (err) {
                console.error('[DragOrder] OCO onOrder failed:', err);
            }
        }

        _exitOco(/* canceled */) {
            if (!this._oco) return;
            const o = this._oco;
            if (o.leg1Line && this._series) { try { this._series.removePriceLine(o.leg1Line); } catch (_) { /* gone */ } }
            if (o.leg2Line && this._series) { try { this._series.removePriceLine(o.leg2Line); } catch (_) { /* gone */ } }
            if (o.confirmBar?.parentNode) o.confirmBar.parentNode.removeChild(o.confirmBar);
            this._container?.classList.remove('chart-bracket-edge-hover');
            this._oco = null;
            this._edgeDrag = null;
            this._emitStateChange();
        }

        // ---------- math helpers -----------------------------------------
        _tickSize() {
            const id = this._host?.activeMarketId;
            const details = id ? this._client?.getMarketDetails?.(id) : null;
            const raw = details?.minPriceIncrement?.value;
            const n = raw == null ? NaN : Number(raw);
            return Number.isFinite(n) ? n : NaN;
        }

        _pointValue() {
            const id = this._host?.activeMarketId;
            const details = id ? this._client?.getMarketDetails?.(id) : null;
            const raw = details?.pointValue?.value;
            const n = raw == null ? NaN : Number(raw);
            return Number.isFinite(n) ? n : NaN;
        }

        _dollars(a, b, qty) {
            const pv = this._pointValue();
            if (!Number.isFinite(pv) || !Number.isFinite(a) || !Number.isFinite(b)) return NaN;
            return Math.abs(a - b) * pv * (qty || 1);
        }

        _fmt(price) {
            const d = this._setup?.decimals ?? this._host?.knownDecimals ?? 2;
            return Number(price).toFixed(d);
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.DragOrder = DragOrderFeature;
})(window);
