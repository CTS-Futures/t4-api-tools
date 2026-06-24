/**
 * algo/strategies/SmaCrossover.js
 *
 * Textbook moving-average crossover, used as the reference strategy proving
 * the live path end-to-end. Long/flat only (no shorting) to keep step 1 easy
 * to reason about:
 *
 *   fast SMA crosses ABOVE slow SMA  -> go long  (market buy `qty`)
 *   fast SMA crosses BELOW slow SMA  -> go flat  (flatten)
 *
 * It decides only on CLOSED bars (onBar), so the same logic produces identical
 * signals under the backtester's bar replay in step 2. SMA is computed inline
 * to keep the strategy self-contained (no dependency on the chart's indicator
 * module).
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;

    function sma(values, period) {
        if (values.length < period) return null;
        let sum = 0;
        for (let i = values.length - period; i < values.length; i++) sum += values[i];
        return sum / period;
    }

    class SmaCrossover extends Strategy {
        static get displayName() { return 'SMA Crossover'; }

        static get params() {
            return [
                { key: 'fast', label: 'Fast', type: 'int', default: 9, min: 1, title: 'Fast SMA period' },
                { key: 'slow', label: 'Slow', type: 'int', default: 21, min: 2, title: 'Slow SMA period' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'fast', label: 'Fast SMA', type: 'line', color: '#f6a609', scale: 'price' },
                { key: 'slow', label: 'Slow SMA', type: 'line', color: '#7e57c2', scale: 'price' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.fast = Math.max(1, parseInt(params.fast, 10) || 9);
            this.slow = Math.max(this.fast + 1, parseInt(params.slow, 10) || 21);
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._closes = [];
            this._prevFast = null;
            this._prevSlow = null;
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`SMA Crossover armed: fast=${this.fast} slow=${this.slow} qty=${this.qty}`, 'info');
        }

        // Seed closes (and the prior SMA readings) from loaded history so the
        // first LIVE bar can already detect a crossover relative to history.
        warmup(bars) {
            for (const b of bars) {
                if (!Number.isFinite(b?.close)) continue;
                this._closes.push(b.close);
                if (this._closes.length > this.slow + 2) this._closes.shift();
            }
            this._prevFast = sma(this._closes, this.fast);
            this._prevSlow = sma(this._closes, this.slow);
            const ready = this._prevFast != null && this._prevSlow != null;
            if (ready) {
                this.log(`Warmed up from ${bars.length} historical bars — evaluating on each new bar close`, 'info');
            } else {
                const need = this.slow - this._closes.length;
                this.log(`Seeded ${this._closes.length} bars from history; need ${need} more bar closes before first signal`, 'info');
            }
        }

        onBar(bar) {
            this._closes.push(bar.close);
            // Bound memory: we only ever need `slow` lookback.
            if (this._closes.length > this.slow + 2) this._closes.shift();

            const fastNow = sma(this._closes, this.fast);
            const slowNow = sma(this._closes, this.slow);
            if (fastNow == null || slowNow == null) return; // warming up

            // Expose the readings that drive the decision for the Strategy View.
            this.plot('fast', fastNow);
            this.plot('slow', slowNow);

            // Need a prior reading to detect a crossing.
            if (this._prevFast != null && this._prevSlow != null) {
                const crossedUp = this._prevFast <= this._prevSlow && fastNow > slowNow;
                const crossedDown = this._prevFast >= this._prevSlow && fastNow < slowNow;
                const net = this.position().net;

                if (crossedUp && net <= 0) {
                    if (net < 0) this.flatten();
                    this.buy(this.qty, { type: 'market' });
                    this.log(`Cross UP @ ${bar.close} -> BUY ${this.qty}`, 'info');
                } else if (crossedDown && net > 0) {
                    this.flatten();
                    this.log(`Cross DOWN @ ${bar.close} -> FLATTEN`, 'info');
                }
            }

            this._prevFast = fastNow;
            this._prevSlow = slowNow;
        }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.SmaCrossover = SmaCrossover;
})(window);
