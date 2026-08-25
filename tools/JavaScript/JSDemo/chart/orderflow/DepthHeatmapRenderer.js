/**
 * chart/orderflow/DepthHeatmapRenderer.js
 *
 * Bookmap-style DOM liquidity heatmap, rendered on TWO canvases stacked around
 * the Lightweight Charts canvas (v4.1 has no primitives API):
 *
 *   heat canvas   (class 'orderflow-heatmap', z-index 0, container firstChild)
 *       The time x price liquidity grid, painted BEHIND the candles. Requires
 *       the chart's layout.background to be transparent (set in ChartService).
 *   marks canvas  (class 'orderflow-marks', z-index 2, appended)
 *       Best-bid/offer reference lines and executed-trade bubbles, painted
 *       ABOVE the candles so they stay visible.
 *
 * Data model
 * ----------
 * Depth snapshots come from DepthSnapshotBuffer: { time(sec), bids[], offers[] }.
 * Each snapshot is one column from its x to the next snapshot's x (the most
 * recent runs to the right edge). Within a column each level is a cell one tick
 * tall, centred on its price, coloured by a thermal ramp over a log-scaled,
 * decaying-max normalization (so a single wall doesn't crush smaller levels).
 * Trade bubbles come from TradeTape: { time(sec), price, volume, side }.
 *
 * Coordinates
 * -----------
 * price -> y via series.priceToCoordinate (exact). time -> x via
 * timeScale().timeToCoordinate when on-domain; for the live right edge (times
 * past the last bar) that returns null, so we fall back to the same per-frame
 * linear logical-axis reference DrawingsOverlay uses and extrapolate. All
 * painting is clipped to the data pane (excluding the price/time axis gutters).
 *
 * Performance
 * -----------
 * Repaints are rAF-coalesced and only touch the visible time window, with
 * horizontal + vertical culling. Both canvases are pointer-events:none.
 */
(function (global) {
    'use strict';

    const MIN_CELL_PX = 2;          // floor so a 1-tick cell stays visible
    const MAX_COL_PX = 1600;        // clamp a stale/last column's right extent
    const CELL_MIN_ALPHA = 0.45;    // faint level (thin book) — semi-transparent
    const CELL_MAX_ALPHA = 0.95;    // wall — near-opaque bright colour
    const MAX_DECAY = 0.97;         // per-frame decay of the rolling max reference
    const BUBBLE_MIN_R = 1.5;
    const BUBBLE_MAX_R = 14;
    const BUBBLE_R_SCALE = 1.2;     // radius ~ BUBBLE_R_SCALE * sqrt(volume)
    const BID_LINE = 'rgba(38,166,154,0.7)';
    const ASK_LINE = 'rgba(239,83,80,0.7)';
    const BUY_BUBBLE = '38,166,154';
    const SELL_BUBBLE = '239,83,80';

    class DepthHeatmapRenderer {
        constructor({ chart, series, container, host, buffer, tape }) {
            this._chart = chart;
            this._series = series;
            this._container = container;
            this._host = host;
            this._buffer = buffer;
            this._tape = tape || null;

            this._heat = null;  this._heatCtx = null;
            this._marks = null; this._marksCtx = null;
            this._legend = null;
            this._dpr = 1;
            this._marketId = null;
            this._maxRef = 0;   // decaying rolling max for normalization

            this._fillLUT = null; // 256-entry rgba() string cache (built lazily)

            this._rafHandle = 0;
            this._dirty = false;
            this._resizeObs = null;

            this._onScaleChange = this._onScaleChange.bind(this);
            this._draw = this._draw.bind(this);
        }

        // ---------- lifecycle ---------------------------------------------
        mount() {
            // Heat canvas BEHIND the chart canvas (firstChild + z-index 0).
            this._heat = this._makeCanvas('orderflow-heatmap');
            this._container.insertBefore(this._heat, this._container.firstChild);
            this._heatCtx = this._heat.getContext('2d');

            // Marks canvas ABOVE the chart canvas (appended + z-index 2).
            this._marks = this._makeCanvas('orderflow-marks');
            this._container.appendChild(this._marks);
            this._marksCtx = this._marks.getContext('2d');

            this._buildLegend();

            this._resize();
            if (typeof global.ResizeObserver === 'function') {
                this._resizeObs = new global.ResizeObserver(() => { this._resize(); this.scheduleRedraw(); });
                this._resizeObs.observe(this._container);
            }

            const ts = this._chart.timeScale();
            ts.subscribeVisibleLogicalRangeChange(this._onScaleChange);
            ts.subscribeVisibleTimeRangeChange(this._onScaleChange);

            this.scheduleRedraw();
        }

        _makeCanvas(className) {
            const canvas = document.createElement('canvas');
            canvas.className = className;
            return canvas;
        }

        _buildLegend() {
            const el = document.createElement('div');
            el.className = 'orderflow-legend';
            const label = document.createElement('span');
            label.textContent = 'Liq';
            const lo = document.createElement('span'); lo.textContent = 'low';
            const bar = document.createElement('span'); bar.className = 'ofl-bar';
            const hi = document.createElement('span'); hi.textContent = 'high';
            el.appendChild(label); el.appendChild(lo); el.appendChild(bar); el.appendChild(hi);
            this._container.appendChild(el);
            this._legend = el;
        }

        destroy() {
            if (this._rafHandle) (global.cancelAnimationFrame || clearTimeout)(this._rafHandle);
            this._rafHandle = 0;
            const ts = this._chart?.timeScale?.();
            if (ts) {
                try { ts.unsubscribeVisibleLogicalRangeChange(this._onScaleChange); } catch (_) {}
                try { ts.unsubscribeVisibleTimeRangeChange(this._onScaleChange); } catch (_) {}
            }
            if (this._resizeObs) { try { this._resizeObs.disconnect(); } catch (_) {} this._resizeObs = null; }
            for (const node of [this._heat, this._marks, this._legend]) {
                if (node?.parentNode) node.parentNode.removeChild(node);
            }
            this._heat = this._heatCtx = this._marks = this._marksCtx = this._legend = null;
        }

        setMarket(marketId) {
            this._marketId = marketId;
            this._maxRef = 0; // reset normalization on market switch
            this.scheduleRedraw();
        }

        // ---------- redraw loop -------------------------------------------
        scheduleRedraw() {
            this._dirty = true;
            if (this._rafHandle) return;
            const raf = global.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            this._rafHandle = raf(() => {
                this._rafHandle = 0;
                if (this._dirty) { this._dirty = false; this._draw(); }
            });
        }

        _onScaleChange() { this.scheduleRedraw(); }

        _resize() {
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            const dpr = global.devicePixelRatio || 1;
            this._dpr = dpr;
            for (const [canvas, ctx] of [[this._heat, this._heatCtx], [this._marks, this._marksCtx]]) {
                if (!canvas) continue;
                canvas.style.width = `${w}px`;
                canvas.style.height = `${h}px`;
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(h * dpr);
                if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        }

        // ---------- coordinate plumbing -----------------------------------
        _intervalSec() {
            const ms = this._host?.intervalMs ?? 60000;
            return Math.max(1, ms / 1000);
        }

        // Right/bottom extent of the data pane (excludes the axis gutters), so
        // the transparent-background heat doesn't bleed under the scales.
        _paneRight(w) {
            try {
                const pw = this._chart.priceScale('right').width();
                if (Number.isFinite(pw) && pw > 0 && pw < w) return w - pw;
            } catch (_) {}
            return w;
        }
        _paneBottom(h) {
            try {
                const th = this._chart.timeScale().height();
                if (Number.isFinite(th) && th > 0 && th < h) return h - th;
            } catch (_) {}
            return h;
        }

        // Per-frame linear time<->logical reference (mirrors DrawingsOverlay._ref).
        _ref() {
            const ts = this._chart.timeScale();
            const range = ts.getVisibleLogicalRange && ts.getVisibleLogicalRange();
            if (!range) return null;
            const from = Math.floor(range.from);
            const to = Math.ceil(range.to);
            const tryAt = (lg) => {
                const x = ts.logicalToCoordinate(lg);
                if (x == null) return null;
                const t = ts.coordinateToTime(x);
                return (t == null || !Number.isFinite(t)) ? null : { Lref: lg, Tref: t };
            };
            const mid = Math.round((from + to) / 2);
            let r = tryAt(mid);
            if (r) return r;
            for (let d = 1; d <= (to - from) + 2 && !r; d++) {
                r = tryAt(mid - d) || tryAt(mid + d);
            }
            return r;
        }

        _timeToX(timeSec, ref) {
            const ts = this._chart.timeScale();
            const tx = ts.timeToCoordinate(timeSec);
            if (tx != null && Number.isFinite(tx)) return tx;
            if (!ref) return null;
            const lg = ref.Lref + (timeSec - ref.Tref) / this._intervalSec();
            const x = ts.logicalToCoordinate(lg);
            return (x != null && Number.isFinite(x)) ? x : null;
        }

        // ---------- colour ------------------------------------------------
        // Thermal colour with an alpha ramp: thin levels stay dim/semi-transparent,
        // walls go bright and near-opaque. Precomputed once into a 256-entry LUT
        // of rgba() strings — the hot path paints ~tens of thousands of cells per
        // frame, so reusing strings avoids that many allocations + ramp lookups.
        // 256 steps is visually indistinguishable from the continuous ramp.
        _buildFillLUT() {
            const ramp = global.ChartOrderflow?.thermal;
            const lut = new Array(256);
            for (let i = 0; i < 256; i++) {
                const t = i / 255;
                const rgb = ramp ? ramp(t) : '120,120,120';
                const a = CELL_MIN_ALPHA + (CELL_MAX_ALPHA - CELL_MIN_ALPHA) * t;
                lut[i] = `rgba(${rgb},${a.toFixed(3)})`;
            }
            return lut;
        }

        // intensity already clamped to [0,1]; map to the nearest LUT bucket.
        _fill(intensity) {
            if (!this._fillLUT) this._fillLUT = this._buildFillLUT();
            let idx = (intensity * 255 + 0.5) | 0;
            if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
            return this._fillLUT[idx];
        }

        // Fast price->y mapper for the frame. On a linear (normal) price scale,
        // y is affine in price, so one anchor priceToCoordinate + the per-tick
        // pixel height replaces a priceToCoordinate call per level. On any other
        // scale mode (log / percentage) fall back to exact per-level conversion.
        _makeYMapper(series, tick, cellPx) {
            let linear = false;
            try { linear = (this._chart.priceScale('right').mode?.() === 0); } catch (_) {}
            if (linear && tick && Number.isFinite(cellPx) && cellPx > 0) {
                const h = this._container.clientHeight;
                const pAnchor = series.coordinateToPrice(h / 2);
                const yAnchor = Number.isFinite(pAnchor) ? series.priceToCoordinate(pAnchor) : null;
                if (Number.isFinite(pAnchor) && yAnchor != null && Number.isFinite(yAnchor)) {
                    const k = cellPx / tick; // pixels per price unit (y falls as price rises)
                    return (price) => yAnchor - (price - pAnchor) * k;
                }
            }
            return (price) => series.priceToCoordinate(price);
        }

        // ---------- drawing ------------------------------------------------
        _draw() {
            if (!this._heatCtx || !this._marksCtx) return;
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            const hc = this._heatCtx;
            const mc = this._marksCtx;
            hc.clearRect(0, 0, w, h);
            mc.clearRect(0, 0, w, h);

            if (!this._marketId || !this._buffer) return;
            const series = this._series;
            const ts = this._chart.timeScale();
            const paneR = this._paneRight(w);
            const paneB = this._paneBottom(h);

            const vr = ts.getVisibleRange && ts.getVisibleRange();
            const fromSec = vr && Number.isFinite(vr.from) ? vr.from : -Infinity;
            const ref = this._ref();

            // Frame-stable cell geometry + price->y mapper, computed once and
            // shared by both layers (replaces a priceToCoordinate call per level).
            const tick = this._tickSize();
            const cellPx = this._tickHeightPx(tick);
            const yAt = this._makeYMapper(series, tick, cellPx);

            // Clip both layers to the data pane (exclude axis gutters).
            hc.save(); hc.beginPath(); hc.rect(0, 0, paneR, paneB); hc.clip();
            mc.save(); mc.beginPath(); mc.rect(0, 0, paneR, paneB); mc.clip();

            this._drawHeat(hc, series, paneR, paneB, fromSec, ref, yAt, cellPx, tick);
            this._drawMarks(mc, series, paneR, paneB, fromSec, ref, yAt);

            hc.restore();
            mc.restore();
        }

        _drawHeat(c, series, w, h, fromSec, ref, yAt, cellPx, tick) {
            const snaps = this._buffer.range(this._marketId, fromSec);
            if (snaps.length === 0) return;

            // Window max from each snapshot's precomputed maxVol (O(columns), not
            // O(columns x levels)), then fold into a decaying rolling max so
            // colours stay stable as the window scrolls and walls fade out.
            let windowMax = 0;
            for (const s of snaps) { const m = s.maxVol || 0; if (m > windowMax) windowMax = m; }
            if (windowMax <= 0) return;
            this._maxRef = Math.max(windowMax, this._maxRef * MAX_DECAY);
            const logMax = Math.log1p(this._maxRef);
            if (!(logMax > 0)) return;

            // Visible price band, computed once per frame, so a deep (ALL-levels)
            // book skips off-screen levels BEFORE the per-level priceToCoordinate
            // call — the bulk of a full book is never on screen.
            const pTop = series.coordinateToPrice(0);
            const pBot = series.coordinateToPrice(h);
            const pad = (tick || 0);
            const loP = Math.min(pTop, pBot) - pad;
            const hiP = Math.max(pTop, pBot) + pad;
            const haveBounds = Number.isFinite(loP) && Number.isFinite(hiP);

            const xs = new Array(snaps.length);
            for (let i = 0; i < snaps.length; i++) xs[i] = this._timeToX(snaps[i].time, ref);

            for (let i = 0; i < snaps.length; i++) {
                const x0 = xs[i];
                if (x0 == null) continue;
                let x1 = (i + 1 < snaps.length && xs[i + 1] != null) ? xs[i + 1] : w;
                if (x1 - x0 > MAX_COL_PX) x1 = x0 + MAX_COL_PX;
                let colW = x1 - x0;
                if (colW < 1) colW = 1;
                if (x1 < 0 || x0 > w) continue;

                const s = snaps[i];
                this._paintLevels(c, s.bids, x0, colW, cellPx, logMax, yAt, h, loP, hiP, haveBounds);
                this._paintLevels(c, s.offers, x0, colW, cellPx, logMax, yAt, h, loP, hiP, haveBounds);
            }
        }

        _paintLevels(c, levels, x0, colW, cellPx, logMax, yAt, h, loP, hiP, haveBounds) {
            for (const lvl of levels) {
                if (haveBounds && (lvl.price < loP || lvl.price > hiP)) continue; // price-band pre-cull
                const yc = yAt(lvl.price);
                if (yc == null || !Number.isFinite(yc)) continue;
                const y = yc - cellPx / 2;
                if (y + cellPx < 0 || y > h) continue;
                const t = Math.min(1, Math.log1p(lvl.volume) / logMax);
                c.fillStyle = this._fill(t);
                c.fillRect(x0, y, colW, cellPx);
            }
        }

        // Best-bid / best-offer reference lines + executed-trade bubbles.
        _drawMarks(c, series, w, h, fromSec, ref, yAt) {
            // BBO lines from the latest book snapshot (best prices precomputed
            // at capture in DepthSnapshotBuffer).
            const latest = this._buffer.latest(this._marketId);
            if (latest) {
                this._bboLine(c, series, latest.bestBid, BID_LINE, w);
                this._bboLine(c, series, latest.bestOffer, ASK_LINE, w);
            }

            // Trade bubbles.
            if (!this._tape) return;
            const trades = this._tape.range(this._marketId, fromSec);
            for (const tr of trades) {
                const x = this._timeToX(tr.time, ref);
                if (x == null || x < 0 || x > w) continue;
                const y = yAt(tr.price);
                if (y == null || !Number.isFinite(y) || y < 0 || y > h) continue;
                let r = BUBBLE_R_SCALE * Math.sqrt(tr.volume);
                if (r < BUBBLE_MIN_R) r = BUBBLE_MIN_R;
                if (r > BUBBLE_MAX_R) r = BUBBLE_MAX_R;
                const rgb = tr.side < 0 ? SELL_BUBBLE : BUY_BUBBLE;
                c.beginPath();
                c.arc(x, y, r, 0, Math.PI * 2);
                c.fillStyle = `rgba(${rgb},0.5)`;
                c.fill();
                c.lineWidth = 1;
                c.strokeStyle = `rgba(${rgb},0.9)`;
                c.stroke();
            }
        }

        _bboLine(c, series, price, color, w) {
            if (!Number.isFinite(price)) return;
            const y = series.priceToCoordinate(price);
            if (y == null || !Number.isFinite(y)) return;
            c.save();
            c.strokeStyle = color;
            c.lineWidth = 1;
            c.setLineDash([4, 3]);
            c.beginPath();
            c.moveTo(0, y + 0.5);
            c.lineTo(w, y + 0.5);
            c.stroke();
            c.restore();
        }

        _tickSize() {
            const details = this._marketId ? this._host?.client?.getMarketDetails?.(this._marketId) : null;
            const t = Number(details?.minPriceIncrement?.value);
            return Number.isFinite(t) && t > 0 ? t : null;
        }

        _tickHeightPx(tick) {
            if (!tick) return MIN_CELL_PX;
            const series = this._series;
            const h = this._container.clientHeight;
            const midPrice = series.coordinateToPrice(h / 2);
            if (midPrice == null || !Number.isFinite(midPrice)) return MIN_CELL_PX;
            const y0 = series.priceToCoordinate(midPrice);
            const y1 = series.priceToCoordinate(midPrice + tick);
            if (y0 == null || y1 == null) return MIN_CELL_PX;
            return Math.max(MIN_CELL_PX, Math.abs(y0 - y1));
        }
    }

    global.ChartOrderflow = global.ChartOrderflow || {};
    global.ChartOrderflow.DepthHeatmapRenderer = DepthHeatmapRenderer;
})(window);
