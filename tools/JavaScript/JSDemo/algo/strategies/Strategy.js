/**
 * algo/strategies/Strategy.js
 *
 * Base class for all trading strategies. A strategy is pure decision logic:
 * it reacts to market events and issues intents through the broker. It must
 * not know whether the broker is live or simulated — that is the whole point
 * of the IBroker abstraction (see algo/IBroker.js).
 *
 * Lifecycle, driven by AlgoRunner:
 *   init(broker, ctx)  once, before any events
 *   onBar(bar)         on each CLOSED bar      (primary entry point)
 *   onTick(tick)       on each trade print     (live only; optional)
 *   onFill(fill)       on each execution        (optional)
 *   teardown()         once, on stop            (optional)
 *
 * Subclasses override the on-event/lifecycle hooks. The buy/sell/flatten helpers
 * just forward to the broker so strategy code stays terse.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    class Strategy {
        /** @param {Object} [params] Strategy-specific tunables. */
        constructor(params = {}) {
            this.params = params;
            /** @type {import('../IBroker').IBroker|null} */
            this.broker = null;
            /** @type {(msg:string, level?:string)=>void} */
            this._log = () => {};
            /**
             * Per-bar scratch for the Strategy View chart: values the strategy
             * computes this bar (indicator readings) keyed by plot key. Filled by
             * plot() during onBar, drained by the runner/backtester after onBar.
             * @type {Object<string, number>}
             */
            this._plot = {};
        }

        /** Human-readable name shown in the UI. Override per strategy. */
        static get displayName() { return 'Strategy'; }

        /**
         * Traces this strategy draws on the Strategy View chart, used by the UI
         * to create the right series (so adding a strategy needs no chart edits).
         * The strategy is the single source of truth for its own indicators —
         * declare here, emit the matching values via plot() in onBar(). Each item:
         *   { key, label, type:'line'|'histogram', color, scale:'price'|'osc' }
         * `scale:'price'` shares the sub-chart's price scale (alongside a context
         * close line); `scale:'osc'` gets a separate overlay scale for bounded /
         * centered oscillators (RSI, MACD). Override per strategy; default none.
         * @returns {Array<Object>}
         */
        static get plots() { return []; }

        /**
         * Tunable parameters this strategy exposes, used by the UI panels to
         * render inputs dynamically (so adding a strategy needs no panel edits).
         * Override per strategy. Each item:
         *   { key, label, type:'int'|'float', default, min?, max?, step?, title? }
         * @returns {Array<Object>}
         */
        static get params() { return []; }

        // ---- lifecycle (override as needed) ---------------------------------
        /**
         * @param {import('../IBroker').IBroker} broker
         * @param {Object} ctx  { log } supplied by the runner.
         */
        init(broker, ctx = {}) {
            this.broker = broker;
            if (typeof ctx.log === 'function') this._log = ctx.log;
        }

        /**
         * Prime indicators from already-loaded history so the strategy is
         * "warm" the moment it starts, instead of waiting for live bars to
         * accumulate. Called once by the runner after init(), before events.
         * Must NOT place orders — it only seeds internal state.
         * @param {import('../IBroker').Bar[]} bars  Oldest-first closed bars.
         */
        warmup(/* bars */) {}

        /** @param {import('../IBroker').Bar} bar */
        onBar(/* bar */) {}
        /** @param {import('../IBroker').Tick} tick */
        onTick(/* tick */) {}
        /** @param {import('../IBroker').Fill} fill */
        onFill(/* fill */) {}
        teardown() {}

        // ---- helpers ---------------------------------------------------------
        buy(volume, opts)  { return this.broker.buy(volume, opts); }
        sell(volume, opts) { return this.broker.sell(volume, opts); }
        flatten()          { return this.broker.flatten(); }
        position()         { return this.broker.position(); }
        log(msg, level)    { this._log(msg, level); }

        /**
         * Record an indicator value for this bar so the Strategy View chart can
         * plot it. Only keys declared in static plots are rendered; others are
         * harmless. No-op cost for strategies that never call it.
         * @param {string} key  Matches a `key` in static plots.
         * @param {number} value
         */
        plot(key, value) { if (Number.isFinite(value)) this._plot[key] = value; }

        /** Take and clear this bar's plotted values. Called by the runner/backtester. */
        _drainPlots() { const p = this._plot; this._plot = {}; return p; }
    }

    Algo.Strategy = Strategy;
})(window);
