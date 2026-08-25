/**
 * chart/features/indicators/math.js
 *
 * Pure indicator math. Each function takes an array of bars
 *   { time, open, high, low, close }
 * and (where required) a parallel volume array, and returns an array of
 *   { time, value }
 * points aligned to bar times. Points where the indicator is not yet defined
 * (e.g. the first N-1 bars of an SMA) are omitted.
 *
 * Kept free of any chart dependency so these can be unit-tested in isolation.
 */
(function (global) {
    'use strict';

    function sma(bars, period) {
        const out = [];
        if (!Array.isArray(bars) || !(period > 0) || bars.length < period) return out;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += bars[i].close;
        out.push({ time: bars[period - 1].time, value: sum / period });
        for (let i = period; i < bars.length; i++) {
            sum += bars[i].close - bars[i - period].close;
            out.push({ time: bars[i].time, value: sum / period });
        }
        return out;
    }

    function ema(bars, period) {
        const out = [];
        if (!Array.isArray(bars) || !(period > 0) || bars.length < period) return out;
        const k = 2 / (period + 1);
        // Seed with SMA of the first `period` closes (standard practice).
        let seed = 0;
        for (let i = 0; i < period; i++) seed += bars[i].close;
        let prev = seed / period;
        out.push({ time: bars[period - 1].time, value: prev });
        for (let i = period; i < bars.length; i++) {
            prev = bars[i].close * k + prev * (1 - k);
            out.push({ time: bars[i].time, value: prev });
        }
        return out;
    }

    // Session-anchored VWAP. `volumes` is parallel to `bars`. A new session
    // starts whenever the UTC calendar day rolls (good enough as a default;
    // for futures' 6pm CT session boundary callers can pre-bucket bars).
    function vwap(bars, volumes) {
        const out = [];
        if (!Array.isArray(bars) || !Array.isArray(volumes) || bars.length !== volumes.length) return out;
        let pv = 0, vv = 0, sessionDay = null;
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            const v = Number(volumes[i]) || 0;
            const day = Math.floor(b.time / 86400);
            if (sessionDay !== day) {
                sessionDay = day;
                pv = 0;
                vv = 0;
            }
            const typical = (b.high + b.low + b.close) / 3;
            pv += typical * v;
            vv += v;
            if (vv > 0) out.push({ time: b.time, value: pv / vv });
        }
        return out;
    }

    global.ChartIndicators = global.ChartIndicators || {};
    Object.assign(global.ChartIndicators, { sma, ema, vwap });
})(window);
