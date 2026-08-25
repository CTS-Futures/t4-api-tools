/**
 * algo/strategies/RsiReversion.js
 *
 * Mean-reversion on Wilder's RSI. Long/flat only:
 *   RSI crosses DOWN through `oversold`  -> go long  (market buy `qty`)
 *   RSI crosses UP through `exit`        -> go flat  (flatten)
 *
 * Decides only on CLOSED bars so backtest and live produce identical signals.
 * Uses the shared Algo.indicators.rsi over a bounded `_closes` buffer.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;
    const I = Algo.indicators;

    class RsiReversion extends Strategy {
        static get displayName() { return 'RSI Reversion'; }

        static get params() {
            return [
                { key: 'period', label: 'RSI Period', type: 'int', default: 14, min: 2, title: 'RSI lookback' },
                { key: 'oversold', label: 'Oversold', type: 'float', default: 30, min: 1, max: 99, step: 'any', title: 'Enter long when RSI dips below this' },
                { key: 'exit', label: 'Exit', type: 'float', default: 50, min: 1, max: 99, step: 'any', title: 'Flatten when RSI rises above this' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'rsi', label: 'RSI', type: 'line', color: '#42a5f5', scale: 'osc' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.period = Math.max(2, parseInt(params.period, 10) || 14);
            this.oversold = Number.isFinite(parseFloat(params.oversold)) ? parseFloat(params.oversold) : 30;
            this.exit = Number.isFinite(parseFloat(params.exit)) ? parseFloat(params.exit) : 50;
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._closes = [];
            this._prevRsi = null;
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`RSI Reversion armed: period=${this.period} oversold=${this.oversold} exit=${this.exit} qty=${this.qty}`, 'info');
        }

        _push(close) {
            if (!Number.isFinite(close)) return;
            this._closes.push(close);
            // Need period+1 values for one RSI reading; keep a small margin.
            if (this._closes.length > this.period + 2) this._closes.shift();
        }

        warmup(bars) {
            for (const b of bars) this._push(b?.close);
            this._prevRsi = I.rsi(this._closes, this.period);
            this.log(this._prevRsi != null
                ? `Warmed up from ${bars.length} bars — RSI ready`
                : `Seeded ${this._closes.length} bars; need more closes before first RSI`, 'info');
        }

        onBar(bar) {
            this._push(bar.close);
            const rsiNow = I.rsi(this._closes, this.period);
            if (rsiNow == null) return; // warming up
            this.plot('rsi', rsiNow); // Strategy View

            if (this._prevRsi != null) {
                const net = this.position().net;
                const crossedDownOversold = this._prevRsi >= this.oversold && rsiNow < this.oversold;
                const crossedUpExit = this._prevRsi <= this.exit && rsiNow > this.exit;

                if (crossedDownOversold && net <= 0) {
                    if (net < 0) this.flatten();
                    this.buy(this.qty, { type: 'market' });
                    this.log(`RSI ${rsiNow.toFixed(1)} < ${this.oversold} @ ${bar.close} -> BUY ${this.qty}`, 'info');
                } else if (crossedUpExit && net > 0) {
                    this.flatten();
                    this.log(`RSI ${rsiNow.toFixed(1)} > ${this.exit} @ ${bar.close} -> FLATTEN`, 'info');
                }
            }
            this._prevRsi = rsiNow;
        }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.RsiReversion = RsiReversion;
})(window);
