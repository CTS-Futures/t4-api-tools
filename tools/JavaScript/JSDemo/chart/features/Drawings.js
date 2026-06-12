/**
 * chart/features/Drawings.js
 *
 * Feature module for user drawings (trendlines, fib retracement).
 *
 * Approach (Lightweight Charts v4.1, no primitives API):
 *   - Trendline: a 2-point LineSeries with the user's anchor points.
 *   - Fib:      a set of horizontal price lines on the candle series, one per
 *               level between the two anchor prices.
 *
 * Placement protocol (driven by DrawingToolbar):
 *   1. host.getFeature('drawings').beginTool('trendline' | 'fib')
 *   2. User clicks the chart twice; on the second click the drawing is created
 *      and tool mode exits.
 *
 * Drawings are keyed per-marketId so they hide/show on symbol switch.
 * State is exposed via serialize()/load() for persistence.
 */
(function (global) {
    'use strict';

    const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const FIB_COLORS = {
        0: '#888888',
        0.236: '#42a5f5',
        0.382: '#26a69a',
        0.5: '#fbc02d',
        0.618: '#ab47bc',
        0.786: '#ef5350',
        1: '#888888'
    };

    let _seq = 0;
    function nextId(type) { _seq++; return `${type}-${Date.now()}-${_seq}`; }

    class DrawingsFeature {
        constructor() {
            this.id = 'drawings';
            this._chart = null;
            this._candleSeries = null;
            this._host = null;
            this._unsubSymbol = null;
            this._unsubClick = null;

            // marketId -> Map<drawingId, drawing>
            // drawing: { id, type, points: [{time,price},{time,price}],
            //            rendered: { series?: LineSeries, priceLines?: [PriceLine] } }
            this._byMarket = new Map();

            this._toolMode = null;       // null | 'trendline' | 'fib'
            this._toolFirstPoint = null; // { time, price }
            this._onToolChange = null;   // callback set by UI
            this._onChange = null;       // callback set by UI for persistence
        }

        attach(ctx) {
            this._chart = ctx.chart;
            this._candleSeries = ctx.candleSeries;
            this._host = ctx.host;
            // Hide all drawings on symbol switch (they're stored per-market so
            // they reappear when the user switches back).
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => this._renderActive());
        }

        detach() {
            if (this._unsubSymbol) this._unsubSymbol();
            this._cancelTool();
            for (const list of this._byMarket.values()) {
                for (const d of list.values()) this._destroyRender(d);
            }
            this._byMarket.clear();
            this._chart = null;
            this._candleSeries = null;
        }

        setCallbacks({ onToolChange, onChange } = {}) {
            this._onToolChange = onToolChange || null;
            this._onChange = onChange || null;
        }

        // Tool mode is driven by toolbar buttons. While active, the next two
        // chart clicks place a drawing. ChartService routes clicks through
        // host._onChartClick; we hook into the public price-click via the
        // host's onPriceLevelClick layer (see index.html wire-up). To keep
        // this feature decoupled, the toolbar passes clicks via handleClick().
        beginTool(type) {
            if (type !== 'trendline' && type !== 'fib' && type !== 'box') return;
            this._toolMode = type;
            this._toolFirstPoint = null;
            if (this._onToolChange) this._onToolChange(this._toolMode);
        }

        cancelTool() { this._cancelTool(); }

        _cancelTool() {
            this._toolMode = null;
            this._toolFirstPoint = null;
            if (this._onToolChange) this._onToolChange(null);
        }

        // Called by the host when the user clicks an empty area. Returns true
        // if the click was consumed by the active tool.
        handleClick({ time, price }) {
            if (!this._toolMode) return false;
            if (!Number.isFinite(price)) return true; // still consumed (cancel)
            // Use the latest known bar time when click param has no time (e.g.
            // click on the latest forming bar where time can be undefined).
            const safeTime = Number.isFinite(time) ? time : Math.floor(Date.now() / 1000);
            if (!this._toolFirstPoint) {
                this._toolFirstPoint = { time: safeTime, price };
                return true;
            }
            const a = this._toolFirstPoint;
            const b = { time: safeTime, price };
            this._addDrawing(this._toolMode, [a, b]);
            this._cancelTool();
            return true;
        }

        _addDrawing(type, points, idOverride) {
            const marketId = this._host?.activeMarketId;
            if (!marketId) return null;
            const id = idOverride || nextId(type);
            const drawing = { id, type, points, rendered: null };
            let list = this._byMarket.get(marketId);
            if (!list) {
                list = new Map();
                this._byMarket.set(marketId, list);
            }
            list.set(id, drawing);
            this._renderOne(drawing);
            if (this._onChange) this._onChange(this.serialize());
            return id;
        }

        removeDrawing(id) {
            const marketId = this._host?.activeMarketId;
            const list = marketId ? this._byMarket.get(marketId) : null;
            if (!list) return;
            const d = list.get(id);
            if (!d) return;
            this._destroyRender(d);
            list.delete(id);
            if (this._onChange) this._onChange(this.serialize());
        }

        clearActive() {
            const marketId = this._host?.activeMarketId;
            const list = marketId ? this._byMarket.get(marketId) : null;
            if (!list) return;
            for (const d of list.values()) this._destroyRender(d);
            list.clear();
            if (this._onChange) this._onChange(this.serialize());
        }

        listActive() {
            const marketId = this._host?.activeMarketId;
            const list = marketId ? this._byMarket.get(marketId) : null;
            if (!list) return [];
            return Array.from(list.values()).map(d => ({ id: d.id, type: d.type, points: d.points }));
        }

        serialize() {
            // Returns drawings for the active market only (persistence is
            // per-symbol; the LayoutStore stores under the symbol key).
            return this.listActive();
        }

        // Replace active-market drawings from a saved list.
        load(list) {
            this.clearActive();
            for (const spec of (list || [])) {
                if (!spec || !Array.isArray(spec.points) || spec.points.length !== 2) continue;
                this._addDrawing(spec.type, spec.points, spec.id);
            }
        }

        _renderActive() {
            // Destroy & recreate to refresh on symbol change (drawings for
            // the new market only).
            const marketId = this._host?.activeMarketId;
            if (!marketId) return;
            const list = this._byMarket.get(marketId);
            if (!list) return;
            for (const d of list.values()) {
                this._destroyRender(d);
                this._renderOne(d);
            }
        }

        _renderOne(d) {
            if (!this._chart || !this._candleSeries) return;
            if (d.type === 'trendline') this._renderTrendline(d);
            else if (d.type === 'fib') this._renderFib(d);
            else if (d.type === 'box') this._renderBox(d);
        }

        _renderTrendline(d) {
            const [p1, p2] = d.points;
            const series = this._chart.addLineSeries({
                color: '#42a5f5',
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false
            });
            const data = [
                { time: Math.min(p1.time, p2.time), value: p1.time <= p2.time ? p1.price : p2.price },
                { time: Math.max(p1.time, p2.time), value: p1.time <= p2.time ? p2.price : p1.price }
            ];
            try { series.setData(data); } catch (err) { console.error(err); }
            d.rendered = { series };
        }

        _renderFib(d) {
            const [p1, p2] = d.points;
            const hi = Math.max(p1.price, p2.price);
            const lo = Math.min(p1.price, p2.price);
            const range = hi - lo;
            const LS = global.LightweightCharts?.LineStyle;
            const dotted = LS?.Dotted ?? 1;
            const priceLines = [];
            for (const lv of FIB_LEVELS) {
                const price = hi - range * lv;
                const line = this._candleSeries.createPriceLine({
                    price,
                    color: FIB_COLORS[lv] || '#888',
                    lineWidth: 1,
                    lineStyle: dotted,
                    axisLabelVisible: true,
                    title: `${(lv * 100).toFixed(1)}%`
                });
                priceLines.push(line);
            }
            d.rendered = { priceLines };
        }

        // Box (rectangle) — two corner points define a price-bounded,
        // time-bounded region. Rendered as a translucent baseline-series
        // fill between the top and bottom prices, plus thin top/bottom
        // outline line series. Lightweight Charts v4 has no primitives API,
        // so vertical edges are omitted; the fill + horizontal borders read
        // as a rectangle the way traditional charting tools display zones
        // (e.g. supply/demand or order blocks).
        _renderBox(d) {
            const [p1, p2] = d.points;
            const hi = Math.max(p1.price, p2.price);
            const lo = Math.min(p1.price, p2.price);
            const tStart = Math.min(p1.time, p2.time);
            const tEnd = Math.max(p1.time, p2.time);
            if (tStart === tEnd) return;

            const color = '#42a5f5';
            const fillTop = 'rgba(66, 165, 245, 0.20)';
            const fillBot = 'rgba(66, 165, 245, 0.05)';
            const border = 'rgba(66, 165, 245, 0.85)';

            const series = [];

            // Fill via baseline series: line at hi, baseValue at lo. Only two
            // data points so the fill is bounded to [tStart, tEnd].
            if (typeof this._chart.addBaselineSeries === 'function') {
                const fill = this._chart.addBaselineSeries({
                    baseValue: { type: 'price', price: lo },
                    topFillColor1: fillTop,
                    topFillColor2: fillBot,
                    bottomFillColor1: fillTop,
                    bottomFillColor2: fillBot,
                    topLineColor: 'rgba(0,0,0,0)',
                    bottomLineColor: 'rgba(0,0,0,0)',
                    lineWidth: 0,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
                try {
                    fill.setData([
                        { time: tStart, value: hi },
                        { time: tEnd, value: hi }
                    ]);
                } catch (err) { console.error(err); }
                series.push(fill);
            }

            const mkBorder = (price) => {
                const s = this._chart.addLineSeries({
                    color: border,
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
                try {
                    s.setData([
                        { time: tStart, value: price },
                        { time: tEnd, value: price }
                    ]);
                } catch (err) { console.error(err); }
                return s;
            };
            series.push(mkBorder(hi));
            series.push(mkBorder(lo));

            d.rendered = { seriesList: series, color };
        }

        _destroyRender(d) {
            if (!d || !d.rendered) return;
            if (d.rendered.series && this._chart) {
                try { this._chart.removeSeries(d.rendered.series); } catch (_) { /* gone */ }
            }
            if (d.rendered.seriesList && this._chart) {
                for (const s of d.rendered.seriesList) {
                    try { this._chart.removeSeries(s); } catch (_) { /* gone */ }
                }
            }
            if (d.rendered.priceLines && this._candleSeries) {
                for (const pl of d.rendered.priceLines) {
                    try { this._candleSeries.removePriceLine(pl); } catch (_) { /* gone */ }
                }
            }
            d.rendered = null;
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.Drawings = DrawingsFeature;
})(window);
