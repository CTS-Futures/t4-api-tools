/**
 * algo/DataHealth.js
 *
 * Automated sanity check on the market-data feed driving a live strategy. The
 * point: a strategy is only as safe as the bars it acts on. A frozen feed, a
 * duplicated/out-of-order bar, or a garbage price can make a strategy trade on
 * a fiction — so RiskManager (algo/RiskManager.js) runs every closed bar through
 * this monitor BEFORE the strategy reacts, and blocks order entry (or halts)
 * while the feed looks unhealthy.
 *
 * It is intentionally conservative and stateless apart from "the last good bar"
 * plus a wall-clock stamp for staleness. Each check returns {ok, reason} so the
 * caller can log exactly why it tripped.
 *
 * Checks per bar:
 *   - OHLC are finite, positive numbers
 *   - high >= low, and low <= close <= high (and low <= open <= high)
 *   - time is strictly increasing vs the previous bar (no dupes / rewinds)
 *
 * Staleness is time-based and checked on demand (isStale): if no healthy bar
 * has arrived within `maxStaleSeconds`, the feed is considered stalled. The
 * caller seeds the cadence expectation; we don't guess the bar interval here.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    class DataHealth {
        /**
         * @param {Object} [cfg]
         * @param {number} [cfg.maxStaleSeconds=Infinity]  Max wall-clock gap
         *        between healthy bars before the feed is "stale". Infinity = off.
         * @param {()=>number} [cfg.now]  Clock (epoch ms). Injectable for tests.
         */
        constructor({ maxStaleSeconds = Infinity, now } = {}) {
            this.maxStaleSeconds = maxStaleSeconds;
            this._now = typeof now === 'function' ? now : () => Date.now();
            this._lastTime = null;       // last accepted bar's `time` (UTC seconds)
            this._lastGoodAtMs = null;    // wall-clock ms when we last accepted a bar
        }

        /**
         * Validate a single closed bar. Records it as the new baseline only when
         * it passes, so a corrupt bar never advances the "last good" markers.
         * @param {{time:number,open:number,high:number,low:number,close:number,volume?:number}} bar
         * @returns {{ok:boolean, reason:string}}
         */
        check(bar) {
            if (!bar || typeof bar !== 'object') {
                return this._fail('bar missing or not an object');
            }
            const { time, open, high, low, close } = bar;

            for (const [name, v] of [['open', open], ['high', high], ['low', low], ['close', close]]) {
                if (!Number.isFinite(v)) return this._fail(`non-finite ${name} (${v})`);
                if (v <= 0) return this._fail(`non-positive ${name} (${v})`);
            }
            if (!Number.isFinite(time)) return this._fail(`non-finite time (${time})`);

            if (high < low) return this._fail(`high ${high} < low ${low}`);
            if (close < low || close > high) return this._fail(`close ${close} outside [${low}, ${high}]`);
            if (open < low || open > high) return this._fail(`open ${open} outside [${low}, ${high}]`);

            if (this._lastTime != null && time <= this._lastTime) {
                return this._fail(`time not increasing (${time} <= previous ${this._lastTime})`);
            }

            // Accept: advance baselines.
            this._lastTime = time;
            this._lastGoodAtMs = this._now();
            return { ok: true, reason: '' };
        }

        /**
         * True when no healthy bar has arrived within `maxStaleSeconds`. Returns
         * false until the first bar is seen (nothing to be stale against yet).
         * @returns {boolean}
         */
        isStale() {
            if (!Number.isFinite(this.maxStaleSeconds)) return false;
            if (this._lastGoodAtMs == null) return false;
            return (this._now() - this._lastGoodAtMs) > this.maxStaleSeconds * 1000;
        }

        /** Reset baselines (call on attach so a new run starts clean). */
        reset() {
            this._lastTime = null;
            this._lastGoodAtMs = null;
        }

        _fail(reason) {
            return { ok: false, reason };
        }
    }

    Algo.DataHealth = DataHealth;
})(window);
