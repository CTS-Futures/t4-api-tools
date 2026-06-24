/**
 * algo/IBroker.js
 *
 * The broker abstraction that every strategy talks to. A strategy NEVER
 * touches T4APIClient directly — it issues intents (buy/sell/cancel/flatten)
 * and reads state (position/account) through this interface, and it receives
 * market + fill events from it.
 *
 * Two concrete implementations share this contract:
 *   - LiveBroker  -> wraps the real T4APIClient (live demo trading)
 *   - SimBroker   -> in-memory matching engine for backtesting (step 2)
 *
 * Because both expose the identical surface, a strategy written once runs
 * unchanged against live data or a historical replay.
 *
 * ---- Event payloads -------------------------------------------------------
 * @typedef {Object} Bar    Closed OHLCV bar (time in UTC seconds).
 * @property {number} time  Bucket start, UTC seconds.
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 *
 * @typedef {Object} Tick   A single trade print (live only; sim is bar-driven).
 * @property {number} time  Epoch ms.
 * @property {number} price
 * @property {number} volume
 *
 * @typedef {Object} Fill   An execution report.
 * @property {string} orderId
 * @property {1|-1}   side   1 = buy, -1 = sell.
 * @property {number} [volume]
 * @property {number} [price]
 * @property {number} [time]
 *
 * @typedef {Object} OrderOpts
 * @property {'market'|'limit'|'stop'} [type='market']
 * @property {number} [price]   Required for limit/stop; ignored for market.
 * @property {number} [tp]      Take-profit absolute price (bracket).
 * @property {number} [sl]      Stop-loss absolute price (bracket).
 *
 * @typedef {Object} Position
 * @property {number} net       buys - sells (negative = short).
 * @property {number|null} avgPrice
 *
 * @typedef {Object} AccountState
 * @property {number} balance
 * @property {number} realizedPnl
 * @property {number} unrealizedPnl
 */
(function (global) {
    'use strict';

    /**
     * Base broker. Provides a tiny event registry shared by both
     * implementations; the trading methods are abstract and throw until
     * overridden, so a half-implemented broker fails loudly rather than
     * silently no-op'ing an order.
     */
    class IBroker {
        constructor() {
            /** @type {Map<string, Set<Function>>} */
            this._listeners = new Map(); // 'bar' | 'tick' | 'fill' -> Set<fn>
        }

        // ---- event registry --------------------------------------------------
        // Returns an unsubscribe function, mirroring ChartEventBus.on().
        on(event, fn) {
            if (typeof fn !== 'function') return () => {};
            let set = this._listeners.get(event);
            if (!set) { set = new Set(); this._listeners.set(event, set); }
            set.add(fn);
            return () => this.off(event, fn);
        }

        off(event, fn) {
            const set = this._listeners.get(event);
            if (set) set.delete(fn);
        }

        _emit(event, payload) {
            const set = this._listeners.get(event);
            if (!set || set.size === 0) return;
            for (const fn of set) {
                try { fn(payload); }
                catch (err) { if (global.console) console.error(`[IBroker] "${event}" listener threw:`, err); }
            }
        }

        // ---- lifecycle (override) -------------------------------------------
        /** Begin streaming events. */
        attach() { throw new Error('IBroker.attach() not implemented'); }
        /** Stop streaming events and release any handler chaining. */
        detach() { throw new Error('IBroker.detach() not implemented'); }

        // ---- trading (override) ---------------------------------------------
        /** @param {number} volume @param {OrderOpts} [opts] @returns {*} order id */
        buy(volume, opts) { throw new Error('IBroker.buy() not implemented'); }
        /** @param {number} volume @param {OrderOpts} [opts] @returns {*} order id */
        sell(volume, opts) { throw new Error('IBroker.sell() not implemented'); }
        /** @param {*} orderId */
        cancel(orderId) { throw new Error('IBroker.cancel() not implemented'); }
        /** Close the open position in the bound market. */
        flatten() { throw new Error('IBroker.flatten() not implemented'); }

        // ---- state (override) ------------------------------------------------
        /** @returns {Position} */
        position() { throw new Error('IBroker.position() not implemented'); }
        /** @returns {AccountState} */
        account() { throw new Error('IBroker.account() not implemented'); }
        /** @returns {number} epoch ms — wall clock (live) or sim clock (backtest). */
        now() { throw new Error('IBroker.now() not implemented'); }

        /**
         * Closed historical bars already available at attach time, oldest-first.
         * Used to warm up a strategy's indicators so it doesn't have to wait for
         * `slow`-many live bars to accumulate. Default: none.
         * @returns {Bar[]}
         */
        getHistoryBars() { return []; }
    }

    global.Algo = global.Algo || {};
    global.Algo.IBroker = IBroker;
})(window);
