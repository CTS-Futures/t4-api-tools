/**
 * algo/strategies/MacdCross.js
 *
 * Trend/momentum via MACD — a strategy port of the Pine v6 "Custom MACD
 * Indicator". Uses Algo.indicators.macd, which replicates TradingView's
 * ta.macd(src, fast, slow, signal) exactly (EMA-seeded from the first bar), so
 * the crossovers line up with the chart. Long/flat only:
 *   MACD line crosses ABOVE its signal line (hist crosses 0 up)   -> go long
 *   MACD line crosses BELOW its signal line (hist crosses 0 down)  -> go flat
 *
 * The Pine histogram coloring is purely cosmetic and has no strategy meaning, so
 * it's dropped. Decides on CLOSED bars -> backtest == live. The generous `_closes`
 * buffer lets the seeded EMAs converge to the chart's full-history values.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;
    const I = Algo.indicators;

    class MacdCross extends Strategy {
        static get displayName() { return 'MACD Crossover'; }

        static get params() {
            return [
                { key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1, title: 'Fast EMA period' },
                { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 2, title: 'Slow EMA period' },
                { key: 'signal', label: 'Signal', type: 'int', default: 9, min: 1, title: 'Signal EMA period' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'hist', label: 'Histogram', type: 'histogram', color: '#90a4ae', scale: 'osc' },
                { key: 'macd', label: 'MACD', type: 'line', color: '#2962ff', scale: 'osc' },
                { key: 'signal', label: 'Signal', type: 'line', color: '#ff6d00', scale: 'osc' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.fast = Math.max(1, parseInt(params.fast, 10) || 12);
            this.slow = Math.max(this.fast + 1, parseInt(params.slow, 10) || 26);
            this.signal = Math.max(1, parseInt(params.signal, 10) || 9);
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._closes = [];
            // Generous buffer so the seeded EMAs converge to stable values.
            this._cap = this.slow + this.signal + 250;
            this._prevHist = null;
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`MACD Crossover armed: fast=${this.fast} slow=${this.slow} signal=${this.signal} qty=${this.qty}`, 'info');
        }

        _push(close) {
            if (!Number.isFinite(close)) return;
            this._closes.push(close);
            if (this._closes.length > this._cap) this._closes.shift();
        }

        warmup(bars) {
            for (const b of bars) this._push(b?.close);
            const m = I.macd(this._closes, this.fast, this.slow, this.signal);
            this._prevHist = m ? m.hist : null;
            this.log(m != null
                ? `Warmed up from ${bars.length} bars — MACD ready (matches TradingView ta.macd)`
                : `Seeded ${this._closes.length} bars; need at least 2 closes before first MACD`, 'info');
        }

        onBar(bar) {
            this._push(bar.close);
            const m = I.macd(this._closes, this.fast, this.slow, this.signal);
            if (m == null) return; // warming up
            // Strategy View: the MACD/signal/histogram the cross is read from.
            this.plot('macd', m.macd);
            this.plot('signal', m.signal);
            this.plot('hist', m.hist);

            if (this._prevHist != null) {
                const net = this.position().net;
                const crossedUp = this._prevHist <= 0 && m.hist > 0;
                const crossedDown = this._prevHist >= 0 && m.hist < 0;

                if (crossedUp && net <= 0) {
                    if (net < 0) this.flatten();
                    this.buy(this.qty, { type: 'market' });
                    this.log(`MACD cross UP @ ${bar.close} -> BUY ${this.qty}`, 'info');
                } else if (crossedDown && net > 0) {
                    this.flatten();
                    this.log(`MACD cross DOWN @ ${bar.close} -> FLATTEN`, 'info');
                }
            }
            this._prevHist = m.hist;
        }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.MacdCross = MacdCross;
})(window);
