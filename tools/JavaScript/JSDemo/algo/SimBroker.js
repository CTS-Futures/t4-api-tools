/**
 * algo/SimBroker.js
 *
 * In-memory matching engine implementing IBroker, for backtesting. The
 * Backtester drives it bar-by-bar via processBar(); the strategy that runs
 * against it is byte-for-byte the same code that runs against LiveBroker.
 *
 * Fill model (documented assumptions — this is bar data, not a real book):
 *   - MARKET orders fill at the NEXT bar's open ± slippage. Acting on a closed
 *     bar then filling next-open avoids look-ahead bias.
 *   - LIMIT buy fills if bar.low <= price (sell: bar.high >= price); a gap
 *     through the limit fills at the bar open (price improvement).
 *   - STOP triggers when the bar trades through it, then fills as market at the
 *     stop (or gap-open) ± slippage (adverse).
 *   - Bracket TP/SL become an OCO pair. If both could fill in one bar, the STOP
 *     is resolved first (pessimistic).
 *
 * Orders placed during a bar's close are queued; they cannot fill on the bar
 * that triggered them.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const IBroker = Algo.IBroker;

    class SimBroker extends IBroker {
        constructor(config = {}) {
            super();
            this.config = config;
            this.slippage = config.slippage ?? 0;       // price units, adverse
            this.portfolio = new Algo.Portfolio(config);

            this._pending = [];        // market orders awaiting next open
            this._resting = [];        // limit/stop orders
            this._seq = 0;
            this._clockMs = 0;
            // Note: this is the live-trading no-op surface; the Backtester is
            // what advances time via processBar().
        }

        // ---- IBroker lifecycle (no-ops; events come from processBar) ---------
        attach() {}
        detach() {}
        getHistoryBars() { return []; }
        now() { return this._clockMs; }

        // ---- order entry -----------------------------------------------------
        buy(volume, opts = {})  { return this._order(1, volume, opts); }
        sell(volume, opts = {}) { return this._order(-1, volume, opts); }

        _order(side, volume, { type = 'market', price = null, tp = null, sl = null } = {}) {
            const qty = Math.max(1, parseInt(volume, 10) || 1);
            const id = `sim-${++this._seq}`;
            const bracket = (tp != null || sl != null) ? { tp, sl } : null;

            if (type === 'market') {
                this._pending.push({ id, side, qty, bracket });
            } else if (type === 'limit' || type === 'stop') {
                if (!Number.isFinite(price)) throw new Error(`${type} order requires a price`);
                this._resting.push({ id, side, qty, type, price, bracket, ocoGroup: null });
            } else {
                throw new Error(`Unknown order type: ${type}`);
            }
            return id;
        }

        cancel(orderId) {
            this._resting = this._resting.filter(o => o.id !== orderId);
            this._pending = this._pending.filter(o => o.id !== orderId);
        }

        flatten() {
            // Cancel working orders, then market out of the net position.
            this._resting = [];
            const net = this.portfolio.net;
            if (net > 0) this.sell(net, { type: 'market' });
            else if (net < 0) this.buy(-net, { type: 'market' });
        }

        // ---- state -----------------------------------------------------------
        position() {
            return { net: this.portfolio.net, avgPrice: this.portfolio.avgPrice };
        }

        account() {
            const last = this.portfolio._lastClose;
            return {
                balance: this.portfolio.startingCash + this.portfolio.realized,
                realizedPnl: this.portfolio.realized,
                unrealizedPnl: this.portfolio.unrealized(last)
            };
        }

        // ---- engine (called by Backtester) -----------------------------------
        /** Advance one bar: fill, mark equity, then deliver the close. */
        processBar(bar) {
            this._clockMs = bar.time * 1000;
            this._fillPendingMarket(bar);
            this._scanResting(bar);
            this.portfolio.markEquity(bar.time, bar.close);
            // Deliver the CLOSED bar; strategy may queue new orders for next bar.
            this._emit('bar', {
                time: bar.time, open: bar.open, high: bar.high,
                low: bar.low, close: bar.close, volume: bar.volume ?? 0
            });
        }

        /** Close any open position at the final price (end of run). */
        forceClose(price, timeSec) {
            this._pending = [];
            this._resting = [];
            this.portfolio.forceClose(price, timeSec);
        }

        configSummary() {
            return {
                pointValue: this.portfolio.pointValue,
                commission: this.portfolio.commission,
                slippage: this.slippage,
                startingCash: this.portfolio.startingCash
            };
        }

        // ---- fill internals --------------------------------------------------
        _fillPendingMarket(bar) {
            if (!this._pending.length) return;
            const pending = this._pending;
            this._pending = [];
            for (const o of pending) {
                const fill = o.side > 0 ? bar.open + this.slippage : bar.open - this.slippage;
                this.portfolio.applyFill(o.side, o.qty, fill, bar.time);
                this._emit('fill', { orderId: o.id, side: o.side, volume: o.qty, price: fill, time: bar.time });
                if (o.bracket) this._installBracket(o, fill);
            }
        }

        _scanResting(bar) {
            if (!this._resting.length) return;
            // Stops first so a one-bar TP+SL collision resolves pessimistically.
            const ordered = [...this._resting].sort((a, b) =>
                (a.type === 'stop' ? 0 : 1) - (b.type === 'stop' ? 0 : 1));
            const filledGroups = new Set();
            const filledIds = new Set();

            for (const o of ordered) {
                if (o.ocoGroup && filledGroups.has(o.ocoGroup)) continue; // sibling already filled
                const res = this._tryFill(o, bar);
                if (!res.filled) continue;
                this.portfolio.applyFill(o.side, o.qty, res.price, bar.time);
                this._emit('fill', { orderId: o.id, side: o.side, volume: o.qty, price: res.price, time: bar.time });
                filledIds.add(o.id);
                if (o.ocoGroup) filledGroups.add(o.ocoGroup);
            }

            // Drop filled orders and any OCO siblings whose partner filled.
            this._resting = this._resting.filter(o =>
                !filledIds.has(o.id) && !(o.ocoGroup && filledGroups.has(o.ocoGroup)));
        }

        _tryFill(o, bar) {
            if (o.type === 'limit') {
                if (o.side > 0 && bar.low <= o.price) {
                    return { filled: true, price: bar.open <= o.price ? bar.open : o.price };
                }
                if (o.side < 0 && bar.high >= o.price) {
                    return { filled: true, price: bar.open >= o.price ? bar.open : o.price };
                }
            } else if (o.type === 'stop') {
                if (o.side > 0 && bar.high >= o.price) {
                    return { filled: true, price: Math.max(o.price, bar.open) + this.slippage };
                }
                if (o.side < 0 && bar.low <= o.price) {
                    return { filled: true, price: Math.min(o.price, bar.open) - this.slippage };
                }
            }
            return { filled: false };
        }

        // Attach OCO TP/SL children once the parent (bracketed) order fills.
        _installBracket(parent, entryPrice) {
            const group = `oco-${++this._seq}`;
            const childSide = parent.side > 0 ? -1 : 1; // exit is opposite the entry
            const { tp, sl } = parent.bracket;
            if (tp != null) {
                this._resting.push({ id: `sim-${++this._seq}`, side: childSide, qty: parent.qty, type: 'limit', price: tp, bracket: null, ocoGroup: group });
            }
            if (sl != null) {
                this._resting.push({ id: `sim-${++this._seq}`, side: childSide, qty: parent.qty, type: 'stop', price: sl, bracket: null, ocoGroup: group });
            }
        }
    }

    Algo.SimBroker = SimBroker;
})(window);
