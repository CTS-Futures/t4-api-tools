/**
 * algo/ui/BacktestPanel.js
 *
 * UI for running a backtest over the chart's currently-loaded history. Picks a
 * strategy + params + cost model, runs Backtester, and renders summary stats,
 * an equity curve (Lightweight Charts), and a trade blotter.
 *
 * Data source caveat (surfaced in the UI): the backtest uses exactly the bars
 * the chart has loaded for the active market. To test a longer window, scroll
 * the chart left first so the lazy history loader fetches older bars.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    const fmt = (v, d = 2) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmtPct = (v) => (v == null || !Number.isFinite(v)) ? '—' : `${v.toFixed(2)}%`;

    class BacktestPanel {
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
            this.log = typeof log === 'function' ? log : (m => console.log('[backtest]', m));
            this._equityChart = null;
            this._equitySeries = null;
            this._build();
        }

        _build() {
            this.host.innerHTML = `
                <div class="algo-form">
                    <div class="form-group">
                        <label for="btStrategy">Strategy:</label>
                        <select id="btStrategy"></select>
                    </div>
                    <div id="btParams" class="algo-params"></div>
                    <div class="form-group">
                        <label for="btPointValue" title="$ per price point (contract multiplier). 1 = report PnL in points.">Point $:</label>
                        <input type="number" id="btPointValue" value="1" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="btCommission" title="Commission per contract, per fill">Comm:</label>
                        <input type="number" id="btCommission" value="0" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="btSlippage" title="Adverse slippage in price units, per market fill">Slip:</label>
                        <input type="number" id="btSlippage" value="0" min="0" step="any" class="chart-qty-input">
                    </div>
                    <div class="form-group">
                        <label for="btStart" title="Backtest window start. Leave blank to use the chart's loaded history instead.">From:</label>
                        <input type="datetime-local" id="btStart" class="bt-date-input">
                    </div>
                    <div class="form-group">
                        <label for="btEnd" title="Backtest window end. Can be any time after the start, up to the current moment. Leave blank for now.">To:</label>
                        <input type="datetime-local" id="btEnd" class="bt-date-input">
                    </div>
                    <div class="form-group submit-btn-container">
                        <button id="btRunBtn" class="submit-order-btn">Run Backtest</button>
                    </div>
                </div>
                <div class="bt-note" id="btNote">Set a From/To date range to fetch and test any historical window for the active market. Leave both blank to use the chart's currently-loaded history.</div>
                <div class="bt-results" id="btResults" style="display:none;">
                    <div class="bt-stats" id="btStats"></div>
                    <div class="bt-equity-wrap">
                        <div class="bt-subtitle">Equity Curve</div>
                        <div class="bt-equity" id="btEquity"></div>
                    </div>
                    <div class="bt-trades-wrap">
                        <div class="bt-subtitle">Trades (<span id="btTradeCount">0</span>)</div>
                        <div class="table-container bt-trades-scroll">
                            <table class="bt-trades-table">
                                <thead><tr><th>Time</th><th>Dir</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Net P&L</th></tr></thead>
                                <tbody id="btTradesBody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>`;

            this.$strategy = this.host.querySelector('#btStrategy');
            this.$params = this.host.querySelector('#btParams');
            this.$run = this.host.querySelector('#btRunBtn');
            this.$results = this.host.querySelector('#btResults');
            this.$stats = this.host.querySelector('#btStats');
            this.$equity = this.host.querySelector('#btEquity');
            this.$tradesBody = this.host.querySelector('#btTradesBody');
            this.$tradeCount = this.host.querySelector('#btTradeCount');

            const reg = Algo.strategies || {};
            for (const key of Object.keys(reg)) {
                // Bridge strategies (e.g. Python) decide asynchronously over a
                // socket and can't run in the synchronous Backtester — leave them
                // out of the dropdown so the user isn't offered a no-op run.
                if (reg[key].bridgeOnly) continue;
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = reg[key].displayName || key;
                this.$strategy.appendChild(opt);
            }

            this._renderParams();
            this.$strategy.addEventListener('change', () => this._renderParams());
            this.$run.addEventListener('click', () => this._run());
        }

        _renderParams() {
            const Ctor = (Algo.strategies || {})[this.$strategy.value];
            const schema = (Ctor && Ctor.params) || [];
            Algo.ui.buildParamInputs(this.$params, schema, 'btP_');
        }

        _getBars() {
            // Chart history is normalized: {time(UTC s), open, high, low, close}, ascending.
            const bars = this.chartService?._historyBars;
            return Array.isArray(bars) ? bars : [];
        }

        // Parses a datetime-local value ("YYYY-MM-DDTHH:mm") into a local Date,
        // or null when blank/invalid. Local wall-clock matches how ChartService
        // already hands timestamps to the Chart API.
        _parseLocal(v) {
            if (!v) return null;
            const d = new Date(v);
            return Number.isFinite(d.getTime()) ? d : null;
        }

        // Resolves the bars to backtest: an explicit From/To range fetched from
        // the Chart API when a From date is set, otherwise the chart's currently
        // loaded history. Returns { bars, label } or throws with a user message.
        async _resolveBars() {
            const start = this._parseLocal(this.host.querySelector('#btStart').value);
            const endRaw = this._parseLocal(this.host.querySelector('#btEnd').value);

            // No From date: keep the original behavior (loaded chart history).
            if (!start) {
                if (endRaw) {
                    throw new Error('Enter a From date to backtest a custom range (or clear To to use loaded history)');
                }
                const bars = this._getBars();
                if (bars.length < 2) {
                    throw new Error('No chart history to backtest — connect, select a market, and let the chart load');
                }
                return { bars, label: `${bars.length} loaded bars` };
            }

            // From set: To defaults to "now". Fetch the window from the API so the
            // run can cover any historical range, independent of the chart view.
            const end = endRaw || new Date();
            if (start.getTime() >= end.getTime()) {
                throw new Error('From date must be before To date');
            }
            if (typeof this.chartService?.fetchHistoryRange !== 'function') {
                throw new Error('Chart service unavailable — cannot fetch a date range');
            }
            const { bars } = await this.chartService.fetchHistoryRange(start, end);
            if (!Array.isArray(bars) || bars.length < 2) {
                throw new Error('No bars returned for that date range — try a wider window or a smaller interval');
            }
            return {
                bars,
                label: `${bars.length} bars, ${start.toLocaleString()} → ${end.toLocaleString()}`
            };
        }

        async _run() {
            let bars, rangeLabel;
            const origText = this.$run.textContent;
            this.$run.disabled = true;
            this.$run.textContent = 'Loading…';
            try {
                ({ bars, label: rangeLabel } = await this._resolveBars());
            } catch (err) {
                this.log(err.message, 'error');
                return;
            } finally {
                this.$run.disabled = false;
                this.$run.textContent = origText;
            }

            const key = this.$strategy.value;
            const Ctor = (Algo.strategies || {})[key];
            if (!Ctor) { this.log(`Unknown strategy: ${key}`, 'error'); return; }
            if (Ctor.bridgeOnly) {
                this.log('Bridge strategies run live only — backtest the SmaCrossover twin instead (it mirrors the Python logic bar-for-bar).', 'error');
                return;
            }

            const strategy = new Ctor(Algo.ui.readParamInputs(this.$params, Ctor.params || [], 'btP_'));

            const config = {
                pointValue: parseFloat(this.host.querySelector('#btPointValue').value) || 1,
                commission: parseFloat(this.host.querySelector('#btCommission').value) || 0,
                slippage: parseFloat(this.host.querySelector('#btSlippage').value) || 0,
                startingCash: 100000,
                // Quiet log during the run so per-bar strategy logging doesn't
                // flood the console with thousands of lines.
                log: () => {}
            };

            let result;
            try {
                result = new Algo.Backtester().run({
                    bars, strategy, config,
                    intervalMs: this.chartService?.intervalMs
                });
            } catch (err) {
                this.log(`Backtest failed: ${err.message}`, 'error');
                return;
            }

            this._render(result, bars.length);

            // Mirror the run on the Strategy View: the strategy's own traces over
            // the tested window, with a marker at every fill (entries and exits).
            if (this.strategyChart) {
                try {
                    this.strategyChart.setSchema(Ctor.plots || []);
                    const markers = (result.trades || []).map(t => ({ time: t.time, side: t.side }));
                    this.strategyChart.setData(result.plots || [], markers);
                    this.strategyChart.show();
                } catch (err) {
                    this.log(`Strategy view render failed: ${err.message}`, 'error');
                }
            }

            this.log(`Backtest (${rangeLabel}): ${result.stats.numTrades} trades, net ${fmt(result.stats.netProfit)} (${fmtPct(result.stats.totalReturnPct)})`, 'info');
        }

        _render(result, barCount) {
            const s = result.stats;
            this.$results.style.display = '';

            const pnlClass = (v) => v > 0 ? 'positive-pnl' : v < 0 ? 'negative-pnl' : '';
            const sharpeLabel = s.sharpeAnnualized ? 'Sharpe (ann.)' : 'Sharpe';
            const cells = [
                ['Net Profit', `<span class="${pnlClass(s.netProfit)}">${fmt(s.netProfit)}</span>`],
                ['Return', `<span class="${pnlClass(s.totalReturnPct)}">${fmtPct(s.totalReturnPct)}</span>`],
                ['Max Drawdown', `<span class="negative-pnl">${fmt(s.maxDrawdown)} (${fmtPct(s.maxDrawdownPct)})</span>`],
                ['Trades', `${s.numTrades}`],
                ['Win Rate', fmtPct(s.winRatePct)],
                ['Profit Factor', s.profitFactor === Infinity ? '∞' : fmt(s.profitFactor)],
                [sharpeLabel, fmt(s.sharpe)],
                ['Final Equity', fmt(s.finalEquity)]
            ];
            this.$stats.innerHTML = cells.map(([k, v]) =>
                `<div class="bt-stat"><div class="bt-stat-label">${k}</div><div class="bt-stat-value">${v}</div></div>`
            ).join('');

            this._renderEquity(result.equityCurve);
            this._renderTrades(result.trades, result.config.pointValue);
        }

        _renderEquity(curve) {
            if (!this._equityChart) {
                const made = Algo.ui.makeEquityChart(this.$equity);
                if (!made) { this.$equity.textContent = 'Charting library unavailable'; return; }
                this._equityChart = made.chart;
                this._equitySeries = made.series;
            }
            this._equitySeries.setData(curve.map(p => ({ time: p.time, value: p.value })));
            this._equityChart.timeScale().fitContent();
        }

        _renderTrades(trades, pointValue) {
            // One row per completed round-trip. A "closing" fill reduced/closed a
            // position, so it carries both the entry (avg) and exit price. The
            // closing fill's side is opposite the position's direction: a Sell
            // closes a Long, a Buy closes a Short.
            const closed = trades.filter(t => t.closing);
            this.$tradeCount.textContent = String(closed.length);
            // Show the most recent 200 round-trips, newest first.
            const rows = closed.slice(-200).reverse().map(t => {
                const time = new Date(t.time * 1000).toLocaleString();
                const dir = t.side === 1 ? 'Short' : 'Long';   // buy closes short, sell closes long
                const dirCls = t.side === 1 ? 'negative-pnl' : 'positive-pnl';
                const qty = t.closedQty || t.qty;
                const net = t.pnl - t.commission;
                const cls = net > 0 ? 'positive-pnl' : net < 0 ? 'negative-pnl' : '';
                return `<tr><td>${time}</td><td class="${dirCls}">${dir}</td><td>${qty}</td><td>${fmt(t.entryPrice)}</td><td>${fmt(t.price)}</td><td class="${cls}">${fmt(net)}</td></tr>`;
            }).join('');
            this.$tradesBody.innerHTML = rows || '<tr><td colspan="6">No closed trades</td></tr>';
        }
    }

    Algo.ui = Algo.ui || {};
    Algo.ui.BacktestPanel = BacktestPanel;
})(window);
