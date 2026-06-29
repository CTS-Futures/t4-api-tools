/**
 * chart/orderflow/TradeTape.js
 *
 * Bounded, time-ordered store of recent executed trades per market, used to
 * draw "trade bubbles" on the liquidity heatmap (where prints hit the book).
 * Mirrors DepthSnapshotBuffer's shape so the renderer can range-query it the
 * same way.
 *
 * Each entry: { time(sec), price, volume, side }  where side is +1 (buy
 * aggressor), -1 (sell aggressor) or 0 (unclassified). Classification is done
 * by the feature via Lee-Ready (price vs prevailing book) before push.
 */
(function (global) {
    'use strict';

    class TradeTape {
        constructor({ capacity = 3000 } = {}) {
            this.capacity = capacity;
            this.byMarket = new Map(); // marketId -> []
        }

        // entry: { time(sec), price, volume, side }. marketId required.
        push(marketId, entry) {
            if (marketId == null || !entry) return;
            if (!Number.isFinite(entry.price) || !Number.isFinite(entry.volume) || entry.volume <= 0) return;
            let buf = this.byMarket.get(marketId);
            if (!buf) { buf = []; this.byMarket.set(marketId, buf); }
            buf.push(entry);
            if (buf.length > this.capacity) buf.splice(0, buf.length - this.capacity);
        }

        // Trades with time >= fromSec (ascending). Upper bound left open: the
        // live edge can sit past the visible range's `to`, and the renderer
        // culls horizontally by pixel.
        range(marketId, fromSec = -Infinity) {
            const buf = this.byMarket.get(marketId);
            if (!buf || buf.length === 0) return [];
            if (fromSec === -Infinity) return buf.slice();
            // Lower bound: first index with time >= fromSec (buf ascending by time).
            let lo = 0, hi = buf.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (buf[mid].time < fromSec) lo = mid + 1;
                else hi = mid;
            }
            return buf.slice(lo);
        }

        clear(marketId) {
            if (marketId == null) this.byMarket.clear();
            else this.byMarket.delete(marketId);
        }
    }

    global.ChartOrderflow = global.ChartOrderflow || {};
    global.ChartOrderflow.TradeTape = TradeTape;
})(window);
