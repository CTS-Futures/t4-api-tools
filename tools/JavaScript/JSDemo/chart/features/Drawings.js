/**
 * chart/features/Drawings.js
 *
 * Feature module for user drawings. Rendering + interaction live in the canvas
 * overlay engine (chart/drawings/DrawingsOverlay.js); this feature owns the
 * per-market data model and bridges the host/toolbar to the overlay.
 *
 * Tools (see chart/drawings/DrawingTypes.js): trendline, ray, extended, hline,
 * vline, arrow, box, fib, measure. All are rendered on the overlay so they're
 * uniformly selectable / draggable / reshapeable / deletable, with live preview
 * while placing.
 *
 * Drawings are keyed per-marketId so they hide/show on symbol switch, and the
 * persistence contract is unchanged: serialize() -> [{id,type,points,style}],
 * load(list) rebuilds. (style is new and optional; older saved drawings without
 * it still load and pick up the per-type default.)
 *
 * Public API preserved for ChartService / DrawingToolbar:
 *   attach, detach, setCallbacks, beginTool, cancelTool, clearActive,
 *   removeDrawing, listActive, serialize, load, handleClick
 */
(function (global) {
    'use strict';

    class DrawingsFeature {
        constructor() {
            this.id = 'drawings';
            this._host = null;
            this._bus = null;
            this._overlay = null;
            this._unsubSymbol = null;

            // marketId -> Array<{ id, type, points:[{time,price}], style }>
            this._byMarket = new Map();

            this._onToolChange = null; // UI callback (toolbar active state)
            this._onChange = null;     // UI callback (persistence)
        }

        attach(ctx) {
            this._host = ctx.host;
            this._bus = ctx.bus;

            const OverlayCtor = global.ChartDrawingsOverlay;
            if (!OverlayCtor) {
                console.error('[Drawings] ChartDrawingsOverlay not loaded — check script order');
                return;
            }
            this._overlay = new OverlayCtor({
                chart: ctx.chart,
                series: ctx.candleSeries,
                container: ctx.container,
                host: ctx.host,
                bus: ctx.bus
            });

            // Bridge overlay <-> model.
            this._overlay.onAdd = (drawing) => { this._activeList().push(drawing); };
            this._overlay.onRemove = (id) => {
                const list = this._activeList();
                const i = list.findIndex((d) => d.id === id);
                if (i >= 0) list.splice(i, 1);
            };
            this._overlay.onChange = () => {
                if (this._onChange) this._onChange(this.serialize());
            };
            this._overlay.onToolChange = (tool) => {
                if (this._onToolChange) this._onToolChange(tool);
            };

            this._overlay.mount();
            this._overlay.setActive(this._activeList());

            // Repaint with the new market's drawings on symbol switch. Bars
            // loading / interval changes change coordinates, so redraw on those.
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => {
                this._overlay.setActive(this._activeList());
            });
            this._unsubBars = ctx.bus.on('bars:loaded', () => this._overlay.scheduleRedraw());
            this._unsubInterval = ctx.bus.on('interval:changed', () => this._overlay.scheduleRedraw());
        }

        detach() {
            if (this._unsubSymbol) this._unsubSymbol();
            if (this._unsubBars) this._unsubBars();
            if (this._unsubInterval) this._unsubInterval();
            if (this._overlay) { this._overlay.destroy(); this._overlay = null; }
            this._byMarket.clear();
            this._host = null;
            this._bus = null;
        }

        setCallbacks({ onToolChange, onChange } = {}) {
            this._onToolChange = onToolChange || null;
            this._onChange = onChange || null;
        }

        // ---------- tool control (driven by DrawingToolbar) ----------------
        beginTool(type) {
            if (!global.ChartDrawingTypes?.get(type)) return;
            this._overlay?.armTool(type);
        }

        get _toolMode() { return this._overlay?._tool || null; }

        cancelTool() { this._overlay?.disarm(); }

        clearActive() {
            const list = this._activeList();
            list.length = 0;
            this._overlay?.setActive(list);
            if (this._onChange) this._onChange(this.serialize());
        }

        removeDrawing(id) {
            const list = this._activeList();
            const i = list.findIndex((d) => d.id === id);
            if (i < 0) return;
            list.splice(i, 1);
            this._overlay?.scheduleRedraw();
            if (this._onChange) this._onChange(this.serialize());
        }

        listActive() {
            return this._activeList().map((d) => ({
                id: d.id,
                type: d.type,
                points: d.points.map((p) => ({ time: p.time, price: p.price })),
                style: d.style ? { ...d.style } : undefined
            }));
        }

        serialize() { return this.listActive(); }

        // Replace active-market drawings from a saved list. Tolerates legacy
        // specs (no style; trendline/fib/box) and skips malformed entries.
        load(list) {
            const Types = global.ChartDrawingTypes;
            const out = [];
            for (const spec of (list || [])) {
                if (!spec || !spec.type || !Array.isArray(spec.points)) continue;
                const need = Types?.anchorsFor(spec.type) || 0;
                if (need === 0 || spec.points.length < need) continue;
                const points = spec.points.slice(0, need).map((p) => ({
                    time: Number(p.time),
                    price: Number(p.price)
                }));
                if (points.some((p) => !Number.isFinite(p.time) || !Number.isFinite(p.price))) continue;
                out.push({
                    id: spec.id || `${spec.type}-${Date.now()}-${out.length}`,
                    type: spec.type,
                    points,
                    style: spec.style ? { ...spec.style } : Types.defaultStyle(spec.type)
                });
            }
            const marketId = this._host?.activeMarketId;
            if (marketId) this._byMarket.set(marketId, out);
            this._overlay?.setActive(out);
        }

        // Suppressor only: tells ChartService whether a chart click should be
        // swallowed (tool armed or a drawing selected) instead of triggering
        // quick-trade. Placement/selection happen in the overlay's own pointer
        // handlers, not here.
        handleClick() {
            return !!this._overlay && this._overlay.isBusy();
        }

        // ---------- internal ----------------------------------------------
        _activeList() {
            const marketId = this._host?.activeMarketId;
            if (!marketId) return [];
            let list = this._byMarket.get(marketId);
            if (!list) { list = []; this._byMarket.set(marketId, list); }
            return list;
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.Drawings = DrawingsFeature;
})(window);
