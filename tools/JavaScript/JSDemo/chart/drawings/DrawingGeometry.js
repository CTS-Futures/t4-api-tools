/**
 * chart/drawings/DrawingGeometry.js
 *
 * Pure geometry + coordinate helpers for the drawings overlay. No DOM, no
 * chart state held here — everything takes the chart/series in as arguments so
 * these stay trivially testable and side-effect free.
 *
 * Two coordinate spaces are in play:
 *   - DATA space:  { time (UTC seconds), price } — how drawings are stored.
 *   - PIXEL space: { x, y } in CSS px relative to the chart container — what we
 *                  actually draw and hit-test against.
 *
 * The tricky part is x for times OUTSIDE the loaded data range (rays, extended
 * lines, vertical lines, off-screen endpoints), where LWC v4.1
 * `timeToCoordinate` returns null. We solve it with the time scale's LOGICAL
 * index axis, which is continuous and defined into the left/right whitespace:
 * convert an on-domain time to a logical float once, then render via
 * `logicalToCoordinate(logical)` which extrapolates along bar spacing.
 */
(function (global) {
    'use strict';

    // ---- data <-> pixel ----------------------------------------------------

    // price -> y pixel (or null when the price scale can't resolve it yet).
    function priceToY(series, price) {
        if (!series || !Number.isFinite(price)) return null;
        const y = series.priceToCoordinate(price);
        return (y == null || !Number.isFinite(y)) ? null : y;
    }

    // y pixel -> price (or null).
    function yToPrice(series, y) {
        if (!series || !Number.isFinite(y)) return null;
        const p = series.coordinateToPrice(y);
        return (p == null || !Number.isFinite(p)) ? null : p;
    }

    // Convert an on-domain time to a logical-index float, or null when the time
    // currently maps outside the data (so the caller can fall back to a cached
    // logical). This is how we "re-pin" a logical to live data each repaint.
    function timeToLogical(chart, timeSec) {
        if (!chart || !Number.isFinite(timeSec)) return null;
        const ts = chart.timeScale();
        const x = ts.timeToCoordinate(timeSec);
        if (x == null || !Number.isFinite(x)) return null;
        const lg = ts.coordinateToLogical(x);
        return (lg == null || !Number.isFinite(lg)) ? null : lg;
    }

    // logical-index float -> x pixel. Extrapolates into whitespace for logicals
    // outside [0, N-1], which is exactly what rays / vertical lines need.
    function logicalToX(chart, logical) {
        if (!chart || !Number.isFinite(logical)) return null;
        const x = chart.timeScale().logicalToCoordinate(logical);
        return (x == null || !Number.isFinite(x)) ? null : x;
    }

    // x pixel -> logical-index float (continuous, defined off-domain too).
    function xToLogical(chart, x) {
        if (!chart || !Number.isFinite(x)) return null;
        const lg = chart.timeScale().coordinateToLogical(x);
        return (lg == null || !Number.isFinite(lg)) ? null : lg;
    }

    // x pixel -> time (UTC seconds) when on-domain, else null. Used at
    // placement time to stamp a stable data-space anchor.
    function xToTime(chart, x) {
        if (!chart || !Number.isFinite(x)) return null;
        const t = chart.timeScale().coordinateToTime(x);
        return (t == null || !Number.isFinite(t)) ? null : t;
    }

    // Resolve an anchor { time, price, logical? } to { x, y } pixels.
    // Strategy: y from price (always available while the price scale is live).
    // x from time when on-domain; otherwise from the cached logical (set while
    // the anchor was last on-domain) extrapolated into whitespace.
    function resolveAnchor(chart, series, anchor) {
        if (!anchor) return null;
        const y = priceToY(series, anchor.price);
        let x = null;
        if (Number.isFinite(anchor.time)) {
            const tx = chart.timeScale().timeToCoordinate(anchor.time);
            if (tx != null && Number.isFinite(tx)) x = tx;
        }
        if (x == null && Number.isFinite(anchor.logical)) {
            x = logicalToX(chart, anchor.logical);
        }
        if (x == null || y == null) return null;
        return { x, y };
    }

    // ---- distance / hit-test ----------------------------------------------

    // Shortest distance from point P to the finite segment AB (all pixel space).
    function distanceToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    // Distance from P to the INFINITE line through A and B.
    function distanceToInfiniteLine(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len === 0) return Math.hypot(px - ax, py - ay);
        // |cross product| / |AB|
        return Math.abs((px - ax) * dy - (py - ay) * dx) / len;
    }

    // Distance from P to the RAY starting at A through B (extends past B only).
    function distanceToRay(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        if (t < 0) t = 0; // clamp behind the origin; forward is unbounded
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    function pointInRect(px, py, x, y, w, h) {
        return px >= x && px <= x + w && py >= y && py <= y + h;
    }

    // ---- line extension / clipping ----------------------------------------

    // Liang–Barsky: clip the infinite line through A,B to the rect [0,0,w,h].
    // Returns [{x,y},{x,y}] for the visible chord, or null if it misses.
    function clipInfiniteLineToRect(ax, ay, bx, by, w, h) {
        const dx = bx - ax;
        const dy = by - ay;
        if (dx === 0 && dy === 0) return null;
        // Parametric P = A + t*D, t over (-inf, inf). Clip against 4 edges.
        const p = [-dx, dx, -dy, dy];
        const q = [ax - 0, w - ax, ay - 0, h - ay];
        let t0 = -Infinity;
        let t1 = Infinity;
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) {
                if (q[i] < 0) return null; // parallel & outside
            } else {
                const r = q[i] / p[i];
                if (p[i] < 0) { if (r > t0) t0 = r; }
                else { if (r < t1) t1 = r; }
            }
        }
        if (t0 > t1) return null;
        return [
            { x: ax + t0 * dx, y: ay + t0 * dy },
            { x: ax + t1 * dx, y: ay + t1 * dy }
        ];
    }

    // Clip the RAY from A through B (t >= 0) to the rect. Returns the drawable
    // [start, end] where start is A (if inside) clamped, end is the far edge.
    function clipRayToRect(ax, ay, bx, by, w, h) {
        const full = clipInfiniteLineToRect(ax, ay, bx, by, w, h);
        if (!full) return null;
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy || 1;
        // Parametric t of the two clip points relative to A.
        const tOf = (pt) => ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq;
        let [s, e] = full;
        let ts = tOf(s);
        let te = tOf(e);
        if (ts > te) { [s, e] = [e, s]; [ts, te] = [te, ts]; }
        // Ray only exists for t >= 0; start from A when A is inside the chord.
        const startT = Math.max(0, ts);
        if (startT > te) return null;
        const start = { x: ax + startT * dx, y: ay + startT * dy };
        return [start, e];
    }

    // Arrowhead polygon (3 points) at B pointing along A->B. `size` in px.
    function arrowHead(ax, ay, bx, by, size) {
        const ang = Math.atan2(by - ay, bx - ax);
        const a1 = ang + Math.PI - 0.45;
        const a2 = ang + Math.PI + 0.45;
        return [
            { x: bx, y: by },
            { x: bx + size * Math.cos(a1), y: by + size * Math.sin(a1) },
            { x: bx + size * Math.cos(a2), y: by + size * Math.sin(a2) }
        ];
    }

    // ---- measure stats -----------------------------------------------------

    // Price delta, percent, and bar count between two anchors. Bars come from
    // the logical-index difference so it's interval-agnostic.
    function measureStats(chart, a, b) {
        const dPrice = b.price - a.price;
        const pct = a.price !== 0 ? (dPrice / a.price) * 100 : NaN;
        let bars = NaN;
        const la = Number.isFinite(a.logical) ? a.logical : timeToLogical(chart, a.time);
        const lb = Number.isFinite(b.logical) ? b.logical : timeToLogical(chart, b.time);
        if (Number.isFinite(la) && Number.isFinite(lb)) bars = Math.round(lb - la);
        return { dPrice, pct, bars };
    }

    global.ChartDrawingGeometry = {
        priceToY,
        yToPrice,
        timeToLogical,
        logicalToX,
        xToLogical,
        xToTime,
        resolveAnchor,
        distanceToSegment,
        distanceToInfiniteLine,
        distanceToRay,
        pointInRect,
        clipInfiniteLineToRect,
        clipRayToRect,
        arrowHead,
        measureStats
    };
})(window);
