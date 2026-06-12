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
    const FORWARD_BARS = 200;        // how many bars the zone extends to the right
    const BACKWARD_BARS = 5;         // and how many it starts before "now"

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
            this._edgeDrag = null;       // null | 'tp' | 'sl'
            this._setupRaf = 0;

            // Chart scroll/scale options to restore on disarm.
            this._savedHandle = null;

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

        // ---------- arm / disarm -----------------------------------------
        beginTool(mode) {
            if (mode !== 'buy' && mode !== 'sell') return;
            if (this._toolMode === mode) return;
            // Switching mode mid-flight: clean current drag + setup first.
            this._exitSetup(true);
            this._endDrag(true);
            this._toolMode = mode;
            this._armChart();
            this._emitToolChange();
        }

        cancelTool() {
            if (!this._toolMode) return;
            this._exitSetup(true);
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
                const state = this._setup ? 'setup' : (this._toolMode ? 'armed' : 'idle');
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
                else this.cancelTool();
                return;
            }
            if (e.button !== 0) return;

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
                const price = this._priceFromEvent(e);
                if (!Number.isFinite(price)) return;
                this._updateEdge(this._edgeDrag, price);
                return;
            }
            // Hover feedback over an edge while in setup: ns-resize cursor.
            if (this._setup && !this._dragging) {
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

            if (this._bracketMode) {
                this._enterSetup(price, anchor);
            } else {
                this._fireOrder(price, anchor);
            }
        }

        _onKeyDown(e) {
            if (e.key !== 'Escape') return;
            if (this._edgeDrag) {
                this._edgeDrag = null;
                this._activePointerId = null;
                return;
            }
            if (this._setup) {
                this._exitSetup(true);
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

        _updatePreview(price) {
            if (!this._series) return;
            const side = this._toolMode === 'buy' ? 1 : -1;
            const type = this._inferType(side, price);
            const color = side === 1 ? '#26a69a' : '#ef5350';
            const decimals = this._host?.knownDecimals ?? 2;
            const sideText = side === 1 ? 'BUY' : 'SELL';
            const title = `${sideText} ${type.toUpperCase()} @ ${Number(price).toFixed(decimals)}`;

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
            const priceType = this._inferType(side, price);
            const volume = this._readQty();
            const decimals = this._host?.knownDecimals ?? 2;
            const sideText = side === 1 ? 'BUY' : 'SELL';
            const label = `${sideText} ${priceType.toUpperCase()} @ ${Number(price).toFixed(decimals)}`;
            try {
                this.onOrder({ side, priceType, price, volume, anchor, label });
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

            // Time window for the shaded zones. We extend well into the
            // future so the box reads as "from entry onward". The chart will
            // clip / extend visually based on its own time scale.
            const intervalSec = Math.max(1, (this._host?.intervalMs ?? 60000) / 1000);
            const nowSec = Math.floor(Date.now() / 1000);
            const tStart = nowSec - intervalSec * BACKWARD_BARS;
            const tEnd = nowSec + intervalSec * FORWARD_BARS;

            this._setup = {
                side, entry, priceType, tp, sl, qty, decimals, pointValue,
                tStart, tEnd, anchor,
                entryLine: null, tpLine: null, slLine: null,
                tpFill: null, slFill: null,
                tpBadge: null, slBadge: null,
                confirmBar: null
            };

            this._renderSetup();
            this._startBadgeLoop();
            this._emitStateChange();
        }

        _exitSetup(/* canceled */) {
            if (!this._setup) return;
            this._stopBadgeLoop();
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

        _setZoneData(series, top, tStart, tEnd) {
            if (!series) return;
            try {
                series.setData([
                    { time: tStart, value: top },
                    { time: tEnd, value: top }
                ]);
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
            const s = this._setup;
            if (!s || !this._series) return null;
            const yTp = this._series.priceToCoordinate(s.tp);
            const ySl = this._series.priceToCoordinate(s.sl);
            const dTp = yTp != null ? Math.abs(yTp - yPx) : Infinity;
            const dSl = ySl != null ? Math.abs(ySl - yPx) : Infinity;
            const best = Math.min(dTp, dSl);
            if (best > EDGE_HIT_PX) return null;
            return dTp <= dSl ? 'tp' : 'sl';
        }

        _updateEdge(which, rawPrice) {
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
