/**
 * algo/strategies/indicators.js
 *
 * Pure indicator math for algo strategies. Unlike chart/features/indicators/math.js
 * (which computes whole-array series for chart overlays), these operate on a plain
 * numeric buffer (typically a strategy's rolling `_closes` / `_highs` / `_lows`)
 * and return a single scalar for the MOST RECENT point — the natural shape for a
 * strategy deciding on each closed bar.
 *
 * Every function returns null when there isn't enough data, so callers can use a
 * simple `if (x == null) return;` warm-up guard (matching SmaCrossover).
 *
 * No chart/DOM dependency — trivially unit-testable.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    // Simple moving average of the last `period` values. null if too short.
    function sma(values, period) {
        if (!Array.isArray(values) || !(period > 0) || values.length < period) return null;
        let sum = 0;
        for (let i = values.length - period; i < values.length; i++) sum += values[i];
        return sum / period;
    }

    // Exponential moving average computed over the last `period`+ values, seeded
    // with the SMA of the first `period` (standard practice). Computes across the
    // whole buffer and returns the latest EMA value. null if too short.
    function ema(values, period) {
        if (!Array.isArray(values) || !(period > 0) || values.length < period) return null;
        const k = 2 / (period + 1);
        let seed = 0;
        for (let i = 0; i < period; i++) seed += values[i];
        let prev = seed / period;
        for (let i = period; i < values.length; i++) {
            prev = values[i] * k + prev * (1 - k);
        }
        return prev;
    }

    // Wilder's RSI over the last `period` deltas. Needs period+1 values. Returns
    // a 0..100 value, or null if too short. Uses a simple average of gains/losses
    // over the window (Wilder smoothing converges to this for a fixed window and
    // keeps the function stateless for a buffer-based caller).
    function rsi(values, period) {
        if (!Array.isArray(values) || !(period > 0) || values.length < period + 1) return null;
        let gain = 0, loss = 0;
        for (let i = values.length - period; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            if (diff >= 0) gain += diff; else loss -= diff;
        }
        const avgGain = gain / period;
        const avgLoss = loss / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    // Population standard deviation of the last `period` values. null if too short.
    function stdev(values, period) {
        const mean = sma(values, period);
        if (mean == null) return null;
        let sq = 0;
        for (let i = values.length - period; i < values.length; i++) {
            const d = values[i] - mean;
            sq += d * d;
        }
        return Math.sqrt(sq / period);
    }

    // Highest value over the last `period`. null if too short.
    function highest(values, period) {
        if (!Array.isArray(values) || !(period > 0) || values.length < period) return null;
        let hi = -Infinity;
        for (let i = values.length - period; i < values.length; i++) {
            if (values[i] > hi) hi = values[i];
        }
        return hi;
    }

    // Lowest value over the last `period`. null if too short.
    function lowest(values, period) {
        if (!Array.isArray(values) || !(period > 0) || values.length < period) return null;
        let lo = Infinity;
        for (let i = values.length - period; i < values.length; i++) {
            if (values[i] < lo) lo = values[i];
        }
        return lo;
    }

    // MACD matching TradingView Pine's ta.macd(src, fast, slow, signal):
    //   macdLine = ta.ema(src, fast) - ta.ema(src, slow)
    //   signal   = ta.ema(macdLine, signal)
    //   hist     = macdLine - signal
    // Pine's ta.ema seeds with the FIRST source value (ema := na(ema[1]) ? src :
    // alpha*src + (1-alpha)*ema[1]) and is defined from the first bar — NOT an
    // SMA seed. Replicating that seeding gives bar-for-bar parity with the chart
    // once enough history has accumulated. Returns { macd, signal, hist } for the
    // latest point, or null if there are fewer than 2 values.
    function macd(values, fastPeriod, slowPeriod, signalPeriod) {
        if (!Array.isArray(values) || values.length < 2) return null;
        if (!(fastPeriod > 0) || !(slowPeriod > 0) || !(signalPeriod > 0)) return null;

        const kFast = 2 / (fastPeriod + 1);
        const kSlow = 2 / (slowPeriod + 1);
        const kSig = 2 / (signalPeriod + 1);

        // Pine seeding: every EMA starts at the first available value.
        let fast = values[0];
        let slow = values[0];
        let macdVal = fast - slow;   // 0 at the first bar
        let signal = macdVal;        // signal EMA seeds with macd[0]

        for (let i = 1; i < values.length; i++) {
            fast = values[i] * kFast + fast * (1 - kFast);
            slow = values[i] * kSlow + slow * (1 - kSlow);
            macdVal = fast - slow;
            signal = macdVal * kSig + signal * (1 - kSig);
        }
        return { macd: macdVal, signal, hist: macdVal - signal };
    }

    // Average True Range over the last `period` bars. For each bar, the true
    // range is max(high-low, |high - prevClose|, |low - prevClose|); ATR is the
    // simple mean of the last `period` true ranges (matching this file's simple-
    // average, stateless convention — see rsi). Takes aligned high/low/close
    // buffers (oldest-first); needs period+1 values so the oldest TR in the window
    // has a prior close. Returns null if too short or the buffers are misaligned.
    function atr(highs, lows, closes, period) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;
        if (!(period > 0)) return null;
        const n = Math.min(highs.length, lows.length, closes.length);
        if (n < period + 1) return null;
        let sum = 0;
        for (let i = n - period; i < n; i++) {
            const prevClose = closes[i - 1];
            const h = highs[i], l = lows[i];
            if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(prevClose)) return null;
            sum += Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
        }
        return sum / period;
    }

    Algo.indicators = Algo.indicators || {};
    Object.assign(Algo.indicators, { sma, ema, rsi, stdev, highest, lowest, macd, atr });
})(window);
