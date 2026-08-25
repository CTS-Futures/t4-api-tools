/**
 * algo/Backtester.js
 *
 * Drives a strategy over a fixed array of historical bars through a SimBroker
 * and returns the run's equity curve, trade blotter, and summary stats.
 *
 * It is deliberately PURE: it takes already-normalized bars (display-unit
 * OHLC, UTC-second timestamps, ascending) rather than fetching/parsing them
 * itself. The UI sources those bars from the chart's loaded history, so the
 * backtest and the on-screen chart are guaranteed to agree, and we don't
 * duplicate ChartService's price-scaling/time-parsing.
 *
 * The same strategy instance shape runs here and live — that equivalence is
 * the whole point of the IBroker abstraction.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});

    class Backtester {
        /**
         * @param {Object} opts
         * @param {Array<{time:number,open:number,high:number,low:number,close:number,volume?:number}>} opts.bars
         * @param {import('./strategies/Strategy').Strategy} opts.strategy
         * @param {Object} [opts.config]   { pointValue, commission, slippage, startingCash, log }
         * @param {number} [opts.intervalMs]  bar interval, for Sharpe annualization
         * @returns {{ bars, equityCurve, trades, stats, config }}
         */
        run({ bars, strategy, config = {}, intervalMs }) {
            if (!Array.isArray(bars) || bars.length < 2) {
                throw new Error('Backtest needs at least 2 bars — load more chart history first');
            }
            // Defensive: ensure ascending by time (chart history already is).
            const series = bars.slice().sort((a, b) => a.time - b.time);

            const sim = new Algo.SimBroker(config);
            const log = typeof config.log === 'function' ? config.log : (() => {});
            strategy.init(sim, { log });

            // Wire the strategy to the broker's event stream — the same hookup
            // AlgoRunner does live. Without this, processBar() emits bars that
            // nobody hears and the strategy never trades. (No 'tick' in
            // backtest: the engine is bar-driven.)
            sim.on('bar', (b) => { try { strategy.onBar(b); } catch (e) { log(`Strategy error: ${e.message}`, 'error'); } });
            sim.on('fill', (f) => { try { strategy.onFill(f); } catch (e) { log(`Strategy error: ${e.message}`, 'error'); } });

            // No warmup seeding here: the strategy accumulates indicators from
            // the first bar, mirroring a live run that starts cold. It simply
            // won't trade until its indicators are ready.
            //
            // processBar synchronously fires sim.on('bar') -> strategy.onBar, so by
            // the time it returns the strategy has stashed this bar's plot values.
            // Drain them per bar for the Strategy View (same shape as the live
            // AlgoRunner.onPlot point).
            const plots = [];
            const wantsPlots = typeof strategy._drainPlots === 'function';
            for (let i = 0; i < series.length; i++) {
                const b = series[i];
                sim.processBar(b);
                if (wantsPlots) {
                    plots.push({ time: b.time, close: b.close, values: strategy._drainPlots(), net: sim.position().net });
                }
            }

            // Realize any open position at the last close for a single clean
            // net-profit figure (otherwise the result hides open risk).
            const last = series[series.length - 1];
            sim.forceClose(last.close, last.time);

            if (typeof strategy.teardown === 'function') {
                try { strategy.teardown(); } catch (_) {}
            }

            return {
                bars: series,
                equityCurve: sim.portfolio.equityCurve,
                trades: sim.portfolio.trades,
                stats: sim.portfolio.stats(intervalMs),
                config: sim.configSummary(),
                plots
            };
        }
    }

    Algo.Backtester = Backtester;
})(window);
