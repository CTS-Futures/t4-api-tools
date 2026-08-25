/**
 * algo/RiskManager.js
 *
 * A guard layer that sits BETWEEN the strategy and the real broker:
 *
 *     Strategy  ->  RiskManager  ->  LiveBroker  ->  T4APIClient
 *
 * It implements IBroker (decorator pattern), so the strategy and AlgoRunner
 * treat it exactly like any broker while it enforces:
 *
 *   - maxPosition       hard cap on |net| contracts (blocks orders that breach)
 *   - maxOrderSize      hard cap on a SINGLE order's volume (blocks the order)
 *   - maxDailyLoss      session PnL floor; breach -> flatten + halt
 *   - maxLossPerUnit    per-contract unrealized loss stop; breach -> flatten
 *   - maxDrawdown       give-back from peak session equity; breach -> halt
 *   - maxOrdersPerMin   rate throttle (blocks excess orders)
 *   - data health       bad/stale/out-of-order bars (or a strategy-reported
 *                        fault) block new orders, and halt if haltOnBadData
 *   - kill-switch        halt() flattens and blocks all further orders
 *   - requireDemo        refuses to arm unless connected to the T4 Simulator
 *
 * Crucially, every order — including those issued by an external (e.g. Python)
 * strategy via the bridge — passes through here, so JS is the safety authority
 * regardless of what the strategy decides.
 *
 * "Session PnL" is measured as the delta from a baseline snapshot taken at
 * attach(), so the limit reflects what the algo did this run rather than the
 * account's whole-day PnL (which could include manual trades).
 *
 * Blocking is fail-safe: a blocked order returns null and is logged; a tripped
 * loss limit halts trading. Nothing here guarantees a fill-price-bounded loss
 * (gaps/slippage exist) — it is a guard, not a guarantee.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    const IBroker = Algo.IBroker;

    class RiskManager extends IBroker {
        /**
         * @param {import('./IBroker').IBroker} inner  Broker to guard (LiveBroker).
         * @param {Object} [limits]
         * @param {number} [limits.maxPosition=Infinity]
         * @param {number} [limits.maxOrderSize=Infinity]   max volume per order
         * @param {number} [limits.maxDailyLoss=Infinity]   positive money amount
         * @param {number} [limits.maxLossPerUnit=Infinity] per-contract loss stop ($)
         * @param {number} [limits.maxDrawdown=Infinity]    give-back from peak ($)
         * @param {number} [limits.maxOrdersPerMin=Infinity]
         * @param {number} [limits.maxStaleSeconds=Infinity] feed staleness limit
         * @param {boolean} [limits.haltOnBadData=false]    halt (not just block) on bad data
         * @param {boolean} [limits.requireDemo=true]
         */
        constructor(inner, limits = {}) {
            super();
            if (!inner) throw new Error('RiskManager requires an inner broker');
            this.inner = inner;
            this.maxPosition = limits.maxPosition ?? Infinity;
            this.maxOrderSize = limits.maxOrderSize ?? Infinity;
            this.maxDailyLoss = limits.maxDailyLoss ?? Infinity;
            this.maxLossPerUnit = limits.maxLossPerUnit ?? Infinity;
            this.maxDrawdown = limits.maxDrawdown ?? Infinity;
            this.maxOrdersPerMin = limits.maxOrdersPerMin ?? Infinity;
            this.maxStaleSeconds = limits.maxStaleSeconds ?? Infinity;
            this.haltOnBadData = limits.haltOnBadData ?? false;
            this.requireDemo = limits.requireDemo ?? true;

            this.halted = false;
            this.onHalt = null;   // (reason:string) => void
            this.onBlock = null;  // (reason:string) => void

            this._orderTimes = [];
            this._pnlBaseline = 0;
            this._peakPnl = 0;     // best session PnL seen — basis for drawdown
            this._unsubs = [];

            // Data-feed monitor. Order entry is gated on its verdict.
            this._health = new Algo.DataHealth({
                maxStaleSeconds: this.maxStaleSeconds,
                now: () => this.inner.now()
            });
            this._lastBarOk = true;       // last bar passed validation
            this._lastBarReason = '';
            this._peerHealthOk = true;    // strategy-reported feed health (bridge)
            this._peerHealthReason = '';
        }

        // Delegate so AlgoRunner's pre-flight (broker.client) still works.
        get client() { return this.inner.client; }

        /** True when the client is connected to a T4 Simulator (-sim) endpoint. */
        static isDemoEnv(client) {
            const urls = `${client?.config?.wsUrl || ''} ${client?.config?.apiUrl || ''}`;
            return /sim/i.test(urls);
        }

        /** Throws with a clear reason if it is not safe to arm. */
        assertArmable() {
            if (this.requireDemo && !RiskManager.isDemoEnv(this.inner.client)) {
                throw new Error('Refusing to arm: not connected to the T4 Simulator (requireDemo is on)');
            }
        }

        // ---- IBroker lifecycle ----------------------------------------------
        attach() {
            this.assertArmable();
            this.halted = false;
            this._orderTimes = [];
            this._peakPnl = 0;
            this._lastBarOk = true; this._lastBarReason = '';
            this._peerHealthOk = true; this._peerHealthReason = '';
            this._health.maxStaleSeconds = this.maxStaleSeconds;
            this._health.reset();
            this.inner.attach();

            const a = this.inner.account();
            this._pnlBaseline = (a.realizedPnl || 0) + (a.unrealizedPnl || 0);

            // Forward inner events to our listeners; piggyback risk monitoring.
            // A bar that fails the health check is NOT forwarded to the strategy
            // (so corrupt data never pollutes indicators) and blocks order entry.
            this._unsubs.push(this.inner.on('bar', (b) => {
                const res = this._health.check(b);
                if (!res.ok) {
                    this._lastBarOk = false; this._lastBarReason = res.reason;
                    this._block(`bad market data — orders blocked: ${res.reason}`);
                    if (this.haltOnBadData) this.halt(`bad market data: ${res.reason}`);
                    return; // drop the bar
                }
                this._lastBarOk = true; this._lastBarReason = '';
                this._emit('bar', b);
                this._checkLoss();
                this._checkDrawdown();
                this._checkPerUnitLoss();
            }));
            this._unsubs.push(this.inner.on('tick', (t) => {
                this._emit('tick', t);
                this._checkDrawdown();
                this._checkPerUnitLoss();
            }));
            this._unsubs.push(this.inner.on('fill', (f) => {
                this._emit('fill', f);
                this._checkLoss();
                this._checkDrawdown();
            }));
        }

        detach() {
            for (const off of this._unsubs) { try { off(); } catch (_) {} }
            this._unsubs = [];
            this.inner.detach();
        }

        // ---- guarded order entry --------------------------------------------
        buy(volume, opts)  { return this._guarded(1, volume, opts); }
        sell(volume, opts) { return this._guarded(-1, volume, opts); }

        _guarded(side, volume, opts) {
            if (this.halted) { this._block('trading halted — order rejected'); return null; }

            // Refuse to act while the data feed looks unhealthy: a strategy
            // signal computed on bad/stale data is not trustworthy.
            const dh = this._dataHealthy();
            if (!dh.ok) { this._block(`order blocked: ${dh.reason}`); return null; }

            const qty = Math.max(1, parseInt(volume, 10) || 1);
            if (qty > this.maxOrderSize) {
                this._block(`order blocked: size ${qty} exceeds maxOrderSize ${this.maxOrderSize}`);
                return null;
            }

            const net = this.inner.position().net;
            const projected = Math.abs(net + side * qty);
            if (projected > this.maxPosition) {
                this._block(`order blocked: |net| ${projected} would exceed maxPosition ${this.maxPosition}`);
                return null;
            }

            if (!this._throttleOk()) {
                this._block(`order blocked: rate limit ${this.maxOrdersPerMin}/min reached`);
                return null;
            }

            const id = side > 0 ? this.inner.buy(qty, opts) : this.inner.sell(qty, opts);
            const t = this.inner.now();
            this._orderTimes.push(t);
            // Authoritative record of what the algo actually submitted (side, qty,
            // type, intended price) — the live dashboard's blotter source. We use
            // this rather than fills because live fills don't carry a reliable
            // matched price/volume (see T4APIClient.onFill / LiveBroker fill).
            this._emit('order', {
                id,
                side,
                qty,
                type: (opts && opts.type) || 'market',
                price: (opts && opts.price) || 0,
                time: t
            });
            return id;
        }

        // Read-only snapshot of live risk/PnL state for the monitoring dashboard.
        // All values are derived from the existing account/position accounting the
        // guardrails already use, so this adds no behavior — just exposes them.
        snapshot() {
            let net = 0, avgPrice = null, balance = null, realizedPnl = 0, unrealizedPnl = 0;
            try { const p = this.inner.position(); net = p.net; avgPrice = p.avgPrice; } catch (_) {}
            try {
                const a = this.inner.account();
                balance = a.balance; realizedPnl = a.realizedPnl || 0; unrealizedPnl = a.unrealizedPnl || 0;
            } catch (_) {}
            let sessionPnl = 0;
            try { sessionPnl = this._sessionPnl(); } catch (_) {}
            const drawdown = Math.max(0, this._peakPnl - sessionPnl);
            // Trim the rate-limit window so the count is current.
            const cutoff = this.inner.now() - 60000;
            this._orderTimes = this._orderTimes.filter(t => t >= cutoff);
            return {
                sessionPnl, peakPnl: this._peakPnl, drawdown,
                net, avgPrice, balance, realizedPnl, unrealizedPnl,
                halted: this.halted, ordersLastMin: this._orderTimes.length
            };
        }

        _throttleOk() {
            if (!Number.isFinite(this.maxOrdersPerMin)) return true;
            const cutoff = this.inner.now() - 60000;
            this._orderTimes = this._orderTimes.filter(t => t >= cutoff);
            return this._orderTimes.length < this.maxOrdersPerMin;
        }

        // ---- loss limit / kill-switch ---------------------------------------
        _checkLoss() {
            if (this.halted || !Number.isFinite(this.maxDailyLoss)) return;
            const a = this.inner.account();
            const sessionPnl = (a.realizedPnl || 0) + (a.unrealizedPnl || 0) - this._pnlBaseline;
            if (sessionPnl <= -Math.abs(this.maxDailyLoss)) {
                this.halt(`max loss hit: session PnL ${sessionPnl.toFixed(2)} <= -${this.maxDailyLoss}`);
            }
        }

        _sessionPnl() {
            const a = this.inner.account();
            return (a.realizedPnl || 0) + (a.unrealizedPnl || 0) - this._pnlBaseline;
        }

        // Trailing drawdown: track the best session equity and halt if we give
        // back more than maxDrawdown from it. Complements maxDailyLoss, which
        // only measures the absolute floor and would let a winner round-trip.
        _checkDrawdown() {
            if (this.halted || !Number.isFinite(this.maxDrawdown)) return;
            const pnl = this._sessionPnl();
            if (pnl > this._peakPnl) this._peakPnl = pnl;
            const dd = this._peakPnl - pnl;
            if (dd >= this.maxDrawdown) {
                this.halt(`max drawdown hit: gave back $${dd.toFixed(2)} from peak $${this._peakPnl.toFixed(2)} (limit $${this.maxDrawdown})`);
            }
        }

        // Per-contract stop: if the OPEN position's unrealized loss per unit
        // exceeds the limit, flatten it (but don't halt — the strategy may
        // legitimately re-enter). Uses account unrealized PnL as the proxy,
        // same basis as maxDailyLoss; assumes the algo owns the bound market.
        _checkPerUnitLoss() {
            if (this.halted || !Number.isFinite(this.maxLossPerUnit)) return;
            const { net } = this.inner.position();
            if (!net) return;
            const upl = this.inner.account().unrealizedPnl || 0;
            if (upl >= 0) return;
            const perUnit = -upl / Math.abs(net);
            if (perUnit >= this.maxLossPerUnit) {
                this._block(`per-unit loss $${perUnit.toFixed(2)} >= limit $${this.maxLossPerUnit} — flattening position`);
                try { this.inner.flatten(); } catch (_) { /* surfaced via log above */ }
            }
        }

        // Combined data-health verdict used to gate order entry.
        _dataHealthy() {
            if (!this._lastBarOk) return { ok: false, reason: `bad market data (${this._lastBarReason})` };
            if (this._health.isStale()) return { ok: false, reason: `stale feed — no bar in ${this.maxStaleSeconds}s` };
            if (!this._peerHealthOk) return { ok: false, reason: `strategy data fault (${this._peerHealthReason})` };
            return { ok: true, reason: '' };
        }

        /**
         * Optional hook a strategy can call when it detects an ingestion fault —
         * a sequence gap, a missed heartbeat, or out-of-order bars. While
         * unhealthy, order entry is
         * blocked (and trading halts if haltOnBadData is on).
         * @param {boolean} ok
         * @param {string} [reason]
         */
        reportHealth(ok, reason = '') {
            this._peerHealthOk = !!ok;
            this._peerHealthReason = ok ? '' : (reason || 'unhealthy');
            if (!ok) {
                this._block(`strategy data fault — orders blocked: ${this._peerHealthReason}`);
                if (this.haltOnBadData) this.halt(`strategy data fault: ${this._peerHealthReason}`);
            }
        }

        halt(reason = 'kill-switch') {
            if (this.halted) return;
            this.halted = true;
            try { this.inner.flatten(); } catch (err) { /* surfaced via onHalt below */ }
            if (this.onHalt) this.onHalt(reason);
        }

        // ---- passthrough -----------------------------------------------------
        cancel(orderId)   { return this.inner.cancel(orderId); }
        flatten()         { return this.inner.flatten(); }
        position()        { return this.inner.position(); }
        account()         { return this.inner.account(); }
        now()             { return this.inner.now(); }
        getHistoryBars()  { return this.inner.getHistoryBars(); }

        _block(reason) {
            if (this.onBlock) this.onBlock(reason);
        }
    }

    Algo.RiskManager = RiskManager;
})(window);
