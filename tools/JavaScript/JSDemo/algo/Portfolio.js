/**
 * algo/Portfolio.js
 *
 * Position + PnL accounting for the backtester. Tracks net position, average
 * entry, realized PnL (net of commission), an equity curve sampled per bar,
 * and a trade blotter. PnL is expressed in money via `pointValue` (the
 * contract's $ value per price point); leave it 1 to get PnL in points.
 *
 * Sign convention: net > 0 = long, net < 0 = short. side is +1 (buy) / -1 (sell).
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    class Portfolio {
        constructor({ pointValue = 1, commission = 0, startingCash = 100000 } = {}) {
            this.pointValue = pointValue;
            this.commission = commission;     // per contract, per fill
            this.startingCash = startingCash;

            this.net = 0;
            this.avgPrice = null;
            this.realized = 0;                // includes commission costs
            this.trades = [];                 // { time, side, qty, price, pnl, commission }
            this.equityCurve = [];            // { time, value }
            this._lastClose = null;
        }

        /**
         * Apply an execution. Handles opening, adding, reducing, closing, and
         * flipping in one path.
         * @param {1|-1} side
         * @param {number} qty   positive contracts
         * @param {number} price fill price (display units)
         * @param {number} timeSec
         */
        applyFill(side, qty, price, timeSec) {
            qty = Math.abs(qty);
            if (!qty || !Number.isFinite(price)) return;
            const signed = side >= 0 ? qty : -qty;
            let pnl = 0;
            let closedQty = 0;     // contracts this fill closed (0 for pure opens/adds)
            let entryAvg = null;   // avg entry price of the closed contracts

            if (this.net === 0 || Math.sign(this.net) === Math.sign(signed)) {
                // Opening or adding to the position → recompute weighted avg.
                const absNet = Math.abs(this.net);
                this.avgPrice = this.avgPrice == null
                    ? price
                    : (this.avgPrice * absNet + price * qty) / (absNet + qty);
                this.net += signed;
            } else {
                // Reducing, closing, or flipping.
                const closing = Math.min(qty, Math.abs(this.net));
                entryAvg = this.avgPrice;   // capture entry BEFORE it's mutated below
                closedQty = closing;
                pnl = (price - this.avgPrice) * closing * Math.sign(this.net) * this.pointValue;
                this.realized += pnl;
                const remaining = qty - closing; // > 0 means we flipped sides
                this.net += signed;
                if (this.net === 0) this.avgPrice = null;
                else if (remaining > 0) this.avgPrice = price; // new position at fill price
                // partial reduce leaves avgPrice unchanged
            }

            const commissionCost = this.commission * qty;
            this.realized -= commissionCost;
            this.trades.push({
                time: timeSec,
                side: signed > 0 ? 1 : -1,
                qty,
                price,
                pnl,                 // gross realized from this fill (0 when opening/adding)
                commission: commissionCost,
                // Round-trip context: a "closing" fill reduced/closed a position, so
                // it completes a trade. `entryPrice` is the avg entry of the closed
                // contracts → the blotter can show entry→exit. Identified by
                // `closing` (not pnl!==0) so scratch trades (exit == entry) still count.
                closing: closedQty > 0,
                closedQty,
                entryPrice: entryAvg
            });
        }

        unrealized(price) {
            if (this.net === 0 || this.avgPrice == null || !Number.isFinite(price)) return 0;
            return (price - this.avgPrice) * this.net * this.pointValue;
        }

        /** Record equity (cash + realized + open MTM) at a bar close. */
        markEquity(timeSec, price) {
            this._lastClose = price;
            const value = this.startingCash + this.realized + this.unrealized(price);
            this.equityCurve.push({ time: timeSec, value });
        }

        /** Force-close any open position at `price` (used at the end of a run). */
        forceClose(price, timeSec) {
            if (this.net === 0) return;
            this.applyFill(this.net > 0 ? -1 : 1, Math.abs(this.net), price, timeSec);
        }

        /**
         * Summary statistics. `intervalMs` (optional) is used only to annualize
         * the Sharpe ratio with an approximate continuous-trading assumption.
         */
        stats(intervalMs) {
            const eq = this.equityCurve;
            const finalEquity = eq.length ? eq[eq.length - 1].value : this.startingCash;
            const netProfit = this.realized;
            const totalReturnPct = this.startingCash ? (netProfit / this.startingCash) * 100 : null;

            // Max drawdown (peak-to-trough on the equity curve).
            let peak = -Infinity, maxDD = 0, maxDDpct = 0;
            for (const p of eq) {
                if (p.value > peak) peak = p.value;
                const dd = peak - p.value;
                if (dd > maxDD) { maxDD = dd; maxDDpct = peak ? (dd / Math.abs(peak)) * 100 : 0; }
            }

            // Closed trades = fills that reduced/closed a position (completed a
            // round-trip). Keyed on `closing`, not `pnl !== 0`, so a scratch trade
            // (exit at entry price, pnl 0) is still counted as a trade.
            const closed = this.trades.filter(t => t.closing);
            const wins = closed.filter(t => t.pnl > 0);
            const losses = closed.filter(t => t.pnl < 0);
            const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
            const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

            // Per-bar returns → (approx annualized) Sharpe.
            const rets = [];
            for (let i = 1; i < eq.length; i++) {
                const prev = eq[i - 1].value;
                if (prev) rets.push((eq[i].value - prev) / Math.abs(prev));
            }
            const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
            const variance = rets.length
                ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0;
            const std = Math.sqrt(variance);
            let sharpe = std ? mean / std : 0;
            if (intervalMs && std) {
                const barsPerYear = (365 * 24 * 3600 * 1000) / intervalMs;
                sharpe *= Math.sqrt(barsPerYear);
            }

            return {
                finalEquity,
                netProfit,
                totalReturnPct,
                maxDrawdown: maxDD,
                maxDrawdownPct: maxDDpct,
                numFills: this.trades.length,
                numTrades: closed.length,
                wins: wins.length,
                losses: losses.length,
                winRatePct: closed.length ? (wins.length / closed.length) * 100 : null,
                profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : null),
                sharpe,
                sharpeAnnualized: !!intervalMs
            };
        }
    }

    Algo.Portfolio = Portfolio;
})(window);
