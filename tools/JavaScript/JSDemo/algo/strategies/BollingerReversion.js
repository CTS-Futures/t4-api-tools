/**
 * algo/strategies/BollingerReversion.js
 *
 * Mean-reversion on Bollinger Bands. Long/flat only:
 *   close crosses BELOW the lower band   -> go long  (market buy `qty`)
 *   close returns to/above the mid band  -> go flat  (flatten)
 *
 * Bands = SMA(period) ± mult * stdev(period). Decides only on CLOSED bars, so
 * backtest and live are identical. Uses shared Algo.indicators.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;
    const I = Algo.indicators;

    class BollingerReversion extends Strategy {
        static get displayName() { return 'Bollinger Reversion'; }

        static get params() {
            return [
                { key: 'period', label: 'Period', type: 'int', default: 20, min: 2, title: 'SMA / band lookback' },
                { key: 'mult', label: 'Std Mult', type: 'float', default: 2.0, min: 0.1, step: 'any', title: 'Band width in standard deviations' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'upper', label: 'Upper Band', type: 'line', color: '#ef5350', scale: 'price' },
                { key: 'mid', label: 'Mid (SMA)', type: 'line', color: '#7e57c2', scale: 'price' },
                { key: 'lower', label: 'Lower Band', type: 'line', color: '#26a69a', scale: 'price' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.period = Math.max(2, parseInt(params.period, 10) || 20);
            this.mult = Number.isFinite(parseFloat(params.mult)) && parseFloat(params.mult) > 0 ? parseFloat(params.mult) : 2.0;
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._closes = [];
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`Bollinger Reversion armed: period=${this.period} mult=${this.mult} qty=${this.qty}`, 'info');
        }

        _push(close) {
            if (!Number.isFinite(close)) return;
            this._closes.push(close);
            if (this._closes.length > this.period + 2) this._closes.shift();
        }

        warmup(bars) {
            for (const b of bars) this._push(b?.close);
            const ready = I.sma(this._closes, this.period) != null;
            this.log(ready
                ? `Warmed up from ${bars.length} bars — bands ready`
                : `Seeded ${this._closes.length} bars; need ${this.period - this._closes.length} more closes`, 'info');
        }

        onBar(bar) {
            this._push(bar.close);
            const mid = I.sma(this._closes, this.period);
            const sd = I.stdev(this._closes, this.period);
            if (mid == null || sd == null) return; // warming up

            const lower = mid - this.mult * sd;
            // Strategy View: the full band the decision is measured against.
            this.plot('upper', mid + this.mult * sd);
            this.plot('mid', mid);
            this.plot('lower', lower);
            const net = this.position().net;

            if (bar.close < lower && net <= 0) {
                if (net < 0) this.flatten();
                this.buy(this.qty, { type: 'market' });
                this.log(`Close ${bar.close} < lower ${lower.toFixed(4)} -> BUY ${this.qty}`, 'info');
            } else if (bar.close >= mid && net > 0) {
                this.flatten();
                this.log(`Close ${bar.close} >= mid ${mid.toFixed(4)} -> FLATTEN`, 'info');
            }
        }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.BollingerReversion = BollingerReversion;
})(window);
