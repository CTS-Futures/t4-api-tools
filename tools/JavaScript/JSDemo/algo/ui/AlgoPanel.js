/**
 * algo/ui/AlgoPanel.js
 *
 * Control surface to arm/disarm a live strategy, plus a live monitoring
 * dashboard. It owns a LiveBroker + RiskManager + AlgoRunner chain, builds its
 * form into the supplied host using the demo's .section/.form-group classes,
 * reflects run state, and shows live session P&L / drawdown / position, an
 * equity curve, and an activity blotter while a strategy is armed.
 *
 * Strategy params are rendered dynamically from the selected strategy's
 * `static params` schema, so adding a strategy needs no edits here. The dropdown
 * is populated from Algo.strategies for the same reason.
 *
 * Dashboard data comes from RiskManager.snapshot() (PnL/equity/position, derived
 * from the account accounting the guardrails already use) and the RiskManager
 * 'order' event (the blotter) — NOT from fills, which don't carry a reliable
 * matched price/volume.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    const fmt = (v, d = 2) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const pnlClass = (v) => v > 0 ? 'positive-pnl' : v < 0 ? 'negative-pnl' : '';

    class AlgoPanel {
        /**
         * @param {Object} cfg
         * @param {HTMLElement} cfg.host
         * @param {T4APIClient} cfg.client
         * @param {ChartService} [cfg.chartService]
         * @param {(msg:string, level?:string)=>void} [cfg.log]
         */
        constructor({ host, client, chartService, strategyChart, log }) {
            this.host = host;
            this.client = client;
            this.chartService = chartService || null;
            this.strategyChart = strategyChart || null;
            this.log = typeof log === 'function' ? log : (m => console.log('[algo]', m));

            // Strategy -> RiskManager -> LiveBroker. The runner only ever sees
            // the RiskManager, so every order the strategy issues is guarded.
            this.liveBroker = new Algo.LiveBroker({ client, chartService });
            this.risk = new Algo.RiskManager(this.liveBroker, { requireDemo: true });
            this.broker = this.risk;
            this.runner = new Algo.AlgoRunner({ broker: this.broker, log: this.log });
            this.runner.onStateChange = (running) => this._reflect(running);

            // Risk events -> console + auto-stop the runner on a halt.
            this.risk.onBlock = (reason) => { this.log(`⛔ ${reason}`, 'error'); this._refreshCards(); };
            this.risk.onHalt = (reason) => {
                this.log(`🛑 HALTED: ${reason}`, 'error');
                if (this.runner.running) this.runner.stop();
                this._refreshCards();
            };

            // Live dashboard state.
            this._equityChart = null;
            this._equitySeries = null;
            this._blotter = [];

            this._build();
            this._wireLiveFeed();
        }

        _build() {
            this.host.innerHTML = `
                <div class="algo-form">
                    <div class="form-group">
                        <label for="algoStrategy">Strategy:</label>
                        <select id="algoStrategy"></select>
                    </div>
                    <div id="algoParams" class="algo-params"></div>
                    <div class="form-group">
                        <label for="algoMaxPos" title="Hard cap on |net| contracts">Max Pos:</label>
                        <input type="number" id="algoMaxPos" value="5" min="1" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoMaxOrder" title="Hard cap on a single order's size. Blank = none.">Max Ord Size:</label>
                        <input type="number" id="algoMaxOrder" value="5" min="1" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoMaxLoss" title="Session loss limit ($). Breach flattens + halts. Blank = none.">Max Loss $:</label>
                        <input type="number" id="algoMaxLoss" value="500" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoLossUnit" title="Per-contract unrealized loss stop ($). Breach flattens the position. Blank = none.">Loss/Unit $:</label>
                        <input type="number" id="algoLossUnit" value="100" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoMaxDD" title="Give-back from peak session equity ($). Breach halts. Blank = none.">Max DD $:</label>
                        <input type="number" id="algoMaxDD" value="300" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoMaxRate" title="Max orders per minute. Blank = none.">Ord/min:</label>
                        <input type="number" id="algoMaxRate" value="30" min="1" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="algoMaxStale" title="Block orders if no bar arrives within this many seconds (stale feed). Blank = none.">Max Stale s:</label>
                        <input type="number" id="algoMaxStale" value="120" min="1" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label class="quick-trade-toggle" title="Refuse to arm unless connected to the T4 Simulator">
                            <input type="checkbox" id="algoRequireDemo" checked> Demo only
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="quick-trade-toggle" title="On bad/stale data, halt trading entirely (not just block new orders)">
                            <input type="checkbox" id="algoHaltBadData"> Halt on bad data
                        </label>
                    </div>
                    <div class="form-group submit-btn-container">
                        <button id="algoStartBtn" class="submit-order-btn">Start Algo</button>
                        <button id="algoStopBtn" class="action-btn" disabled>Stop</button>
                        <button id="algoKillBtn" class="algo-kill-btn" disabled title="Flatten and halt immediately">Kill</button>
                    </div>
                    <div class="algo-status">
                        <span class="algo-status-dot" id="algoStatusDot"></span>
                        <span id="algoStatusText">Idle</span>
                    </div>
                </div>
                <div class="bt-results" id="algoDash" style="display:none;">
                    <div class="bt-subtitle">Strategy P&amp;L — this run (session-relative)</div>
                    <div class="bt-stats" id="algoCards"></div>
                    <div class="bt-equity-wrap">
                        <div class="bt-subtitle">Session P&amp;L Curve</div>
                        <div class="bt-equity" id="algoEquity"></div>
                    </div>
                    <div class="bt-trades-wrap">
                        <div class="bt-subtitle">Activity (<span id="algoOrderCount">0</span> orders)</div>
                        <div class="table-container bt-trades-scroll">
                            <table class="bt-trades-table">
                                <thead><tr><th>Time</th><th>Side</th><th>Qty</th><th>Type</th><th>Price</th></tr></thead>
                                <tbody id="algoBlotterBody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>`;

            this.$strategy = this.host.querySelector('#algoStrategy');
            this.$params = this.host.querySelector('#algoParams');
            this.$maxPos = this.host.querySelector('#algoMaxPos');
            this.$maxOrder = this.host.querySelector('#algoMaxOrder');
            this.$maxLoss = this.host.querySelector('#algoMaxLoss');
            this.$lossUnit = this.host.querySelector('#algoLossUnit');
            this.$maxDD = this.host.querySelector('#algoMaxDD');
            this.$maxRate = this.host.querySelector('#algoMaxRate');
            this.$maxStale = this.host.querySelector('#algoMaxStale');
            this.$requireDemo = this.host.querySelector('#algoRequireDemo');
            this.$haltBadData = this.host.querySelector('#algoHaltBadData');
            this.$start = this.host.querySelector('#algoStartBtn');
            this.$stop = this.host.querySelector('#algoStopBtn');
            this.$kill = this.host.querySelector('#algoKillBtn');
            this.$dot = this.host.querySelector('#algoStatusDot');
            this.$statusText = this.host.querySelector('#algoStatusText');
            // Dashboard nodes.
            this.$dash = this.host.querySelector('#algoDash');
            this.$cards = this.host.querySelector('#algoCards');
            this.$equity = this.host.querySelector('#algoEquity');
            this.$blotterBody = this.host.querySelector('#algoBlotterBody');
            this.$orderCount = this.host.querySelector('#algoOrderCount');

            // Populate strategy dropdown from the registry, then render the
            // selected strategy's params (and re-render on change).
            const reg = Algo.strategies || {};
            for (const key of Object.keys(reg)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = reg[key].displayName || key;
                this.$strategy.appendChild(opt);
            }
            this._renderParams();
            this.$strategy.addEventListener('change', () => this._renderParams());

            this.$start.addEventListener('click', () => this._start());
            this.$stop.addEventListener('click', () => this.runner.stop());
            this.$kill.addEventListener('click', () => this.risk.halt('manual kill-switch'));
        }

        _renderParams() {
            const Ctor = (Algo.strategies || {})[this.$strategy.value];
            const schema = (Ctor && Ctor.params) || [];
            Algo.ui.buildParamInputs(this.$params, schema, 'algoP_');
        }

        // Read a number input, treating blank/non-positive as "no limit".
        _limit(el) {
            const v = parseFloat(el.value);
            return Number.isFinite(v) && v > 0 ? v : Infinity;
        }

        _start() {
            const key = this.$strategy.value;
            const Ctor = (Algo.strategies || {})[key];
            if (!Ctor) { this.log(`Unknown strategy: ${key}`, 'error'); return; }

            // Push current limits into the RiskManager before arming.
            this.risk.maxPosition = this._limit(this.$maxPos);
            this.risk.maxOrderSize = this._limit(this.$maxOrder);
            this.risk.maxDailyLoss = this._limit(this.$maxLoss);
            this.risk.maxLossPerUnit = this._limit(this.$lossUnit);
            this.risk.maxDrawdown = this._limit(this.$maxDD);
            this.risk.maxOrdersPerMin = this._limit(this.$maxRate);
            this.risk.maxStaleSeconds = this._limit(this.$maxStale);
            this.risk.requireDemo = this.$requireDemo.checked;
            this.risk.haltOnBadData = this.$haltBadData.checked;

            const params = Algo.ui.readParamInputs(this.$params, Ctor.params || [], 'algoP_');
            const strategy = new Ctor(params);

            // Configure the Strategy View for this strategy's declared traces and
            // stream its per-bar values in via the runner's onPlot hook.
            if (this.strategyChart) {
                try {
                    this.strategyChart.setSchema(Ctor.plots || []);

                    // Backfill the strategy's traces over ALL loaded history so the
                    // view starts populated up to "now", then streams live from the
                    // seam. Replay a FRESH instance through the Backtester (the same
                    // bars the live strategy warms up from, the same indicator math),
                    // so the live runner's own strategy/warmup is left untouched.
                    // Bridge strategies decide async over a socket and can't run in
                    // the synchronous Backtester, so they skip backfill (live-only).
                    //
                    // Read history straight from the chart (same source as
                    // BacktestPanel): broker.getHistoryBars() can't be used yet — it
                    // guards on the broker's marketId, which isn't bound until
                    // runner.start() calls attach() further below, so it would return [].
                    const history = Array.isArray(this.chartService?._historyBars)
                        ? this.chartService._historyBars : [];
                    if (!Ctor.bridgeOnly && history.length >= 2 && Algo.Backtester) {
                        try {
                            const res = new Algo.Backtester().run({
                                bars: history,
                                strategy: new Ctor(params),
                                config: { log: () => {} },
                                intervalMs: this.chartService?.intervalMs
                            });
                            const markers = (res.trades || []).map(t => ({ time: t.time, side: t.side }));
                            this.strategyChart.backfill(res.plots || [], markers);
                        } catch (err) {
                            this.log(`Strategy view history backfill skipped: ${err.message}`, 'info');
                        }
                    }

                    this.strategyChart.show();
                    this.strategyChart.syncTo(this.chartService?.renderer?.chart);
                    this.runner.onPlot = (pt) => this.strategyChart.pushPoint(pt);
                } catch (err) {
                    this.log(`Strategy view setup failed: ${err.message}`, 'error');
                }
            }

            try {
                this.runner.load(strategy);
                this.runner.start();
            } catch (err) {
                this.log(`Could not start algo: ${err.message}`, 'error');
            }
        }

        // ---- live dashboard --------------------------------------------------
        // Subscribe once to the RiskManager event stream; these only fire while a
        // strategy is armed, so a single subscription for the panel's life is fine.
        _wireLiveFeed() {
            this.risk.on('bar', (bar) => {
                const snap = this.risk.snapshot();
                if (this._equitySeries && Number.isFinite(bar?.time)) {
                    try { this._equitySeries.update({ time: bar.time, value: snap.sessionPnl }); } catch (_) {}
                }
                this._renderCards(snap);
            });
            this.risk.on('tick', () => this._refreshCards());
            this.risk.on('fill', () => this._refreshCards());
            this.risk.on('order', (o) => {
                this._blotter.push(o);
                if (this._blotter.length > 200) this._blotter.shift();
                this._renderBlotter();
                this._refreshCards();
                // Drop a buy/sell marker on the Strategy View. The order fires
                // synchronously inside the bar's onBar (before that bar is plotted),
                // so queue it — pushPoint stamps it with that bar's own time, landing
                // the marker on the bar that triggered it rather than the prior one.
                if (this.strategyChart) { try { this.strategyChart.queueMarker(o.side); } catch (_) {} }
            });
        }

        _resetDash() {
            this._blotter = [];
            this.$dash.style.display = '';
            if (!this._equityChart) {
                const made = Algo.ui.makeEquityChart(this.$equity);
                if (made) { this._equityChart = made.chart; this._equitySeries = made.series; }
            }
            if (this._equitySeries) { try { this._equitySeries.setData([]); } catch (_) {} }
            this._renderBlotter();
            this._refreshCards();
        }

        _refreshCards() {
            try { this._renderCards(this.risk.snapshot()); } catch (_) {}
        }

        _renderCards(snap) {
            if (!snap) return;
            const cells = [
                ['Session P&L', `<span class="${pnlClass(snap.sessionPnl)}">${fmt(snap.sessionPnl)}</span>`],
                ['Peak P&L', fmt(snap.peakPnl)],
                ['Drawdown', `<span class="${snap.drawdown > 0 ? 'negative-pnl' : ''}">${fmt(snap.drawdown)}</span>`],
                ['Net', `${snap.net > 0 ? '+' : ''}${snap.net}`],
                ['Avg Px', snap.avgPrice == null ? '—' : fmt(snap.avgPrice, 4)],
                ['Unrealized', `<span class="${pnlClass(snap.unrealizedPnl)}">${fmt(snap.unrealizedPnl)}</span>`],
                ['Orders/min', `${snap.ordersLastMin}`],
                ['Status', snap.halted ? '<span class="negative-pnl">Halted</span>' : (this.runner.running ? '<span class="positive-pnl">Running</span>' : 'Idle')]
            ];
            this.$cards.innerHTML = cells.map(([k, v]) =>
                `<div class="bt-stat"><div class="bt-stat-label">${k}</div><div class="bt-stat-value">${v}</div></div>`
            ).join('');
        }

        _renderBlotter() {
            this.$orderCount.textContent = String(this._blotter.length);
            const rows = this._blotter.slice(-200).reverse().map(o => {
                const time = Number.isFinite(o.time) ? new Date(o.time).toLocaleTimeString() : '—';
                const sideTxt = o.side === 1 ? 'Buy' : 'Sell';
                const sideCls = o.side === 1 ? 'positive-pnl' : 'negative-pnl';
                const price = (o.type === 'market' || !o.price) ? 'mkt' : fmt(o.price, 4);
                return `<tr><td>${time}</td><td class="${sideCls}">${sideTxt}</td><td>${o.qty}</td><td>${o.type}</td><td>${price}</td></tr>`;
            }).join('');
            this.$blotterBody.innerHTML = rows || '<tr><td colspan="5">No orders yet</td></tr>';
        }

        _reflect(running) {
            if (running) this._resetDash();
            this.$start.disabled = running;
            this.$stop.disabled = !running;
            this.$kill.disabled = !running;
            // Lock all config (strategy + params + risk limits) while armed.
            const lockable = [this.$strategy, this.$maxPos, this.$maxOrder, this.$maxLoss,
                this.$lossUnit, this.$maxDD, this.$maxRate, this.$maxStale,
                this.$requireDemo, this.$haltBadData];
            for (const el of lockable) el.disabled = running;
            for (const el of this.$params.querySelectorAll('input')) el.disabled = running;
            this.$dot.classList.toggle('running', running);
            this.$statusText.textContent = running
                ? `Running — ${this.runner.strategy?.constructor.displayName || ''}`
                : 'Idle';
            this._refreshCards();
        }
    }

    Algo.ui = Algo.ui || {};
    Algo.ui.AlgoPanel = AlgoPanel;
})(window);
