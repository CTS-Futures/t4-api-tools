/**
 * algo/LiveBroker.js
 *
 * IBroker implementation backed by the real T4APIClient. It binds to the
 * client's currently-subscribed market/account and translates the abstract
 * broker calls into the existing client methods:
 *
 *   buy/sell  -> client.submitOrder(...)        (T4APIClient.js:226)
 *   cancel    -> client.pullOrder(...)          (T4APIClient.js:415)
 *   flatten   -> client.flattenPosition(...)    (T4APIClient.js:478)
 *   position  -> client.positions  map
 *   account   -> client.accountProfits map
 *
 * Events are sourced non-destructively (the same chaining pattern ChartService
 * uses at ChartService.js:439 so we never clobber another consumer):
 *   bar  <- chartService.bus 'bar:close'   (closed OHLCV bar)
 *   tick <- client.onTrade                 (chained)
 *   fill <- client.onFill                  (chained)
 *
 * Strategies act on CLOSED bars; the forming-bar 'bar:update' stream is
 * intentionally not surfaced so live and backtest behaviour agree.
 *
 * NOTE: this layer has NO risk controls — those arrive with RiskManager
 * (step 4). It assumes a demo account and a human watching.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const IBroker = Algo.IBroker;

    class LiveBroker extends IBroker {
        /**
         * @param {Object} cfg
         * @param {T4APIClient} cfg.client
         * @param {ChartService} [cfg.chartService]  Source of closed-bar events.
         */
        constructor({ client, chartService }) {
            super();
            if (!client) throw new Error('LiveBroker requires a T4APIClient');
            this.client = client;
            this.chartService = chartService || null;

            // Bound at attach() so the strategy trades a fixed instrument even
            // if the user later switches the charted market.
            this.marketId = null;
            this.accountId = null;

            this._attached = false;
            this._unsubBar = null;     // off() for the bus 'bar:close' subscription
            this._priorOnTrade = null; // saved client.onTrade for restore on detach
            this._priorOnFill = null;  // saved client.onFill for restore on detach
            this._lastBarTime = null;  // newest emitted bar:close time; drops replayed/rewound bars
        }

        // ---- lifecycle -------------------------------------------------------
        attach() {
            if (this._attached) return;
            this.marketId = this.client.currentMarketId;
            this.accountId = this.client.selectedAccount;
            if (!this.marketId) throw new Error('LiveBroker.attach: no market subscribed');
            if (!this.accountId) throw new Error('LiveBroker.attach: no account selected');

            this._lastBarTime = null; // fresh run: don't drop against a stale baseline

            // Closed bars from the chart's aggregator.
            if (this.chartService?.bus) {
                this._unsubBar = this.chartService.bus.on('bar:close', (bar) => {
                    // The chart only aggregates the active market; guard anyway
                    // in case it switched out from under us.
                    if (this.chartService.activeMarketId &&
                        String(this.chartService.activeMarketId) !== String(this.marketId)) return;
                    const norm = this._normBar(bar);
                    // A chart history reload/backfill/re-subscribe can re-prime the
                    // aggregator to an older bucket and replay a bar that predates
                    // one we already sent. The strategy and DataHealth require
                    // strictly increasing time, so drop the rewound bar here — it
                    // is a feed artifact, not new information. Non-finite times are
                    // passed through so DataHealth still flags them with a reason.
                    if (Number.isFinite(this._lastBarTime) && Number.isFinite(norm.time) &&
                        norm.time <= this._lastBarTime) {
                        console.warn(`LiveBroker: dropped out-of-order bar:close ${norm.time} <= last ${this._lastBarTime}`);
                        return;
                    }
                    if (Number.isFinite(norm.time)) this._lastBarTime = norm.time;
                    this._emit('bar', norm);
                });
            }

            // Chain onTrade (preserve ChartService's wrapper).
            this._priorOnTrade = this.client.onTrade;
            this.client.onTrade = (tick) => {
                if (this._priorOnTrade) { try { this._priorOnTrade(tick); } catch (_) {} }
                if (String(tick?.marketId) === String(this.marketId)) {
                    this._emit('tick', { time: tick.time, price: tick.price, volume: tick.volume });
                }
            };

            // Chain onFill (index.html already assigns one for FillMarkers).
            this._priorOnFill = this.client.onFill;
            this.client.onFill = (fill) => {
                if (this._priorOnFill) { try { this._priorOnFill(fill); } catch (_) {} }
                if (String(fill?.marketId) === String(this.marketId)) {
                    this._emit('fill', {
                        orderId: fill.uniqueId,
                        side: fill.side,
                        time: fill.time,
                        raw: fill.raw
                    });
                }
            };

            this._attached = true;
        }

        detach() {
            if (!this._attached) return;
            if (this._unsubBar) { try { this._unsubBar(); } catch (_) {} this._unsubBar = null; }
            // Restore the chained handlers exactly as we found them.
            this.client.onTrade = this._priorOnTrade;
            this.client.onFill = this._priorOnFill;
            this._priorOnTrade = null;
            this._priorOnFill = null;
            this._attached = false;
        }

        // ---- trading ---------------------------------------------------------
        buy(volume, opts = {})  { return this._submit(1, volume, opts); }
        sell(volume, opts = {}) { return this._submit(-1, volume, opts); }

        _submit(side, volume, { type = 'market', price = 0, tp = null, sl = null } = {}) {
            const qty = Math.max(1, parseInt(volume, 10) || 1);
            // bracketMode='price' submits tp/sl as absolute prices (AOCO_P),
            // matching how the chart context menu places bracketed orders.
            return this.client.submitOrder(side, qty, price, type, tp, sl, false, 'price');
        }

        cancel(orderId) { return this.client.pullOrder(orderId); }

        flatten() {
            // Cancel any working orders for the bound market FIRST, then market
            // out of the net position — matching SimBroker.flatten() (which clears
            // resting orders before flattening). Without this, a bracket's OCO
            // TP/SL leg can outlive an early flatten (e.g. the MomentumScalper tick
            // trailing stop) and re-open a position when it later fills. Order
            // status 1=Working / 4=Held are the live/cancellable states
            // (see index.html getOrderStatusText / isEditable).
            this._cancelWorkingOrders();
            const { net } = this.position();
            if (!net) return;
            return this.client.flattenPosition(this.accountId, this.marketId, net);
        }

        // Pull every working/held order on the bound market for the bound account.
        // getOrders() already filters to the selected account (T4APIClient.js:1773).
        _cancelWorkingOrders() {
            if (typeof this.client.getOrders !== 'function') return;
            let orders;
            try { orders = this.client.getOrders(); } catch (_) { return; }
            for (const o of (orders || [])) {
                if (String(o?.marketId) !== String(this.marketId)) continue;
                if (o.status !== 1 && o.status !== 4) continue; // Working or Held only
                if (!o.uniqueId) continue;
                try { this.client.pullOrder(o.uniqueId); } catch (_) {}
            }
        }

        // ---- state -----------------------------------------------------------
        position() {
            const pos = this.client.positions.get(`${this.accountId}_${this.marketId}`);
            if (!pos) return { net: 0, avgPrice: null };
            const net = (pos.buys ?? 0) - (pos.sells ?? 0);
            const avgRaw = pos.averageOpenPrice?.value;
            const avgPrice = avgRaw != null && Number.isFinite(Number(avgRaw)) ? Number(avgRaw) : null;
            return { net, avgPrice };
        }

        account() {
            const p = this.client.accountProfits.get(this.accountId);
            return {
                balance: p?.balance ?? 0,
                realizedPnl: p?.rpl ?? 0,
                unrealizedPnl: p?.upl ?? 0
            };
        }

        now() { return Date.now(); }

        // Closed bars the chart has already loaded for the bound market. The
        // chart aggregates only its active market, so guard against a mid-run
        // symbol switch. (_historyBars is internal to ChartService but is the
        // only source of pre-loaded history; treated as read-only here.)
        getHistoryBars() {
            const bars = this.chartService?._historyBars;
            if (!Array.isArray(bars) || !bars.length) return [];
            if (this.chartService.activeMarketId &&
                String(this.chartService.activeMarketId) !== String(this.marketId)) return [];
            return bars;
        }

        // ---- helpers ---------------------------------------------------------
        _normBar(bar) {
            return {
                time: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume ?? 0
            };
        }
    }

    Algo.LiveBroker = LiveBroker;
})(window);
