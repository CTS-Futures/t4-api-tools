/**
 * chart/features/OrderflowHeatmap.js
 *
 * Chart feature: Bookmap-style DOM liquidity heatmap. Captures full market-depth
 * snapshots from the live feed into a bounded buffer and paints them as a
 * time x price heat grid (behind the candles) via DepthHeatmapRenderer. Also
 * captures executed trades, classifies their aggressor side (Lee-Ready against
 * the prevailing book), and feeds them to the renderer as trade bubbles.
 *
 * Feature contract:
 *   id          : 'orderflow-heatmap'
 *   attach(ctx) : { chart, candleSeries, container, bus, host, client }
 *   detach()    : unwire depth + trade feeds, destroy renderer, drop buffers
 *
 * Live-only by nature: the depth feed has no history, so the heatmap fills in
 * from the right edge as time passes and resets on every market switch. The
 * depth subscription must be DEPTH_LEVELS_NORMAL or wider (set in
 * T4APIClient.subscribeMarket) or only top-of-book will ever paint.
 *
 * Enable/disable is by register/unregister (mirrors IndicatorFeature): the
 * toolbar toggle adds or removes the feature on the host.
 */
(function (global) {
    'use strict';

    class OrderflowHeatmapFeature {
        constructor(opts = {}) {
            this.id = 'orderflow-heatmap';
            this._opts = opts; // { capacity, minIntervalMs, tapeCapacity, maxLevelsPerSide }
            this._client = null;
            this._host = null;
            this._bus = null;
            this._buffer = null;
            this._tape = null;
            this._renderer = null;
            this._priorOnDepth = null;
            this._priorOnTrade = null;
            this._unsubSymbol = null;
            this._unsubBarUpdate = null;
            this._onDepth = this._onDepth.bind(this);
            this._onTrade = this._onTrade.bind(this);
        }

        attach(ctx) {
            const NS = global.ChartOrderflow || {};
            if (!NS.DepthSnapshotBuffer || !NS.DepthHeatmapRenderer) {
                console.error('[OrderflowHeatmap] ChartOrderflow modules not loaded; feature inert');
                return;
            }
            this._client = ctx.client;
            this._host = ctx.host;
            this._bus = ctx.bus;

            this._buffer = new NS.DepthSnapshotBuffer({
                capacity: this._opts.capacity,
                minIntervalMs: this._opts.minIntervalMs,
                maxLevelsPerSide: this._opts.maxLevelsPerSide
            });
            this._tape = NS.TradeTape ? new NS.TradeTape({ capacity: this._opts.tapeCapacity }) : null;
            this._renderer = new NS.DepthHeatmapRenderer({
                chart: ctx.chart,
                series: ctx.candleSeries,
                container: ctx.container,
                host: ctx.host,
                buffer: this._buffer,
                tape: this._tape
            });
            this._renderer.mount();
            this._renderer.setMarket(ctx.host.activeMarketId);

            // Chain the client's depth fan-out (preserve any existing handler).
            this._priorOnDepth = this._client.onDepth;
            const priorDepth = this._priorOnDepth;
            this._client.onDepth = (depth) => {
                if (priorDepth) { try { priorDepth(depth); } catch (_) { /* swallow */ } }
                this._onDepth(depth);
            };

            // Chain the client's trade fan-out for trade bubbles. ChartService
            // already wraps onTrade upstream; chaining again is fine.
            this._priorOnTrade = this._client.onTrade;
            const priorTrade = this._priorOnTrade;
            this._client.onTrade = (tick) => {
                if (priorTrade) { try { priorTrade(tick); } catch (_) { /* swallow */ } }
                this._onTrade(tick);
            };

            // Reset on market switch — depth/trades have no history, start fresh.
            this._unsubSymbol = this._bus.on('symbol:changed', ({ marketId } = {}) => {
                this._buffer.clear();
                if (this._tape) this._tape.clear();
                this._renderer.setMarket(marketId ?? this._host.activeMarketId);
            });

            // Extend the live right-edge column as the forming bar advances even
            // when depth is momentarily quiet. rAF-coalesced inside the renderer.
            this._unsubBarUpdate = this._bus.on('bar:update', () => this._renderer.scheduleRedraw());
        }

        detach() {
            // Restore whatever was there before we wrapped each handler.
            if (this._client) {
                this._client.onDepth = this._priorOnDepth || null;
                this._client.onTrade = this._priorOnTrade || null;
            }
            this._priorOnDepth = null;
            this._priorOnTrade = null;
            if (this._unsubSymbol) { this._unsubSymbol(); this._unsubSymbol = null; }
            if (this._unsubBarUpdate) { this._unsubBarUpdate(); this._unsubBarUpdate = null; }
            if (this._renderer) { this._renderer.destroy(); this._renderer = null; }
            if (this._buffer) { this._buffer.clear(); this._buffer = null; }
            if (this._tape) { this._tape.clear(); this._tape = null; }
            this._client = null;
            this._host = null;
            this._bus = null;
        }

        _onDepth(depth) {
            if (!this._buffer || !this._renderer) return;
            const stored = this._buffer.push(depth);
            // Repaint only when a snapshot for the active market actually landed.
            if (stored && depth && depth.marketId === this._host.activeMarketId) {
                this._renderer.scheduleRedraw();
            }
        }

        _onTrade(tick) {
            if (!this._tape || !this._renderer || !tick) return;
            if (tick.marketId !== this._host.activeMarketId) return;
            const price = Number(tick.price);
            const volume = Number(tick.volume);
            if (!Number.isFinite(price) || !Number.isFinite(volume) || volume <= 0) return;
            this._tape.push(tick.marketId, {
                time: Math.floor((tick.time ?? Date.now()) / 1000),
                price,
                volume,
                side: this._classify(tick.marketId, price)
            });
            this._renderer.scheduleRedraw();
        }

        // Lee-Ready aggressor classification against the prevailing book:
        //   price >= best offer -> buy aggressor (+1)
        //   price <= best bid   -> sell aggressor (-1)
        //   otherwise           -> tick rule vs the last classified print
        // Returns +1 / -1 / 0 (unknown).
        _classify(marketId, price) {
            const snap = this._buffer ? this._buffer.latest(marketId) : null;
            if (snap) {
                const bestBid = snap.bestBid;
                const bestOffer = snap.bestOffer;
                if (Number.isFinite(bestOffer) && price >= bestOffer) { this._lastPrice = price; return 1; }
                if (Number.isFinite(bestBid) && price <= bestBid) { this._lastPrice = price; return -1; }
            }
            // Tick rule fallback when the print sits inside the spread.
            let side = 0;
            if (Number.isFinite(this._lastPrice)) {
                if (price > this._lastPrice) side = 1;
                else if (price < this._lastPrice) side = -1;
            }
            this._lastPrice = price;
            return side;
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.OrderflowHeatmap = OrderflowHeatmapFeature;
})(window);
