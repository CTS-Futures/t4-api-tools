// Loaded only by experimental.html, after the shared demo initialization.
document.addEventListener('DOMContentLoaded', function () {
    const client = window.client;
    const chartService = window.chartService;
    const log = client.log.bind(client);
        // ---------- Strategy View chart --------------------------------------
        // Second chart under the candles that renders the active strategy's own
        // traces. Shared by the Algo Trader (live) and Backtester panels.
        let strategyChart = null;
        try {
            const stratHost = document.getElementById('strategyChart');
            if (stratHost && window.ChartFeatures?.StrategyChart) {
                strategyChart = new window.ChartFeatures.StrategyChart().mount(stratHost, {
                    wrapEl: document.getElementById('strategyChartWrap'),
                    legendEl: document.getElementById('strategyChartLegend')
                });
                window.strategyChart = strategyChart;
            }
        } catch (err) {
            console.error('Strategy chart init failed:', err);
        }

        // ---------- Algo Trader panel ----------------------------------------
        // Live strategy runner. Reuses the chart's closed-bar stream as the
        // strategy clock, so signals fire on the same bars the user sees.
        try {
            const algoHost = document.getElementById('algoPanel');
            if (algoHost && window.Algo?.ui?.AlgoPanel) {
                window.algoPanel = new window.Algo.ui.AlgoPanel({
                    host: algoHost,
                    client,
                    chartService,
                    strategyChart,
                    log
                });
            }
        } catch (err) {
            console.error('Algo panel init failed:', err);
        }

        // ---------- Backtester panel -----------------------------------------
        // Replays a strategy over the chart's loaded history through SimBroker.
        try {
            const btHost = document.getElementById('backtestPanel');
            if (btHost && window.Algo?.ui?.BacktestPanel) {
                window.backtestPanel = new window.Algo.ui.BacktestPanel({
                    host: btHost,
                    client,
                    chartService,
                    strategyChart,
                    log
                });
            }
        } catch (err) {
            console.error('Backtest panel init failed:', err);
        }


});
