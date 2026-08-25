/**
 * chart/orderflow/colormap.js
 *
 * Perceptual "thermal" colour ramp for the DOM liquidity heatmap, mapping a
 * normalized intensity t in [0,1] to an 'r,g,b' string. Bright = lots of
 * resting size. Encoding size in colour (not just opacity) is what gives a
 * liquidity map its Bookmap-style punch.
 *
 * Ramp: deep navy -> blue -> cyan -> green -> yellow -> orange -> red -> white.
 * The same stops are mirrored in the CSS legend gradient (chart.css
 * .orderflow-legend .ofl-bar) — keep them in sync if you retune.
 */
(function (global) {
    'use strict';

    // [position 0..1, r, g, b]
    const STOPS = [
        [0.00,   8,  12,  40],
        [0.16,  33,  80, 200],
        [0.33,  40, 200, 220],
        [0.50,  40, 210,  90],
        [0.66, 240, 230,  60],
        [0.82, 245, 140,  30],
        [0.92, 235,  40,  40],
        [1.00, 255, 240, 230]
    ];

    function lerp(a, b, f) { return a + (b - a) * f; }

    // intensity (any number; clamped to [0,1]) -> 'r,g,b'.
    function thermal(t) {
        if (!(t > 0)) return `${STOPS[0][1]},${STOPS[0][2]},${STOPS[0][3]}`;
        if (t >= 1) { const s = STOPS[STOPS.length - 1]; return `${s[1]},${s[2]},${s[3]}`; }
        for (let i = 1; i < STOPS.length; i++) {
            const hi = STOPS[i];
            if (t <= hi[0]) {
                const lo = STOPS[i - 1];
                const span = hi[0] - lo[0];
                const f = span > 0 ? (t - lo[0]) / span : 0;
                const r = Math.round(lerp(lo[1], hi[1], f));
                const g = Math.round(lerp(lo[2], hi[2], f));
                const b = Math.round(lerp(lo[3], hi[3], f));
                return `${r},${g},${b}`;
            }
        }
        const s = STOPS[STOPS.length - 1];
        return `${s[1]},${s[2]},${s[3]}`;
    }

    global.ChartOrderflow = global.ChartOrderflow || {};
    global.ChartOrderflow.thermal = thermal;
})(window);
