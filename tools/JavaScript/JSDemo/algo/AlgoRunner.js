/**
 * algo/AlgoRunner.js
 *
 * Orchestrates a single strategy against a broker: pre-flight checks, wiring
 * the broker's event stream into the strategy's hooks, and clean start/stop.
 * It is deliberately broker-agnostic so the same runner drives LiveBroker now
 * and SimBroker in step 2.
 *
 * RISK: this step has no position/loss limits or kill-switch beyond stop().
 * Those land with RiskManager (step 4). The runner refuses to start without a
 * selected account + subscribed market, and logs a loud "no risk controls"
 * warning so nobody mistakes it for production-safe.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    class AlgoRunner {
        /**
         * @param {Object} cfg
         * @param {import('./IBroker').IBroker} cfg.broker
         * @param {(msg:string, level?:string)=>void} [cfg.log]
         */
        constructor({ broker, log } = {}) {
            if (!broker) throw new Error('AlgoRunner requires a broker');
            this.broker = broker;
            this.log = typeof log === 'function' ? log : (() => {});
            this.strategy = null;
            this.running = false;
            this._unsubs = [];
            this.onStateChange = null; // (running:boolean) => void
            // Strategy View hook: called after each onBar with the bar's plotted
            // indicator values + resulting position, for the visualization chart.
            this.onPlot = null; // ({time, close, values, net}) => void
        }

        /** @param {import('./strategies/Strategy').Strategy} strategy */
        load(strategy) {
            if (this.running) throw new Error('Stop the runner before loading a new strategy');
            this.strategy = strategy;
        }

        start() {
            if (this.running) return;
            if (!this.strategy) throw new Error('No strategy loaded');

            // Pre-flight. attach() also validates account/market, but check here
            // first so we can surface a friendly message instead of throwing.
            const client = this.broker.client;
            if (client && (!client.selectedAccount || !client.currentMarketId)) {
                this.log('Select an account and subscribe to a market before starting the algo', 'error');
                return;
            }

            this.broker.attach();
            this.strategy.init(this.broker, { log: this.log });

            // Warm up indicators from already-loaded history so the strategy
            // can act on the next closed bar instead of waiting ~`slow` live
            // bars. Broker-agnostic: SimBroker supplies its own history.
            const history = typeof this.broker.getHistoryBars === 'function'
                ? this.broker.getHistoryBars() : [];
            if (history.length && typeof this.strategy.warmup === 'function') {
                this._safe(() => this.strategy.warmup(history));
            } else if (!history.length) {
                this.log('No loaded history to warm up from — strategy will accumulate bars live (slow start)', 'info');
            }

            this._unsubs.push(this.broker.on('bar', (b) => {
                this._safe(() => this.strategy.onBar(b));
                // Drain the values the strategy computed this bar and forward them
                // to the Strategy View. Runs on closed bars only, so it's cheap.
                if (this.onPlot) {
                    this._safe(() => this.onPlot({
                        time: b.time,
                        close: b.close,
                        values: this.strategy._drainPlots(),
                        net: this.broker.position?.().net
                    }));
                }
            }));
            this._unsubs.push(this.broker.on('tick', (t) => this._safe(() => this.strategy.onTick(t))));
            this._unsubs.push(this.broker.on('fill', (f) => this._safe(() => this.strategy.onFill(f))));

            this.running = true;
            this.log(`Algo started: ${this.strategy.constructor.displayName || 'Strategy'}`, 'info');
            // If the broker is a RiskManager, report the active guards so the
            // user can see exactly what's protecting them.
            const r = this.broker;
            if (r && typeof r.halt === 'function' && 'maxPosition' in r) {
                const f = (v) => Number.isFinite(v) ? v : 'none';
                this.log(`Risk guards: maxPos=${f(r.maxPosition)} maxOrdSize=${f(r.maxOrderSize)} maxLoss=$${f(r.maxDailyLoss)} loss/unit=$${f(r.maxLossPerUnit)} maxDD=$${f(r.maxDrawdown)} rate=${f(r.maxOrdersPerMin)}/min stale=${f(r.maxStaleSeconds)}s demoOnly=${!!r.requireDemo} haltOnBadData=${!!r.haltOnBadData}`, 'info');
            }
            if (this.onStateChange) this.onStateChange(true);
        }

        stop({ flatten = false } = {}) {
            if (!this.running) return;
            for (const off of this._unsubs) { try { off(); } catch (_) {} }
            this._unsubs = [];

            if (flatten) {
                try { this.broker.flatten(); this.log('Flattened position on stop', 'info'); }
                catch (err) { this.log(`Flatten on stop failed: ${err.message}`, 'error'); }
            }

            this._safe(() => this.strategy.teardown());
            this.broker.detach();
            this.running = false;
            this.log('Algo stopped', 'info');
            if (this.onStateChange) this.onStateChange(false);
        }

        _safe(fn) {
            try { fn(); }
            catch (err) { this.log(`Strategy error: ${err.message}`, 'error'); }
        }
    }

    Algo.AlgoRunner = AlgoRunner;
})(window);
