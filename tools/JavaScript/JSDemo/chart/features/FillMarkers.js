/**
 * chart/features/FillMarkers.js
 *
 * Feature module: renders triangle markers on the candle series for fills
 * (own trades) on the currently-active market.
 *
 * Wiring (done by host glue, not this module):
 *   client.onFill = (fill) => chartService.getFeature('fill-markers')?.addFill(fill);
 *
 * Price extraction is defensive: the T4 proto field name for the matched
 * price varies (tradePrice / matchedPrice / price). We probe in order and
 * scale by the market's decimals if the value looks like a raw integer.
 *
 * Marker time is the real fill timestamp, snapped down to the active bar
 * bucket so it lands exactly on a candle (Lightweight Charts renders markers
 * by time; aligning to a bar avoids partial-bar drift on coarser intervals).
 * Falls back to the latest known bar time when no fill timestamp is parseable.
 */
(function (global) {
    'use strict';

    function extractPrice(fill, decimals) {
        const raw = fill.raw || {};
        const candidates = [
            raw.tradePrice?.value, raw.tradePrice,
            raw.matchedPrice?.value, raw.matchedPrice,
            raw.price?.value, raw.price,
            raw.currentLimitPrice?.value
        ];
        for (const c of candidates) {
            const n = Number(c);
            if (!Number.isFinite(n) || n <= 0) continue;
            // Heuristic: if value looks like a raw integer (much larger than
            // typical display prices) and decimals > 0, scale it down. Values
            // that already include a decimal point pass through.
            if (decimals > 0 && Number.isInteger(n) && n >= Math.pow(10, decimals)) {
                return n / Math.pow(10, decimals);
            }
            return n;
        }
        return null;
    }

    function extractVolume(fill) {
        const raw = fill.raw || {};
        const candidates = [
            raw.tradeVolume, raw.matchedVolume, raw.volume, raw.fillVolume
        ];
        for (const c of candidates) {
            const n = Number(c?.value ?? c);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return null;
    }

    // Parse a fill timestamp into UTC epoch seconds. The proto sends mixed
    // shapes depending on field: Timestamp {seconds,nanos}, an ISO string
    // (CST wall-clock, no offset, as produced by the Chart API), or already a
    // JS millisecond number. Returns null on failure so callers can fall back.
    function parseFillTimeSec(fill) {
        const candidates = [
            fill.time,
            fill.raw?.time,
            fill.raw?.exchangeTime
        ];
        for (const c of candidates) {
            if (c == null) continue;
            // Protobuf Timestamp.
            if (typeof c === 'object' && c.seconds != null) {
                const s = Number(c.seconds);
                if (Number.isFinite(s) && s > 0) return Math.floor(s);
            }
            // Number: ms (>= year 2001) or seconds.
            if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
                return c > 1e12 ? Math.floor(c / 1000) : Math.floor(c);
            }
            // String: CST wall-clock ISO. Convert via the host helper if
            // available; otherwise treat as parseable Date.
            if (typeof c === 'string') {
                const fn = global.ChartService?._internals?.csTimeToUtcSec
                    || global.csTimeToUtcSec;
                if (typeof fn === 'function') {
                    const sec = fn(c);
                    if (Number.isFinite(sec)) return sec;
                }
                const ms = Date.parse(c);
                if (Number.isFinite(ms)) return Math.floor(ms / 1000);
            }
        }
        return null;
    }

    // Snap an epoch-second time down to the bar bucket boundary so the marker
    // aligns with a candle. intervalMs is read from the live aggregator.
    function snapToBucketSec(sec, intervalMs) {
        if (!Number.isFinite(sec) || !Number.isFinite(intervalMs) || intervalMs <= 0) return sec;
        const ms = sec * 1000;
        return Math.floor(ms / intervalMs) * intervalMs / 1000;
    }

    class FillMarkersFeature {
        constructor({ maxMarkers = 200 } = {}) {
            this.id = 'fill-markers';
            this._series = null;
            this._client = null;
            this._host = null;
            this._unsubSymbol = null;
            this._unsubBarUpd = null;
            this._unsubBarsLoaded = null;
            this._latestBarTime = null;
            this._markersByMarket = new Map(); // marketId -> [marker]
            this._maxMarkers = maxMarkers;
        }

        attach(ctx) {
            this._series = ctx.candleSeries;
            this._client = ctx.client;
            this._host = ctx.host;
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => this._render());
            this._unsubBarUpd = ctx.bus.on('bar:update', (b) => { this._latestBarTime = b?.time ?? this._latestBarTime; });
            this._unsubBarsLoaded = ctx.bus.on('bars:loaded', ({ bars }) => {
                if (bars && bars.length) this._latestBarTime = bars[bars.length - 1].time;
                this._render();
            });
        }

        detach() {
            if (this._unsubSymbol) this._unsubSymbol();
            if (this._unsubBarUpd) this._unsubBarUpd();
            if (this._unsubBarsLoaded) this._unsubBarsLoaded();
            try { this._series?.setMarkers([]); } catch (_) { /* gone */ }
            this._series = null;
            this._client = null;
            this._host = null;
        }

        addFill(fill) {
            if (!fill || !fill.marketId) return;
            const decimals = this._host?.knownDecimals ?? 2;
            const price = extractPrice(fill, decimals);
            if (!Number.isFinite(price)) return;
            const volume = extractVolume(fill);
            const side = fill.side; // 1 buy, -1 sell

            // Prefer the real fill timestamp snapped to the active bar bucket;
            // fall back to the latest seen bar time so the marker still renders
            // when the proto timestamp is missing or unparseable.
            const fillSec = parseFillTimeSec(fill);
            const intervalMs = this._host?.aggregator?.intervalMs ?? this._host?.intervalMs ?? 60_000;
            let time = fillSec != null
                ? snapToBucketSec(fillSec, intervalMs)
                : (this._latestBarTime ?? Math.floor(Date.now() / 1000));
            // Safety: never let the marker land in the future of the latest bar.
            if (this._latestBarTime != null && time > this._latestBarTime) {
                time = this._latestBarTime;
            }

            const marker = {
                time,
                position: side === 1 ? 'belowBar' : 'aboveBar',
                color: side === 1 ? '#26a69a' : '#ef5350',
                shape: side === 1 ? 'arrowUp' : 'arrowDown',
                text: `${side === 1 ? 'B' : 'S'}${volume ? ' ' + volume : ''} @ ${price}`
            };

            let list = this._markersByMarket.get(String(fill.marketId));
            if (!list) {
                list = [];
                this._markersByMarket.set(String(fill.marketId), list);
            }
            list.push(marker);
            // Cap memory; markers are display-only.
            if (list.length > this._maxMarkers) list.splice(0, list.length - this._maxMarkers);

            // Host activeMarketId is a REST-string; fill.marketId is protobuf numeric/Long.
            if (String(this._host?.activeMarketId) === String(fill.marketId)) this._render();
        }

        clearForMarket(marketId) {
            this._markersByMarket.delete(marketId);
            if (String(this._host?.activeMarketId) === String(marketId)) this._render();
        }

        _render() {
            if (!this._series) return;
            const list = this._markersByMarket.get(String(this._host?.activeMarketId)) || [];
            // setMarkers requires ascending time order.
            const sorted = list.slice().sort((a, b) => a.time - b.time);
            try { this._series.setMarkers(sorted); } catch (err) { console.error(err); }
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.FillMarkers = FillMarkersFeature;
})(window);
