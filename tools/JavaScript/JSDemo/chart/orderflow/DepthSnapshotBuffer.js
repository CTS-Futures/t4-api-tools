/**
 * chart/orderflow/DepthSnapshotBuffer.js
 *
 * Bounded, time-ordered store of market-depth snapshots, keyed by marketId.
 * Feeds the DOM liquidity heatmap. Mirrors the role TickStore plays for the
 * candle pipeline, but for the full bid/offer book rather than trade prints.
 *
 * Each stored snapshot is normalized and self-contained:
 *   { time, bids: [{price, volume}], offers: [{price, volume}] }
 *   - time   : UTC epoch SECONDS (chart's axis unit), stamped at capture
 *   - price  : display-scaled number (same units as trade ticks / candles)
 *   - volume : resting size (number)
 *
 * Two bounds keep it cheap under ES/NQ-grade churn:
 *   1. Throttle  — at most one snapshot per `minIntervalMs` per market. Depth
 *                  can update many times/sec; the heatmap can't show more than
 *                  ~one column per few px anyway.
 *   2. Capacity  — a per-market ring of the most recent `capacity` snapshots.
 *                  Older columns scroll off the left, which matches the
 *                  live-only nature of the feed (there is no depth history).
 */
(function (global) {
    'use strict';

    // Coerce a protobuf price/volume field into a JS number. Depth fields arrive
    // as { value: "5800.25" } (Decimal wrapper), plain numbers, or numeric
    // strings. Returns NaN when no usable number is found.
    function num(v, depth) {
        if (v == null) return NaN;
        if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'string') {
            if (v === '') return NaN;
            const n = Number(v);
            return Number.isFinite(n) ? n : NaN;
        }
        if (typeof v === 'object') {
            const d = (depth | 0);
            if (d > 4) return NaN;
            if ('value' in v) {
                const n = num(v.value, d + 1);
                if (Number.isFinite(n)) return n;
            }
            if ('low' in v && 'high' in v) {
                const low = v.low >>> 0;
                const high = v.high | 0;
                return high * 0x100000000 + low;
            }
        }
        return NaN;
    }

    // Normalize one wire-side array (bids or offers) into
    //   { levels:[{price,volume}], max, best }
    // computed in a single pass (no extra iteration downstream):
    //   max  — largest resting volume on the side (for heat normalization)
    //   best — inside-book price (highest bid / lowest offer); `isBid` selects.
    // `cap` (optional) keeps only the N levels nearest the inside book; when it
    // clips, `max` is recomputed over the kept set so the heat normalization
    // matches what actually paints.
    function normSide(arr, isBid, cap) {
        const out = [];
        let max = 0;
        let best = NaN;
        if (!Array.isArray(arr)) return { levels: out, max, best };
        for (const lvl of arr) {
            if (!lvl) continue;
            const price = num(lvl.price, 0);
            const volume = num(lvl.volume, 0);
            if (!Number.isFinite(price) || !Number.isFinite(volume) || volume <= 0) continue;
            out.push({ price, volume });
            if (volume > max) max = volume;
            if (!Number.isFinite(best)) best = price;
            else best = isBid ? (price > best ? price : best) : (price < best ? price : best);
        }
        if (cap != null && Number.isFinite(cap) && out.length > cap) {
            // Keep the `cap` levels nearest the inside book, then recompute max.
            out.sort(isBid ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
            out.length = cap;
            max = 0;
            for (const l of out) if (l.volume > max) max = l.volume;
        }
        return { levels: out, max, best };
    }

    class DepthSnapshotBuffer {
        constructor({ capacity = 4000, minIntervalMs = 100, maxLevelsPerSide = Infinity } = {}) {
            this.capacity = capacity;
            this.minIntervalMs = minIntervalMs;
            this.maxLevelsPerSide = maxLevelsPerSide;
            this.byMarket = new Map(); // marketId -> { buf:[], lastMs:number }
        }

        // Ingest a raw `marketDepth` message. `nowMs` is injectable for tests;
        // defaults to wall-clock. Returns true if a snapshot was stored (i.e. it
        // passed the throttle and carried usable levels), false otherwise.
        push(depth, nowMs = Date.now()) {
            if (!depth || depth.marketId == null) return false;
            let slot = this.byMarket.get(depth.marketId);
            if (!slot) {
                slot = { buf: [], lastMs: 0 };
                this.byMarket.set(depth.marketId, slot);
            }
            if (nowMs - slot.lastMs < this.minIntervalMs) return false;

            const cap = this.maxLevelsPerSide;
            const b = normSide(depth.bids, true, cap);
            const o = normSide(depth.offers, false, cap);
            if (b.levels.length === 0 && o.levels.length === 0) return false;

            slot.lastMs = nowMs;
            slot.buf.push({
                time: Math.floor(nowMs / 1000),
                bids: b.levels,
                offers: o.levels,
                maxVol: b.max > o.max ? b.max : o.max, // largest resting size this snapshot
                bestBid: b.best,
                bestOffer: o.best
            });
            if (slot.buf.length > this.capacity) {
                // Drop oldest in a single shift; amortized O(1) under steady push.
                slot.buf.splice(0, slot.buf.length - this.capacity);
            }
            return true;
        }

        // Snapshots for a market whose timestamp falls within [fromSec, toSec],
        // ascending. `fromSec`/`toSec` are optional; omit for the full buffer.
        // One extra snapshot just before `fromSec` is included so the left-most
        // visible column can be painted to the edge (its width runs up to the
        // first in-range snapshot).
        range(marketId, fromSec = -Infinity, toSec = Infinity) {
            const slot = this.byMarket.get(marketId);
            if (!slot || slot.buf.length === 0) return [];
            const buf = slot.buf;
            // Lower bound: first index with time >= fromSec (buf ascending by time).
            let lo = 0, hi = buf.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (buf[mid].time < fromSec) lo = mid + 1;
                else hi = mid;
            }
            // Upper bound: first index with time > toSec.
            let end = buf.length;
            if (toSec !== Infinity) {
                let a = lo, b = buf.length;
                while (a < b) {
                    const mid = (a + b) >> 1;
                    if (buf[mid].time <= toSec) a = mid + 1;
                    else b = mid;
                }
                end = a;
            }
            // Include one boundary snapshot just before the range so the left-most
            // visible column can paint to the edge (matches prior behaviour).
            const start = lo > 0 ? lo - 1 : 0;
            return buf.slice(start, end);
        }

        // Most recent snapshot for a market, or null.
        latest(marketId) {
            const slot = this.byMarket.get(marketId);
            if (!slot || slot.buf.length === 0) return null;
            return slot.buf[slot.buf.length - 1];
        }

        clear(marketId) {
            if (marketId == null) this.byMarket.clear();
            else this.byMarket.delete(marketId);
        }
    }

    global.ChartOrderflow = global.ChartOrderflow || {};
    global.ChartOrderflow.DepthSnapshotBuffer = DepthSnapshotBuffer;
})(window);
