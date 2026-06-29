/**
 * chart/StrategyChart.js
 *
 * "Strategy View" — a second Lightweight Charts instance stacked beneath the
 * main price chart that renders the ACTIVE strategy's own internals so the user
 * can see *why* it traded, in real time (live) or over a backtest:
 *   - the indicator traces the strategy declares (static get plots) — moving
 *     averages, bands, channels on a price scale; oscillators (RSI/MACD) on a
 *     separate scale,
 *   - buy/sell markers at each decision,
 *   - a position-state strip (long/flat) along the bottom.
 *
 * The strategy is the single source of truth: it declares `plots` and emits the
 * matching values via `plot()` in onBar (see algo/strategies/Strategy.js). This
 * module only renders whatever the schema describes, so a new strategy needs no
 * edits here. Styling mirrors Algo.ui.makeEquityChart for a consistent look.
 *
 * Time alignment: the chart uses the same UTC-second timestamps as the main
 * chart, and syncTo() keeps the two time scales panning/zooming in lock-step.
 */
(function (global) {
    'use strict';

    const NS = global.ChartFeatures || (global.ChartFeatures = {});

    // Which Lightweight Charts price scale a declared plot lives on. Price-type
    // traces share the right scale with the faint context close line so they
    // align with price; oscillators get their own overlay scale.
    function scaleIdFor(scale) { return scale === 'osc' ? 'osc' : 'right'; }

    // Build a Lightweight Charts marker from {time, side, kind}. `live` markers
    // are real (this run actually traded) — solid + labelled. `hypo` markers are
    // the would-have-traded decisions over backfilled history — muted, no label,
    // so they read as context not fact. `boundary` marks where live begins.
    function markerFor(m) {
        if (m.kind === 'boundary') {
            return { time: m.time, position: 'aboveBar', color: '#bdbdbd', shape: 'circle', text: 'Live ▸' };
        }
        const hypo = m.kind === 'hypo';
        return m.side === 1
            ? { time: m.time, position: 'belowBar', color: hypo ? 'rgba(38,166,154,0.45)' : '#26a69a', shape: 'arrowUp', text: hypo ? '' : 'Buy' }
            : { time: m.time, position: 'aboveBar', color: hypo ? 'rgba(239,83,80,0.45)' : '#ef5350', shape: 'arrowDown', text: hypo ? '' : 'Sell' };
    }

    class StrategyChart {
        constructor() {
            this.chart = null;
            this._context = null;     // faint close line (price scale, for context)
            this._pos = null;         // position-state step line (bottom strip)
            this._series = new Map(); // plot key -> series api
            this._schema = [];
            this._markers = [];       // [{time, side, kind}]
            this._pendingMarkers = []; // live order sides awaiting the bar that fired them
            this._lastTime = null;
            this._wrapEl = null;
            this._legendEl = null;
            this._syncCleanup = null;
        }

        /**
         * @param {HTMLElement} container  The chart canvas host.
         * @param {Object} [opts]
         * @param {HTMLElement} [opts.wrapEl]    Wrapper toggled by show()/hide().
         * @param {HTMLElement} [opts.legendEl]  Element that receives the legend.
         */
        mount(container, opts = {}) {
            this._wrapEl = opts.wrapEl || null;
            this._legendEl = opts.legendEl || null;
            if (!global.LightweightCharts || !container) return this;

            // Dark theme matching the main price chart it sits beneath.
            this.chart = global.LightweightCharts.createChart(container, {
                autoSize: true,
                layout: { background: { color: '#1e1e1e' }, textColor: '#d0d0d0' },
                rightPriceScale: { borderColor: '#444', scaleMargins: { top: 0.06, bottom: 0.22 } },
                timeScale: { borderColor: '#444', timeVisible: true, secondsVisible: false },
                grid: { horzLines: { color: '#2a2a2a' }, vertLines: { color: '#2a2a2a' } },
                crosshair: { mode: 1 }
            });

            // Faint price context so price-relative traces (SMAs, bands) have
            // meaning even though this is a separate pane. Markers ride this line.
            this._context = this.chart.addLineSeries({
                color: 'rgba(176,176,176,0.5)', lineWidth: 1,
                priceScaleId: 'right', priceLineVisible: false,
                lastValueVisible: false, crosshairMarkerVisible: false, title: 'Price'
            });

            // Position-state strip pinned to the bottom (like the volume pane on
            // the main chart): stepped so flat/long reads as a clear level.
            this._pos = this.chart.addLineSeries({
                color: 'rgba(66,133,244,0.7)', lineWidth: 1,
                priceScaleId: 'pos', priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: false, lineType: 1 /* WithSteps */, title: 'Net'
            });
            this.chart.priceScale('pos').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

            return this;
        }

        /**
         * Reconfigure the chart for a strategy's declared plots. Removes prior
         * series, creates one per schema item on the right scale (price) or the
         * 'osc' overlay scale, resets data/markers, and renders the legend.
         * @param {Array<{key,label,type,color,scale}>} plots
         */
        setSchema(plots) {
            if (!this.chart) return;
            for (const s of this._series.values()) { try { this.chart.removeSeries(s); } catch (_) {} }
            this._series.clear();
            this._schema = Array.isArray(plots) ? plots.slice() : [];
            this._markers = [];
            this._pendingMarkers = [];
            this._lastTime = null;
            try { this._context.setData([]); } catch (_) {}
            try { this._pos.setData([]); } catch (_) {}
            try { this._context.setMarkers([]); } catch (_) {}

            let hasOsc = false;
            for (const p of this._schema) {
                const priceScaleId = scaleIdFor(p.scale);
                if (priceScaleId === 'osc') hasOsc = true;
                const series = p.type === 'histogram'
                    ? this.chart.addHistogramSeries({ color: p.color, priceScaleId, priceLineVisible: false, lastValueVisible: false })
                    : this.chart.addLineSeries({ color: p.color, lineWidth: 2, priceScaleId, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: p.label });
                this._series.set(p.key, series);
            }
            if (hasOsc) {
                // Centered/bounded oscillators get the same vertical band as the
                // price content so the two never fight for the bottom strip.
                this.chart.priceScale('osc').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
            }
            this._renderLegend();
        }

        /**
         * Append one bar's worth of strategy state (live path). Times are
         * UTC seconds and must be non-decreasing.
         * @param {{time:number, close:number, values:Object, net:number}} pt
         */
        pushPoint(pt) {
            if (!this.chart || !pt || !Number.isFinite(pt.time)) return;
            const time = pt.time;
            this._lastTime = time;
            if (Number.isFinite(pt.close)) { try { this._context.update({ time, value: pt.close }); } catch (_) {} }
            const values = pt.values || {};
            for (const [key, series] of this._series) {
                const v = values[key];
                if (Number.isFinite(v)) { try { series.update({ time, value: v }); } catch (_) {} }
            }
            if (Number.isFinite(pt.net)) { try { this._pos.update({ time, value: pt.net }); } catch (_) {} }
            // Stamp any orders that fired during this bar's onBar at THIS bar's
            // time. (The order event arrives synchronously inside onBar, before
            // this point's time is known, so it was queued — see queueMarker.)
            if (this._pendingMarkers.length) {
                for (const side of this._pendingMarkers) this._markers.push({ time, side, kind: 'live' });
                this._pendingMarkers = [];
            }
            // Advance the single "Live ▸" frontier marker to the latest closed bar
            // so it tracks the live edge through the session instead of staying
            // frozen at the backfill seam. Mutate the existing marker in place
            // (no trail); create one if the run started with no history to backfill.
            let boundary = this._markers.find(m => m.kind === 'boundary');
            if (!boundary) { boundary = { time, side: 0, kind: 'boundary' }; this._markers.push(boundary); }
            boundary.time = time;
            this._applyMarkers();
        }

        /**
         * Batch-render a whole run and fit the view.
         * @param {Array<{time,close,values,net}>} points
         * @param {Array<{time,side}>} [markers]
         * @param {{kind?:'live'|'hypo', boundary?:boolean}} [opts]
         */
        _renderBatch(points, markers, opts = {}) {
            if (!this.chart || !Array.isArray(points)) return;
            const kind = opts.kind || 'live';
            const ctx = [];
            const posData = [];
            const perKey = new Map();
            for (const key of this._series.keys()) perKey.set(key, []);
            for (const pt of points) {
                if (!Number.isFinite(pt.time)) continue;
                if (Number.isFinite(pt.close)) ctx.push({ time: pt.time, value: pt.close });
                if (Number.isFinite(pt.net)) posData.push({ time: pt.time, value: pt.net });
                const values = pt.values || {};
                for (const [key, arr] of perKey) {
                    const v = values[key];
                    if (Number.isFinite(v)) arr.push({ time: pt.time, value: v });
                }
            }
            try { this._context.setData(ctx); } catch (_) {}
            try { this._pos.setData(posData); } catch (_) {}
            for (const [key, series] of this._series) {
                try { series.setData(perKey.get(key) || []); } catch (_) {}
            }
            this._lastTime = ctx.length ? ctx[ctx.length - 1].time : null;
            this._markers = (Array.isArray(markers) ? markers : [])
                .filter(m => Number.isFinite(m.time))
                .map(m => ({ time: m.time, side: m.side, kind }));
            // Seed the "Live ▸" frontier marker at the seam between backfilled
            // history and the live run; pushPoint() then advances it onto each new
            // closed bar as the live session progresses.
            if (opts.boundary && this._lastTime != null) {
                this._markers.push({ time: this._lastTime, side: 0, kind: 'boundary' });
            }
            this._applyMarkers();
            try { this.chart.timeScale().fitContent(); } catch (_) {}
        }

        /** Backtest path: render a whole run; markers are real trades. */
        setData(points, markers) { this._renderBatch(points, markers, { kind: 'live' }); }

        /**
         * Live path: seed the chart with the strategy replayed over loaded
         * history before live streaming takes over. Indicator traces are real;
         * markers/position are hypothetical (the live algo starts flat), so they
         * render muted with a "Live ▸" boundary at the seam.
         */
        backfill(points, markers) { this._renderBatch(points, markers, { kind: 'hypo', boundary: true }); }

        /**
         * Queue a live decision marker fired during the current bar's onBar. It's
         * stamped with that bar's time when the bar's pushPoint runs immediately
         * after, so the marker lands on the bar that actually triggered it (not the
         * previous one). Use this for orders driven by closed bars.
         */
        queueMarker(side) { this._pendingMarkers.push(side); }

        /** Add a single real decision marker (live). Defaults to the latest bar time. */
        addMarker(side, time) {
            const t = Number.isFinite(time) ? time : this._lastTime;
            if (!Number.isFinite(t)) return;
            this._markers.push({ time: t, side, kind: 'live' });
            this._applyMarkers();
        }

        _applyMarkers() {
            if (!this._context) return;
            const sorted = this._markers.slice().sort((a, b) => a.time - b.time);
            try { this._context.setMarkers(sorted.map(markerFor)); } catch (_) {}
        }

        _renderLegend() {
            if (!this._legendEl) return;
            const items = this._schema.map(p =>
                `<span class="strategy-legend-item"><span class="strategy-legend-swatch" style="background:${p.color}"></span>${p.label}</span>`
            );
            items.push('<span class="strategy-legend-item"><span class="strategy-legend-swatch" style="background:rgba(66,133,244,0.7)"></span>Net position</span>');
            this._legendEl.innerHTML = items.join('');
        }

        /**
         * Keep this chart panning/zooming in lock-step with the main chart.
         * Uses LOGICAL-range sync (bar-index space), not time-range: logical range
         * follows pan/zoom into whitespace symmetrically, whereas setVisibleRange
         * clamps to a chart's own data extent (which froze this pane when the main
         * chart zoomed out past the strategy's first/last bar). Index alignment is
         * correct because the backfill seeds this chart from the same `_historyBars`
         * the main chart's candles use, starting at the same first bar.
         *
         * Bidirectional; a re-entrancy lock stops the echo from looping.
         * Known limitation: deep left-scroll lazy-loads older bars into the main
         * chart only, so indices can drift after scrolling far back in history.
         */
        syncTo(mainChart) {
            if (!this.chart || !mainChart) return;
            this._unsync();
            const mts = mainChart.timeScale();
            const sts = this.chart.timeScale();
            let lock = false;
            const copy = (from, to) => {
                if (lock) return;
                lock = true;
                try { const r = from.getVisibleLogicalRange(); if (r) to.setVisibleLogicalRange(r); } catch (_) {}
                finally { lock = false; }
            };
            const fwd = () => copy(mts, sts);
            const back = () => copy(sts, mts);
            mts.subscribeVisibleLogicalRangeChange(fwd);
            sts.subscribeVisibleLogicalRangeChange(back);
            this._syncCleanup = () => {
                try { mts.unsubscribeVisibleLogicalRangeChange(fwd); } catch (_) {}
                try { sts.unsubscribeVisibleLogicalRangeChange(back); } catch (_) {}
            };
            fwd();
        }

        _unsync() {
            if (this._syncCleanup) { try { this._syncCleanup(); } catch (_) {} this._syncCleanup = null; }
        }

        show() {
            if (this._wrapEl) this._wrapEl.style.display = '';
            // The wrap may have been hidden at mount (0-size canvas); nudge the
            // chart to remeasure now that it's visible.
            if (this.chart) { try { this.chart.timeScale().fitContent(); } catch (_) {} }
        }

        hide() { if (this._wrapEl) this._wrapEl.style.display = 'none'; }

        clear() {
            this._markers = [];
            this._pendingMarkers = [];
            this._lastTime = null;
            try { this._context && this._context.setData([]); } catch (_) {}
            try { this._context && this._context.setMarkers([]); } catch (_) {}
            try { this._pos && this._pos.setData([]); } catch (_) {}
            for (const s of this._series.values()) { try { s.setData([]); } catch (_) {} }
        }
    }

    NS.StrategyChart = StrategyChart;
})(window);
