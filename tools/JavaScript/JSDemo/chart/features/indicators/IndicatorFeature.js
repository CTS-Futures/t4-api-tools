/**
 * chart/features/indicators/IndicatorFeature.js
 *
 * Wraps a pure indicator function as a chart feature.
 *
 *   new IndicatorFeature({
 *     id:     'ema-20',       // unique among features
 *     type:   'ema',          // 'sma' | 'ema' | 'vwap'
 *     period: 20,             // ignored for vwap
 *     color:  '#f0b90b',
 *     title:  'EMA(20)'       // optional, shown in price-line label
 *   })
 *
 * Lifecycle:
 *   attach()       -> creates a line series
 *   onBars(bars)   -> full recompute on history (re)load; carries volumes
 *                     via the bus payload (see _onBarsLoaded)
 *   onBarUpdate(b) -> recompute the LAST point cheaply so the line follows
 *                     the forming bar (full recompute on bar:close for
 *                     correctness — bars list is short, this is fine)
 *   detach()       -> removes the series
 */
(function (global) {
    'use strict';

    const DEFAULT_COLORS = ['#f0b90b', '#42a5f5', '#ab47bc', '#26a69a', '#ef5350', '#fbc02d'];

    class IndicatorFeature {
        constructor({ id, type, period, color, title } = {}) {
            if (!id || !type) throw new Error('IndicatorFeature requires id and type');
            this.id = id;
            this.type = type;
            this.period = Number(period) || 0;
            this.color = color || DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
            this.title = title || this._defaultTitle();
            this._series = null;
            this._bars = [];          // last known bars
            this._volumes = [];       // parallel volumes (for VWAP)
            this._unsubBarsLoaded = null;
            this._chart = null;
        }

        _defaultTitle() {
            if (this.type === 'vwap') return 'VWAP';
            return `${this.type.toUpperCase()}(${this.period})`;
        }

        attach(ctx) {
            this._chart = ctx.chart;
            this._series = ctx.chart.addLineSeries({
                color: this.color,
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: true,
                title: this.title,
                crosshairMarkerVisible: false
            });
            // Listen to bars:loaded directly so we can capture the parallel
            // volume series (the host's onBars callback only passes bars).
            this._unsubBarsLoaded = ctx.bus.on('bars:loaded', (payload) => this._onBarsLoaded(payload));
        }

        detach() {
            if (this._unsubBarsLoaded) this._unsubBarsLoaded();
            if (this._series && this._chart) {
                try { this._chart.removeSeries(this._series); } catch (_) { /* gone */ }
            }
            this._series = null;
            this._chart = null;
            this._bars = [];
            this._volumes = [];
        }

        _onBarsLoaded({ bars, volume }) {
            this._bars = Array.isArray(bars) ? bars.slice() : [];
            this._volumes = Array.isArray(volume) ? volume.map(v => Number(v?.value) || 0) : [];
            this._recomputeAll();
        }

        // Called by the host registry; bars already pushed via bars:loaded.
        // We keep this as a no-op to avoid double work, but support being
        // delivered just `bars` (no volumes) gracefully.
        onBars(bars) {
            if (this._bars.length) return;
            this._bars = Array.isArray(bars) ? bars.slice() : [];
            this._volumes = new Array(this._bars.length).fill(0);
            this._recomputeAll();
        }

        onBarUpdate(bar) {
            if (!this._series || !bar) return;
            const last = this._bars[this._bars.length - 1];
            if (last && last.time === bar.time) {
                this._bars[this._bars.length - 1] = bar;
                this._volumes[this._volumes.length - 1] = Number(bar.volume) || 0;
            } else {
                this._bars.push(bar);
                this._volumes.push(Number(bar.volume) || 0);
            }
            // For SMA/EMA we can update just the last point; for VWAP the
            // running cumulative needs the previous state, which a full
            // recompute handles correctly. Bar counts are small enough
            // (~lookbackDays * barsPerDay) that this is cheap.
            this._recomputeAll();
        }

        onBarClose() {
            // No-op: onBarUpdate already pushed the closing values.
        }

        _recomputeAll() {
            if (!this._series) return;
            const M = global.ChartIndicators;
            if (!M) return;
            let data = [];
            if (this.type === 'sma') data = M.sma(this._bars, this.period);
            else if (this.type === 'ema') data = M.ema(this._bars, this.period);
            else if (this.type === 'vwap') data = M.vwap(this._bars, this._volumes);
            try { this._series.setData(data); } catch (err) { console.error(err); }
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.IndicatorFeature = IndicatorFeature;
})(window);
