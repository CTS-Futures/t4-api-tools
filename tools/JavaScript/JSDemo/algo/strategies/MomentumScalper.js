/**
 * algo/strategies/MomentumScalper.js
 *
 * A fast-paced, two-sided day-trading scalper. Intended for SHORT bar intervals
 * (15s–60s). Unlike the other strategies in this library it goes LONG and SHORT,
 * and it uses a HYBRID exit model:
 *
 *   Entries (CLOSED bars, backtestable): EMA(fast) crossing EMA(slow) flips the
 *     position — cross up => go long, cross down => go short. Every entry is a
 *     market order carrying an ATR-sized bracket (take-profit + stop-loss as
 *     ABSOLUTE prices).
 *
 *   Exits:
 *     - Bracket TP/SL is the system-of-record exit and behaves identically in
 *       both worlds: live, T4 manages the OCO server-side; in backtest,
 *       SimBroker scans the OCO pair against each bar's range
 *       (SimBroker._installBracket / _scanResting).
 *     - A live-only `onTick` trailing stop ratchets on every trade print and
 *       flattens early on a reversal. It is FLOORED at the hard bracket stop, so
 *       it only ever tightens beyond the protective stop (never sits inside it,
 *       avoiding an instant stop-out right after entry). `onTick` never fires in
 *       backtest (SimBroker emits no 'tick'), so backtests exit on the bracket
 *       alone — the trailing ratchet is a live accelerator, documented as such.
 *     - A `maxHoldBars` time stop on closed bars keeps holds short.
 *
 * Live fills carry no reliable price (LiveBroker emits only orderId/side/time),
 * so bracket levels and the trailing baseline are referenced off the decision
 * bar's CLOSE, not the fill. Position is reconciled against the broker's actual
 * net each bar/tick so a bracket exit is detected without depending on fills.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const Strategy = Algo.Strategy;
    const I = Algo.indicators;

    const pf = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : d; };

    class MomentumScalper extends Strategy {
        static get displayName() { return 'Momentum Scalper'; }

        static get params() {
            return [
                { key: 'emaFast', label: 'EMA Fast', type: 'int', default: 9, min: 1, title: 'Fast EMA length (trend/direction)' },
                { key: 'emaSlow', label: 'EMA Slow', type: 'int', default: 21, min: 2, title: 'Slow EMA length; a cross flips the position' },
                { key: 'atrPeriod', label: 'ATR Len', type: 'int', default: 14, min: 1, title: 'ATR lookback for bracket / trail sizing' },
                { key: 'tpAtr', label: 'TP ×ATR', type: 'float', default: 1.5, min: 0.1, step: 'any', title: 'Take-profit distance in ATRs' },
                { key: 'slAtr', label: 'SL ×ATR', type: 'float', default: 1.0, min: 0.1, step: 'any', title: 'Stop-loss distance in ATRs (hard bracket stop)' },
                { key: 'trailAtr', label: 'Trail ×ATR', type: 'float', default: 0.75, min: 0.1, step: 'any', title: 'Live trailing-stop distance in ATRs (live only)' },
                { key: 'maxHoldBars', label: 'Max Hold', type: 'int', default: 10, min: 0, title: 'Time stop: flatten after this many bars (0 = off)' },
                { key: 'qty', label: 'Qty', type: 'int', default: 1, min: 1, title: 'Contracts per entry' }
            ];
        }

        static get plots() {
            return [
                { key: 'emaFast', label: 'EMA Fast', type: 'line', color: '#f6a609', scale: 'price' },
                { key: 'emaSlow', label: 'EMA Slow', type: 'line', color: '#7e57c2', scale: 'price' },
                { key: 'target', label: 'Target', type: 'line', color: '#26a69a', scale: 'price' },
                { key: 'stop', label: 'Stop', type: 'line', color: '#ef5350', scale: 'price' }
            ];
        }

        constructor(params = {}) {
            super(params);
            this.emaFast = Math.max(1, parseInt(params.emaFast, 10) || 9);
            this.emaSlow = Math.max(this.emaFast + 1, parseInt(params.emaSlow, 10) || 21);
            this.atrPeriod = Math.max(1, parseInt(params.atrPeriod, 10) || 14);
            this.tpAtr = pf(params.tpAtr, 1.5);
            this.slAtr = pf(params.slAtr, 1.0);
            this.trailAtr = pf(params.trailAtr, 0.75);
            const mhb = parseInt(params.maxHoldBars, 10);
            this.maxHoldBars = Number.isFinite(mhb) && mhb >= 0 ? mhb : 10;
            this.qty = Math.max(1, parseInt(params.qty, 10) || 1);

            this._closes = [];
            this._highs = [];
            this._lows = [];
            // Keep enough history for the EMA to converge (≈3× the slow length)
            // and for ATR; capped identically live and in backtest so values agree.
            this._cap = Math.max(this.emaSlow * 3, this.atrPeriod + 1) + 2;
            this._prevFast = null;
            this._prevSlow = null;
            // { side:1|-1, entryRef, stop, target, extreme, barsHeld, atrAtEntry } | null
            this._pos = null;
        }

        init(broker, ctx) {
            super.init(broker, ctx);
            this.log(`Momentum Scalper armed: ema=${this.emaFast}/${this.emaSlow} atr=${this.atrPeriod} ` +
                `tp=${this.tpAtr}× sl=${this.slAtr}× trail=${this.trailAtr}× maxHold=${this.maxHoldBars} qty=${this.qty}`, 'info');
        }

        _push(high, low, close) {
            if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;
            this._highs.push(high);
            this._lows.push(low);
            this._closes.push(close);
            if (this._closes.length > this._cap) {
                this._highs.shift(); this._lows.shift(); this._closes.shift();
            }
        }

        warmup(bars) {
            for (const b of bars) this._push(b?.high, b?.low, b?.close);
            this._prevFast = I.ema(this._closes, this.emaFast);
            this._prevSlow = I.ema(this._closes, this.emaSlow);
            const ready = this._prevFast != null && this._prevSlow != null &&
                I.atr(this._highs, this._lows, this._closes, this.atrPeriod) != null;
            this.log(ready
                ? `Warmed up from ${bars.length} bars — indicators ready`
                : `Seeded ${this._closes.length} bars; still warming up`, 'info');
        }

        _enter(side, ref, atrNow) {
            const stop = side > 0 ? ref - this.slAtr * atrNow : ref + this.slAtr * atrNow;
            const target = side > 0 ? ref + this.tpAtr * atrNow : ref - this.tpAtr * atrNow;
            const opts = { type: 'market', tp: target, sl: stop };
            if (side > 0) this.buy(this.qty, opts); else this.sell(this.qty, opts);
            this._pos = { side, entryRef: ref, stop, target, extreme: ref, barsHeld: 0, atrAtEntry: atrNow };
            this.plot('stop', stop);
            this.plot('target', target);
            this.log(`${side > 0 ? 'LONG' : 'SHORT'} ${this.qty} @ ~${ref} ` +
                `tp=${target.toFixed(4)} sl=${stop.toFixed(4)} (atr=${atrNow.toFixed(4)})`, 'info');
        }

        onBar(bar) {
            // Reconcile: a bracket TP/SL (or a stop on stop) may have exited us
            // since the last bar. Trust the broker's actual net over our cached
            // state — fills don't carry a reliable price to track ourselves.
            if (this._pos && this.position().net === 0) this._pos = null;

            this._push(bar.high, bar.low, bar.close);

            const fastNow = I.ema(this._closes, this.emaFast);
            const slowNow = I.ema(this._closes, this.emaSlow);
            const atrNow = I.atr(this._highs, this._lows, this._closes, this.atrPeriod);
            if (fastNow == null || slowNow == null || atrNow == null) {
                this._prevFast = fastNow; this._prevSlow = slowNow;
                return; // warming up
            }
            this.plot('emaFast', fastNow);
            this.plot('emaSlow', slowNow);

            // Manage an open position: time stop + keep the bracket lines drawn.
            if (this._pos) {
                this._pos.barsHeld += 1;
                this.plot('stop', this._pos.stop);
                this.plot('target', this._pos.target);
                if (this.maxHoldBars > 0 && this._pos.barsHeld >= this.maxHoldBars) {
                    this.flatten();
                    this.log(`Time stop after ${this._pos.barsHeld} bars -> FLATTEN`, 'info');
                    this._pos = null;
                    this._prevFast = fastNow; this._prevSlow = slowNow;
                    return; // don't also flip on the same bar
                }
            }

            const net = this.position().net;
            let crossedUp = false, crossedDown = false;
            if (this._prevFast != null && this._prevSlow != null) {
                crossedUp = this._prevFast <= this._prevSlow && fastNow > slowNow;
                crossedDown = this._prevFast >= this._prevSlow && fastNow < slowNow;
            }

            if (crossedUp && net <= 0) {
                if (net < 0) this.flatten(); // close short, clears its bracket
                this._enter(1, bar.close, atrNow);
            } else if (crossedDown && net >= 0) {
                if (net > 0) this.flatten(); // close long, clears its bracket
                this._enter(-1, bar.close, atrNow);
            }

            this._prevFast = fastNow;
            this._prevSlow = slowNow;
        }

        // Live-only: ratcheting trailing stop, floored at the hard bracket stop so
        // it only tightens beyond it. Never fires in backtest (no 'tick' there).
        onTick(tick) {
            const pos = this._pos;
            if (!pos) return;
            // Bracket may have flattened us between bars; reconcile cheaply.
            if (this.position().net === 0) { this._pos = null; return; }
            const px = tick && tick.price;
            if (!Number.isFinite(px)) return;

            const trailDist = this.trailAtr * pos.atrAtEntry;
            if (pos.side > 0) {
                if (px > pos.extreme) pos.extreme = px;
                const effStop = Math.max(pos.stop, pos.extreme - trailDist);
                if (px <= effStop) {
                    this.flatten();
                    this.log(`Trailing stop: ${px} <= ${effStop.toFixed(4)} -> FLATTEN long`, 'info');
                    this._pos = null;
                }
            } else {
                if (px < pos.extreme) pos.extreme = px;
                const effStop = Math.min(pos.stop, pos.extreme + trailDist);
                if (px >= effStop) {
                    this.flatten();
                    this.log(`Trailing stop: ${px} >= ${effStop.toFixed(4)} -> FLATTEN short`, 'info');
                    this._pos = null;
                }
            }
        }

        teardown() { this._pos = null; }
    }

    Algo.strategies = Algo.strategies || {};
    Algo.strategies.MomentumScalper = MomentumScalper;
})(window);
