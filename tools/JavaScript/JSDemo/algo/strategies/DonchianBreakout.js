/**
 * algo/strategies/DonchianBreakout.js
 *
 * Trend-following channel breakout. Long/flat only:
 *   close breaks ABOVE the highest high of the prior `entry` bars -> go long
 *   close breaks BELOW the lowest low  of the prior `exit`  bars  -> go flat
 *
 * The channel is computed from bars BEFORE the current one (the current bar's own
 * high/low are pushed only after the decision), so a breakout is a genuine break
 * of prior range, not a tautology. Decides on CLOSED bars -> backtest == live.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;
    const I = Algo.indicators;

    class DonchianBreakout extends Strategy {
        static get displayName() { return 'Donchian Breakout'; }

        static get params() {
            return [
                { key: 'entry', label: 'Entry Len', type: 'int', default: 20, min: 1, title: 'Breakout above the high of this many prior bars' },
                { key: 'exit', label: 'Exit Len', type: 'int', default: 10, min: 1, title: 'Exit below the low of this many prior bars' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'entryHigh', label: 'Entry High', type: 'line', color: '#ef5350', scale: 'price' },
                { key: 'exitLow', label: 'Exit Low', type: 'line', color: '#26a69a', scale: 'price' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.entry = Math.max(1, parseInt(params.entry, 10) || 20);
            this.exit = Math.max(1, parseInt(params.exit, 10) || 10);
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._highs = [];
            this._lows = [];
            this._cap = Math.max(this.entry, this.exit) + 2;
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`Donchian Breakout armed: entry=${this.entry} exit=${this.exit} qty=${this.qty}`, 'info');
        }

        _push(high, low) {
            if (!Number.isFinite(high) || !Number.isFinite(low)) return;
            this._highs.push(high);
            this._lows.push(low);
            if (this._highs.length > this._cap) { this._highs.shift(); this._lows.shift(); }
        }

        warmup(bars) {
            for (const b of bars) this._push(b?.high, b?.low);
            const ready = this._highs.length >= this.entry;
            this.log(ready
                ? `Warmed up from ${bars.length} bars — channel ready`
                : `Seeded ${this._highs.length} bars; need ${this.entry - this._highs.length} more`, 'info');
        }

        onBar(bar) {
            // Channel from PRIOR bars (current bar not yet pushed).
            const entryHigh = I.highest(this._highs, this.entry);
            const exitLow = I.lowest(this._lows, this.exit);
            // Strategy View: the prior-range channel the close must break.
            if (entryHigh != null) this.plot('entryHigh', entryHigh);
            if (exitLow != null) this.plot('exitLow', exitLow);
            const net = this.position().net;

            if (entryHigh != null && bar.close > entryHigh && net <= 0) {
                if (net < 0) this.flatten();
                this.buy(this.qty, { type: 'market' });
                this.log(`Close ${bar.close} > ${this.entry}-bar high ${entryHigh} -> BUY ${this.qty}`, 'info');
            } else if (exitLow != null && bar.close < exitLow && net > 0) {
                this.flatten();
                this.log(`Close ${bar.close} < ${this.exit}-bar low ${exitLow} -> FLATTEN`, 'info');
            }

            // Now include this bar for future decisions.
            this._push(bar.high, bar.low);
        }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.DonchianBreakout = DonchianBreakout;
})(window);
