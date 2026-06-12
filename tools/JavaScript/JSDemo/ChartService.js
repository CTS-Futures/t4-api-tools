/**
 * ChartService.js
 *
 * Live trading chart for the T4 WebSocket demo.
 *
 * Pipeline:
 *   T4APIClient.onTrade  ->  TickStore  ->  CandleAggregator  ->  ChartRenderer
 *
 * Price scaling is performed in T4APIClient.handleMarketDepthTrade before the
 * tick is emitted, using marketDetails.decimals / realDecimals and priceFormat.
 * The tick payload carries an already-scaled `price` plus `priceDecimals` for
 * formatting on the axis.
 *
 * Bars are time-based (default 60s). The aggregator mutates the current
 * forming bar and emits `barUpdate`; on bucket rollover it emits `barClose`.
 * The renderer calls series.update() so only the last candle re-paints.
 */

(function (global) {
    'use strict';

    // ---------- TickStore ----------------------------------------------------
    // Bounded ring buffer keyed by marketId. Caps memory under burst load.
    class TickStore {
        constructor(capacity = 5000) {
            this.capacity = capacity;
            this.byMarket = new Map(); // marketId -> { buf: Array, head: int, size: int }
        }

        push(tick) {
            let slot = this.byMarket.get(tick.marketId);
            if (!slot) {
                slot = { buf: new Array(this.capacity), head: 0, size: 0 };
                this.byMarket.set(tick.marketId, slot);
            }
            slot.buf[slot.head] = tick;
            slot.head = (slot.head + 1) % this.capacity;
            if (slot.size < this.capacity) slot.size++;
        }

        clear(marketId) {
            if (marketId == null) this.byMarket.clear();
            else this.byMarket.delete(marketId);
        }
    }

    // ---------- CandleAggregator --------------------------------------------
    // Folds ticks into OHLCV bars on a time interval. Emits:
    //   'barUpdate' - the forming bar mutated (call series.update with last)
    //   'barClose'  - a bar was finalized (the next tick started a new bucket)
    class CandleAggregator {
        constructor(intervalMs = 60_000) {
            this.intervalMs = intervalMs;
            this.current = null; // { time, open, high, low, close, volume } - time in seconds
            this.listeners = { barUpdate: [], barClose: [] };
        }

        on(event, fn) {
            if (this.listeners[event]) this.listeners[event].push(fn);
        }

        reset(intervalMs) {
            if (intervalMs) this.intervalMs = intervalMs;
            this.current = null;
        }

        addTick(tick) {
            const bucketMs = Math.floor(tick.time / this.intervalMs) * this.intervalMs;
            const bucketSec = Math.floor(bucketMs / 1000);

            if (!this.current) {
                this.current = this._newBar(bucketSec, tick);
                this._emit('barUpdate', this.current);
                return;
            }

            if (bucketSec === this.current.time) {
                if (tick.price > this.current.high) this.current.high = tick.price;
                if (tick.price < this.current.low) this.current.low = tick.price;
                this.current.close = tick.price;
                this.current.volume += tick.volume;
                this._emit('barUpdate', this.current);
            } else if (bucketSec > this.current.time) {
                this._emit('barClose', this.current);
                this.current = this._newBar(bucketSec, tick);
                this._emit('barUpdate', this.current);
            }
            // Out-of-order earlier ticks are ignored (stream is ~monotonic).
        }

        _newBar(timeSec, tick) {
            return {
                time: timeSec,
                open: tick.price,
                high: tick.price,
                low: tick.price,
                close: tick.price,
                volume: tick.volume
            };
        }

        _emit(event, payload) {
            const fns = this.listeners[event];
            for (let i = 0; i < fns.length; i++) fns[i](payload);
        }
    }

    // ---------- ChartRenderer -----------------------------------------------
    // Wraps TradingView Lightweight Charts. Uses update() for incremental paint.
    class ChartRenderer {
        constructor(container) {
            if (!global.LightweightCharts) {
                throw new Error('LightweightCharts not loaded');
            }
            this.container = container;
            this.chart = global.LightweightCharts.createChart(container, {
                layout: { background: { color: '#1e1e1e' }, textColor: '#d0d0d0' },
                grid: {
                    vertLines: { color: '#2a2a2a' },
                    horzLines: { color: '#2a2a2a' }
                },
                rightPriceScale: {
                    borderColor: '#444',
                    // entireTextOnly:true hides the whole axis-label badge when
                    // the price string doesn't fit — which is what causes the
                    // green/red price tag on order/position lines to "go blank"
                    // or appear cut off for wide numbers. Allow partial-text
                    // fallback and give the scale enough width for typical
                    // futures prices (e.g. 5-digit + decimals).
                    entireTextOnly: false,
                    minimumWidth: 96
                },
                timeScale: {
                    borderColor: '#444',
                    timeVisible: true,
                    secondsVisible: false,
                    // Hard-stop panning at the data boundaries: users cannot
                    // scroll past the first bar (left) or the last bar (right),
                    // so the view never drifts into empty space beyond the data.
                    fixLeftEdge: true,
                    fixRightEdge: true
                },
                crosshair: { mode: 1 },
                autoSize: true
            });
            this._priceDecimals = null;

            this.candleSeries = this.chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350'
            });

            this.volumeSeries = this.chart.addHistogramSeries({
                priceFormat: { type: 'volume' },
                priceScaleId: '',
                color: '#5a5a5a'
            });
            this.volumeSeries.priceScale().applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 }
            });

            // autoSize: true (set on createChart) handles canvas resizing.
            // Do NOT call fitContent() on resize — sibling panels (positions,
            // overlays) re-render on every price tick, which triggers a
            // layout reflow here, which would reset the user's pan/zoom on
            // every print.
            this._resizeObs = null;
        }

        setPriceDecimals(decimals) {
            this._priceDecimals = decimals;
            const formatter = (price) => price.toFixed(decimals);
            this.candleSeries.applyOptions({
                priceFormat: {
                    type: 'custom',
                    formatter: formatter,
                    minMove: Math.pow(10, -decimals)
                }
            });
        }

        clear() {
            this.candleSeries.setData([]);
            this.volumeSeries.setData([]);
        }

        updateBar(bar) {
            this.candleSeries.update({
                time: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close
            });
            this.volumeSeries.update({
                time: bar.time,
                value: bar.volume,
                color: bar.close >= bar.open ? '#26a69a55' : '#ef535055'
            });
        }

        fitContent() {
            this.chart.timeScale().fitContent();
        }

        // Zooms the visible time range onto the most recent trading day in
        // `bars` (rather than showing the entire lookback window). This keeps
        // the user "zoned in" on the current day while older bars stay loaded
        // off-screen to the left, so panning left lets the lazy history loader
        // do its work one chunk at a time. Falls back to fitContent when there
        // isn't enough data to define a day window.
        focusRecentDay(bars) {
            if (!Array.isArray(bars) || bars.length === 0) return;
            const lastTime = bars[bars.length - 1].time;
            const firstTime = bars[0].time;
            // Start of the UTC day containing the most recent bar.
            const DAY_SEC = 86_400;
            const dayStart = Math.floor(lastTime / DAY_SEC) * DAY_SEC;
            const from = Math.max(firstTime, dayStart);
            // If the whole dataset fits within a single day there's nothing to
            // zoom into — just show everything.
            if (from <= firstTime) {
                this.chart.timeScale().fitContent();
                return;
            }
            // Guard against a sparse/empty most-recent UTC day (weekend, holiday,
            // or a market that hasn't traded yet today): the computed window
            // would be visually empty, hiding all the decoded bars. Count bars
            // inside the candidate window and, if there aren't enough to render
            // anything meaningful, anchor to the last ~200 bars instead.
            let inWindow = 0;
            for (let i = bars.length - 1; i >= 0; i--) {
                const t = bars[i].time;
                if (t < from) break;
                inWindow++;
                if (inWindow >= 3) break;
            }
            if (inWindow < 3) {
                const tailCount = Math.min(200, bars.length);
                const tailFrom = bars[bars.length - tailCount].time;
                this.chart.timeScale().setVisibleRange({ from: tailFrom, to: lastTime });
                return;
            }
            this.chart.timeScale().setVisibleRange({ from, to: lastTime });
        }

        dispose() {
            if (this._resizeObs) this._resizeObs.disconnect();
            if (this.chart) this.chart.remove();
        }
    }

    // ---------- ChartService -------------------------------------------------
    // Continuous (no-lookback) chart: the initial fetch covers a small fixed
    // window so the first paint is snappy, and older bars are pulled in
    // 1-day chunks on demand as the user scrolls/drags left. The floor date
    // is a far-enough-back date used as the absolute backstop; the Chart API
    // clamps it to the earliest bar actually available for the market.
    const HISTORY_FLOOR_START = '1990-01-01T00:00:00';
    const INITIAL_LOAD_DAYS = 2;   // first fetch on market select / interval change
    const CHUNK_DAYS = 1;          // each lazy older-history fetch as user pans left
    const SCROLL_BUFFER_DAYS = 1;  // keep ~this many days of off-screen bars to the
                                   // left of the visible edge; prefetching kicks in
                                   // once the user scrolls into this buffer so older
                                   // history is already loaded by the time they reach it
    const HEARTBEAT_MS = 20_000;   // periodic chart-state log cadence

    // Maps the live-aggregation interval (ms) to the Chart API's
    // (barInterval, barPeriod) pair used for historical bar requests.
    function intervalMsToBarSpec(ms) {
        if (ms < 60_000) return { barInterval: 'Second', barPeriod: Math.max(1, Math.round(ms / 1000)) };
        if (ms < 3_600_000) return { barInterval: 'Minute', barPeriod: Math.max(1, Math.round(ms / 60_000)) };
        if (ms < 86_400_000) return { barInterval: 'Hour', barPeriod: Math.max(1, Math.round(ms / 3_600_000)) };
        return { barInterval: 'Day', barPeriod: Math.max(1, Math.round(ms / 86_400_000)) };
    }

    // Chart API timestamps are wall-clock CST (America/Chicago) with no offset.
    // Convert "YYYY-MM-DDTHH:mm:ss[.fff]" -> UTC epoch seconds, handling DST.
    function csTimeToUtcSec(isoNoTz) {
        if (!isoNoTz) return null;
        // Strip fractional seconds; Date can't parse them uniformly when we
        // tack on 'Z' below, and second precision is enough for bar buckets.
        const clean = String(isoNoTz).split('.')[0];
        const asIfUtcMs = Date.parse(clean + 'Z');
        if (!Number.isFinite(asIfUtcMs)) return null;

        // Compute the Chicago wall-clock at the instant `asIfUtcMs` represents,
        // expressed numerically as if those wall-clock fields were UTC. The
        // difference is the Chicago offset from UTC at that moment.
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const parts = dtf.formatToParts(new Date(asIfUtcMs));
        const get = (t) => parts.find((p) => p.type === t)?.value;
        const chicagoAsUtcMs = Date.UTC(
            Number(get('year')), Number(get('month')) - 1, Number(get('day')),
            Number(get('hour')) % 24, Number(get('minute')), Number(get('second'))
        );
        const offsetMs = chicagoAsUtcMs - asIfUtcMs; // negative for Chicago
        const actualUtcMs = asIfUtcMs - offsetMs;     // wall-clock was Chicago, shift to real UTC
        return Math.floor(actualUtcMs / 1000);
    }

    // Format a Date as 'YYYY-MM-DDTHH:mm:ss' (no TZ) for the Chart API.
    function formatNoTz(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
               `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // If a recent live tick exists for this market, infer the Chart-API
    // integer divisor by snapping rawClose/liveDisplay to the nearest power
    // of 10. Returns null when we can't trust the inference (no live data,
    // negative/zero prices, or implausible ratio).
    function calibrateScale(rawClose, livePrice) {
        if (!Number.isFinite(rawClose) || !Number.isFinite(livePrice)) return null;
        if (rawClose <= 0 || livePrice <= 0) return null;
        const ratio = rawClose / livePrice;
        if (ratio < 0.5 || ratio > 1e9) return null;
        const exp = Math.round(Math.log10(ratio));
        if (exp < 0 || exp > 8) return null;
        return Math.pow(10, exp);
    }

    // Orchestrator. Wires client.onTrade -> store -> aggregator -> renderer,
    // follows currentMarketId, exposes interval control.
    class ChartService {
        constructor({
            client,
            container,
            intervalSelect,
            intervalMs = 60_000,
            tickCapacity = 5000,
            overlayEl = null
        }) {
            this.client = client;
            this.store = new TickStore(tickCapacity);
            this.aggregator = new CandleAggregator(intervalMs);
            this.renderer = new ChartRenderer(container);
            this.activeMarketId = null;
            this.knownDecimals = 2;
            this.pendingTicks = []; // ticks that arrived before marketDetails
            this.intervalMs = intervalMs;
            this.overlayEl = overlayEl;
            this._loadToken = 0; // race guard for async history loads
            this._historyBars = null; // last loaded historical bars for active market
            this._historyVolBars = null; // volume bars matching _historyBars
            this._historyWindowStart = null; // Date: oldest history-request boundary so far
            this._historyScale = null; // JSON-path price divisor (reused for older chunks)
            this._loadingOlder = false; // guard: an older-history fetch is in flight
            this._noMoreHistory = false; // true once the earliest available bar is reached
            this._rearmHandle = 0; // rAF handle for scheduled older-history re-arm
            this._decodeMode = null; // 'binary' | 'json' | null — last completed load's decode path

            // Event bus and feature registry. Features attach to the chart and
            // subscribe to pipeline events (bars:loaded, bar:update, bar:close,
            // symbol:changed, interval:changed) without the host knowing them.
            const BusCtor = global.ChartEventBus;
            this.bus = BusCtor ? new BusCtor() : { on: () => () => {}, off: () => {}, emit: () => {}, clear: () => {} };
            this._features = new Map(); // id -> feature

            this.onPriceLevelClick = null; // (price) => void
            this.onOrderLineClick = null;  // (uniqueId) => void
            this._hitTestPx = 6;

            // Coalesce bar updates to one paint per animation frame. On busy
            // markets the aggregator can fire barUpdate many times per second
            // (one per trade tick); without coalescing each fires a canvas
            // repaint and a full indicator recompute, which looks like the
            // whole chart flickering on every bid/ask change. The aggregator
            // mutates `this.current` in place, so by the time the rAF runs we
            // always read the latest bar — no data is lost.
            this._pendingBar = null;
            this._rafHandle = 0;
            const flushPendingBar = () => {
                this._rafHandle = 0;
                const bar = this._pendingBar;
                this._pendingBar = null;
                if (!bar) return;
                this.renderer.updateBar(bar);
                this.bus.emit('bar:update', bar);
                for (const f of this._features.values()) {
                    if (typeof f.onBarUpdate === 'function') {
                        try { f.onBarUpdate(bar); } catch (err) { console.error(`[ChartService] feature "${f.id}" onBarUpdate failed:`, err); }
                    }
                }
            };
            this.aggregator.on('barUpdate', (bar) => {
                this._pendingBar = bar;
                if (!this._rafHandle) {
                    this._rafHandle = (global.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(flushPendingBar);
                }
            });
            this.aggregator.on('barClose', (bar) => {
                this.bus.emit('bar:close', bar);
                for (const f of this._features.values()) {
                    if (typeof f.onBarClose === 'function') {
                        try { f.onBarClose(bar); } catch (err) { console.error(`[ChartService] feature "${f.id}" onBarClose failed:`, err); }
                    }
                }
            });

            // Click on chart: hit-test order lines first, otherwise emit price-level click.
            this.renderer.chart.subscribeClick((param) => this._onChartClick(param));

            // Lazy "infinite scroll" history with a look-ahead buffer: prefetch
            // an older chunk as soon as the visible edge comes within
            // SCROLL_BUFFER_DAYS' worth of bars of the oldest loaded bar — i.e.
            // while the user is still scrolling through buffered history — so the
            // next chunk is already loaded by the time they reach the edge. The
            // guard inside _loadOlderHistory prevents overlapping/redundant loads.
            this.renderer.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (range && range.from < this._scrollBufferBars()) this._loadOlderHistory();
            });

            // Built-in overlays (extracted into feature modules). Registered
            // here so the existing public API (setWorkingOrders, setPositionLine,
            // clearOverlays) keeps working without callers changing.
            const Features = global.ChartFeatures || {};
            if (Features.OrderLines) this.registerFeature(new Features.OrderLines());
            if (Features.PositionLine) this.registerFeature(new Features.PositionLine());

            // Listen for explicit market changes (user picks a new contract).
            const priorMarketChanged = client.onMarketChanged;
            client.onMarketChanged = (info) => {
                if (priorMarketChanged) {
                    try { priorMarketChanged(info); } catch (_) { /* swallow */ }
                }
                this._switchMarket(info.marketId);
            };

            // Hook trades. Preserve any existing handler (defensive).
            const prior = client.onTrade;
            client.onTrade = (tick) => {
                if (prior) {
                    try { prior(tick); } catch (_) { /* swallow */ }
                }
                this._onTrade(tick);
            };

            if (intervalSelect) {
                intervalSelect.addEventListener('change', (e) => {
                    const ms = Number(e.target.value);
                    if (Number.isFinite(ms) && ms > 0) this.setInterval(ms);
                });
            }

            // Periodic chart-state heartbeat: surfaces which decode path
            // (T4Bin decoder vs JSON fallback) the chart is currently running
            // on, plus the total bars loaded for the active market. Only emits
            // while a market is active so it doesn't spam the console at idle.
            this._heartbeatTimer = setInterval(() => this._emitHeartbeat(), HEARTBEAT_MS);
        }

        setInterval(ms) {
            this.intervalMs = ms;
            this.aggregator.reset(ms);
            this.renderer.clear();
            this.bus.emit('interval:changed', { intervalMs: ms });
            // Reload history at the new bar size, then replay live ticks on top.
            this._loadAndReplay();
        }

        // Emits a Console heartbeat describing the current chart state: which
        // decode path served the last history load, and how many bars are
        // currently loaded. Silent when no market is active.
        _emitHeartbeat() {
            const marketId = this.activeMarketId;
            if (!marketId) return;
            const mode = this._decodeMode || 'pending';
            const barCount = Array.isArray(this._historyBars) ? this._historyBars.length : 0;
            this.client.log?.(
                `Chart heartbeat: mode=${mode}, bars=${barCount}, market=${marketId}`,
                'info'
            );
        }

        // ---------- Feature registry --------------------------------------
        registerFeature(feature) {
            if (!feature || !feature.id) return;
            if (this._features.has(feature.id)) return;
            this._features.set(feature.id, feature);
            if (typeof feature.attach === 'function') {
                try {
                    feature.attach({
                        chart: this.renderer.chart,
                        candleSeries: this.renderer.candleSeries,
                        volumeSeries: this.renderer.volumeSeries,
                        container: this.renderer.container,
                        bus: this.bus,
                        host: this,
                        client: this.client
                    });
                } catch (err) {
                    console.error(`[ChartService] feature "${feature.id}" attach failed:`, err);
                }
            }
            // Backfill: if history already exists for this symbol, deliver it.
            if (Array.isArray(this._historyBars) && this._historyBars.length && typeof feature.onBars === 'function') {
                try { feature.onBars(this._historyBars); } catch (err) { console.error(err); }
            }
        }

        unregisterFeature(id) {
            const f = this._features.get(id);
            if (!f) return;
            if (typeof f.detach === 'function') {
                try { f.detach(); } catch (err) { console.error(err); }
            }
            this._features.delete(id);
        }

        getFeature(id) {
            return this._features.get(id) || null;
        }

        _switchMarket(marketId, force = false) {
            if (!force && this.activeMarketId === marketId) return;
            this.activeMarketId = marketId;
            this.aggregator.reset();
            this.renderer.clear();
            this.clearOverlays();
            this.bus.emit('symbol:changed', { marketId });
            this.pendingTicks.length = 0;
            this._historyBars = null;
            this._historyVolBars = null;
            this._historyWindowStart = null;
            this._historyScale = null;
            this._loadingOlder = false;
            this._noMoreHistory = false;
            if (this._rearmHandle) {
                (global.cancelAnimationFrame || clearTimeout)(this._rearmHandle);
                this._rearmHandle = 0;
            }
            // Clear TTV dedup so the first trade on the new market isn't rejected.
            if (this.client._lastTtvByMarket) {
                this.client._lastTtvByMarket.delete(marketId);
            }
            if (this.client._lastTradeKeyByMarket) {
                this.client._lastTradeKeyByMarket.delete(marketId);
            }
            this._refreshDecimals();
            this._loadAndReplay();
        }

        // Public: force a full reset for a given market (called directly from the
        // UI when the user picks a new contract/expiry).
        resetForMarket(marketId) {
            this._switchMarket(marketId, true);
        }

        _refreshDecimals() {
            const details = this.client.getMarketDetails(this.activeMarketId);
            if (!details) return;
            const pf = this.client.config?.priceFormat ?? 0;
            const d = (pf === 0 ? details.decimals : details.realDecimals) ?? 2;
            if (d !== this.knownDecimals) {
                this.knownDecimals = d;
                this.renderer.setPriceDecimals(d);
            }
        }

        _replayActive() {
            const slot = this.store.byMarket.get(this.activeMarketId);
            if (!slot) return;
            // Read ring buffer in chronological order.
            const start = slot.size < this.store.capacity ? 0 : slot.head;
            for (let i = 0; i < slot.size; i++) {
                const idx = (start + i) % this.store.capacity;
                const tick = slot.buf[idx];
                if (tick) this.aggregator.addTick(tick);
            }
        }

        // Fetches historical bars from the Chart API, seeds the chart, then
        // replays any buffered live ticks so the latest candle extends cleanly.
        async _loadAndReplay() {
            const marketId = this.activeMarketId;
            if (!marketId) return;
            const sub = this.client.currentSubscription;
            if (!sub || sub.marketId !== marketId) {
                // No active subscription identity to satisfy exchangeId/contractId.
                this._replayActive();
                return;
            }

            // Preferred path: the T4Bin binary decoder scales prices correctly
            // from the market definition, so it needs no calibration heuristic.
            // The decoder is loaded as an ES module (decoder/loader.js), which
            // runs deferred, so on a cold start it may not be ready yet when
            // the first market subscription completes — wait briefly for it.
            if (typeof this.client.getBarChartBinary === 'function') {
                // Kick the chart server's cache warming as early as possible so
                // it computes bars while we wait for the decoder module and
                // market details. Fire-and-forget; the real load below retries.
                this._prewarmBinary(sub, marketId);
                const decoder = await this._waitForDecoder(2000);
                if (decoder) {
                    return this._loadAndReplayBinary(sub, marketId);
                }
                if (!this._decoderMissingLogged) {
                    this._decoderMissingLogged = true;
                    const reason = global.T4ChartDecoderError
                        ? `module load failed: ${global.T4ChartDecoderError.message || global.T4ChartDecoderError}`
                        : 'window.T4ChartDecoder not set (decoder/loader.js may have failed — check browser console & that the page is served over http(s), not file://)';
                    this.client.log?.(
                        `Chart history: binary decoder unavailable (${reason}); using legacy JSON+calibration path`,
                        'warning'
                    );
                }
            } else if (!this._decoderMissingLogged) {
                this._decoderMissingLogged = true;
                this.client.log?.(
                    'Chart history: client.getBarChartBinary missing; using legacy JSON+calibration path',
                    'warning'
                );
            }

            return this._loadAndReplayJson(sub, marketId);
        }

        // Fire-and-forget warm-up of the binary chart cache for the initial
        // window. The chart server computes aggregated bars asynchronously, so
        // issuing this request now means the cache is warm (or warming) by the
        // time _loadAndReplayBinary makes the real, retried fetch. Keyed by
        // market+interval so it fires once per distinct load. maxAttempts:1 makes
        // it return immediately without blocking on the warm-up backoffs.
        _prewarmBinary(sub, marketId) {
            if (typeof this.client.getBarChartBinary !== 'function') return;
            if (!sub || sub.marketId !== marketId) return;
            const key = `${marketId}|${this.intervalMs}`;
            if (this._prewarmedKey === key) return;
            this._prewarmedKey = key;
            try {
                const spec = intervalMsToBarSpec(this.intervalMs);
                const now = new Date();
                const start = new Date(now.getTime() - INITIAL_LOAD_DAYS * 86_400_000);
                Promise.resolve(
                    this.client.getBarChartBinary(sub.exchangeId, sub.contractId, marketId, {
                        barInterval: spec.barInterval,
                        barPeriod: spec.barPeriod,
                        tradeDateStart: formatNoTz(start),
                        tradeDateEnd: formatNoTz(now),
                        maxAttempts: 1,
                        warmOnly: true
                    })
                ).catch(() => { /* warm-up only; ignore */ });
            } catch (_) { /* ignore */ }
        }

        // Legacy JSON history path with live-tick price calibration. Used when
        // the binary decoder is unavailable, and as a fallback when the binary
        // fetch/decode fails for a given market (so the chart still gets a feed).
        // `inheritedToken`: when invoked as a binary fallback, the caller passes
        // its own load token so we don't bump _loadToken (which would otherwise
        // make the binary caller's post-await race guards bail). Omit for a
        // fresh load to allocate a new token.
        async _loadAndReplayJson(sub, marketId, inheritedToken = null) {
            if (typeof this.client.getBarChart !== 'function') {
                this._replayActive();
                return;
            }

            const token = inheritedToken != null ? inheritedToken : ++this._loadToken;
            this._setOverlay('Loading history…');

            // Wait briefly for marketDetails so we can scale prices correctly.
            // The decimals arrive over the WS shortly after subscribe; without
            // them historical prices would render off by a factor of 10^N.
            const detailsReady = await this._waitForMarketDetails(marketId, 5000);
            if (token !== this._loadToken || this.activeMarketId !== marketId) return;
            if (!detailsReady) {
                this._setOverlay('History unavailable (no market details)');
                this._replayActive();
                return;
            }

            // Wait for at least one live tick so the Chart API divisor can be
            // calibrated against a known display price. If no tick arrives in
            // time (illiquid market, after-hours), fall back to details.decimals.
            this._setOverlay('Waiting for live price to calibrate…');
            const calibratedLive = await this._waitForLiveTick(marketId, 15000);
            if (token !== this._loadToken || this.activeMarketId !== marketId) return;
            this._setOverlay('Loading history…');
            if (!calibratedLive) {
                this.client.log?.(
                    `No live tick within calibration window; using details.decimals for ${marketId}`,
                    'info'
                );
            }

            const spec = intervalMsToBarSpec(this.intervalMs);
            const now = new Date();
            const start = new Date(now.getTime() - INITIAL_LOAD_DAYS * 86_400_000);
            this._historyWindowStart = start;

            try {
                const data = await this.client.getBarChart(
                    sub.exchangeId, sub.contractId, marketId,
                    {
                        barInterval: spec.barInterval,
                        barPeriod: spec.barPeriod,
                        tradeDateStart: formatNoTz(start),
                        tradeDateEnd: formatNoTz(now)
                    }
                );

                // Race guard: another switch/reload happened mid-flight.
                if (token !== this._loadToken || this.activeMarketId !== marketId) return;

                this._refreshDecimals();
                const details = this.client.getMarketDetails(marketId);
                const rawBars = Array.isArray(data?.bars) ? data.bars : [];

                // Determine the integer divisor the Chart API used to encode
                // raw prices. The Chart API encodes prices using the market's
                // native `decimals` field (NOT realDecimals / clearingDecimals
                // which only affect live price.value display). When a recent
                // live print is available, prefer calibrating from it so we
                // are immune to any priceFormat oddity.
                let scaleDecimals = details?.decimals ?? this.knownDecimals ?? 2;
                const livePrice = this._latestLivePrice(marketId);
                const lastRawClose = rawBars.length ? Number(rawBars[rawBars.length - 1].closePrice) : null;
                const calibrated = calibrateScale(lastRawClose, livePrice);
                if (calibrated != null) {
                    const calibratedDecimals = Math.round(Math.log10(calibrated));
                    if (calibratedDecimals !== scaleDecimals) {
                        this.client.log?.(
                            `Chart scale calibrated: details.decimals=${scaleDecimals} -> live-derived=${calibratedDecimals} ` +
                            `(rawClose=${lastRawClose}, live=${livePrice})`,
                            'info'
                        );
                        scaleDecimals = calibratedDecimals;
                    }
                }
                const scale = Math.pow(10, scaleDecimals);
                this._historyScale = scale;

                // Normalize: scale prices, convert time to UTC seconds, sort, dedupe.
                const seen = new Set();
                const bars = [];
                const volBars = [];
                for (const b of rawBars) {
                    const t = csTimeToUtcSec(b.time);
                    if (t == null || seen.has(t)) continue;
                    seen.add(t);
                    const open = Number(b.openPrice) / scale;
                    const high = Number(b.highPrice) / scale;
                    const low = Number(b.lowPrice) / scale;
                    const close = Number(b.closePrice) / scale;
                    if (![open, high, low, close].every(Number.isFinite)) continue;
                    bars.push({ time: t, open, high, low, close });
                    volBars.push({
                        time: t,
                        value: Number(b.volume) || 0,
                        color: close >= open ? '#26a69a55' : '#ef535055'
                    });
                }
                bars.sort((a, b) => a.time - b.time);
                volBars.sort((a, b) => a.time - b.time);

                this._seedChartWithHistory(marketId, bars, volBars);
                this._decodeMode = 'json';
                this.client.log?.(
                    `Chart history loaded (JSON fallback): ${bars.length} bars for ${marketId}`,
                    'info'
                );
                this._setOverlay(bars.length ? null : 'No historical data');
            } catch (err) {
                if (token !== this._loadToken || this.activeMarketId !== marketId) return;
                this._setOverlay('History unavailable');
            }

            // Race guard before replay.
            if (token !== this._loadToken || this.activeMarketId !== marketId) return;
            this._replayActive();
        }

        // Binary decoder path: fetches the T4BinAggr payload and decodes it via
        // window.T4ChartDecoder. Prices are already in display units (scaled by
        // the market definition), so no live-tick calibration is required.
        async _loadAndReplayBinary(sub, marketId) {
            const token = ++this._loadToken;
            this._setOverlay('Loading history…');

            const spec = intervalMsToBarSpec(this.intervalMs);
            const now = new Date();
            const start = new Date(now.getTime() - INITIAL_LOAD_DAYS * 86_400_000);
            this._historyWindowStart = start;

            // Start the binary fetch immediately and wait for market details in
            // parallel — details only drive axis decimal formatting (display)
            // and the decoder's tick-size patch, and getBarChartBinary now waits
            // for them internally before decoding. Running them concurrently
            // removes the serial gap that previously delayed first paint.
            const detailsP = this._waitForMarketDetails(marketId, 5000);

            try {
                const fetchP = this.client.getBarChartBinary(
                    sub.exchangeId, sub.contractId, marketId,
                    {
                        barInterval: spec.barInterval,
                        barPeriod: spec.barPeriod,
                        tradeDateStart: formatNoTz(start),
                        tradeDateEnd: formatNoTz(now)
                    }
                );

                await detailsP;
                if (token !== this._loadToken || this.activeMarketId !== marketId) return;
                this._refreshDecimals();

                const decoded = await fetchP;

                if (token !== this._loadToken || this.activeMarketId !== marketId) return;

                const seen = new Set();
                const bars = [];
                const volBars = [];
                for (const b of decoded) {
                    const t = csTimeToUtcSec(b.timeIso);
                    if (t == null || seen.has(t)) continue;
                    seen.add(t);
                    const { open, high, low, close } = b;
                    if (![open, high, low, close].every(Number.isFinite)) continue;
                    bars.push({ time: t, open, high, low, close });
                    volBars.push({
                        time: t,
                        value: Number(b.volume) || 0,
                        color: close >= open ? '#26a69a55' : '#ef535055'
                    });
                }
                bars.sort((a, b) => a.time - b.time);
                volBars.sort((a, b) => a.time - b.time);

                // A successful binary fetch that yields no usable bars (empty or
                // unparseable payload — the ES/ETH "99-byte" case) is treated as
                // a failure so we fall back to JSON, rather than seeding a blank
                // chart while wrongly reporting mode=binary. The binary path can
                // return 0 bars without throwing, so this guard is what actually
                // triggers the fallback for those markets.
                if (bars.length === 0) {
                    this.client.log?.(
                        `Binary chart returned no bars for ${marketId}; falling back to JSON`,
                        'warning'
                    );
                    return this._loadAndReplayJson(sub, marketId, token);
                }

                this._seedChartWithHistory(marketId, bars, volBars);
                this._decodeMode = 'binary';
                this._setOverlay(null);
            } catch (err) {
                if (token !== this._loadToken || this.activeMarketId !== marketId) return;
                // Binary failed for this market (e.g. server returned a non-binary
                // body, or the contract isn't served in T4Bin form). Don't leave
                // the chart empty — fall back to the JSON+calibration path so the
                // feed still loads. This explains why some markets (BTC) charted
                // while others (ES, ETH) went blank before the fallback existed.
                this.client.log?.(
                    `Binary chart load failed for ${marketId} (${err.message}); falling back to JSON`,
                    'warning'
                );
                return this._loadAndReplayJson(sub, marketId, token);
            }

            if (token !== this._loadToken || this.activeMarketId !== marketId) return;
            this._replayActive();
        }

        // Seeds the renderer with historical bars, broadcasts to features, and
        // primes the aggregator's forming bar. Shared by the JSON and binary
        // history-loading paths. `bars` items are { time, open, high, low, close }
        // and `volBars` items are { time, value, color }, both pre-sorted.
        _seedChartWithHistory(marketId, bars, volBars) {
            this._historyBars = bars;
            this._historyVolBars = volBars;
            this.renderer.candleSeries.setData(bars);
            this.renderer.volumeSeries.setData(volBars);
            // Continuous-chart mode: always zoom to the most recent day so the
            // first paint is snappy and the lazy history loader can fetch older
            // chunks as the user pans/drags left.
            this.renderer.focusRecentDay(bars);
            // Broadcast to features (indicators, drawings, markers, ...).
            this.bus.emit('bars:loaded', { marketId, bars, volume: volBars });
            for (const f of this._features.values()) {
                if (typeof f.onBars === 'function') {
                    try { f.onBars(bars); } catch (err) { console.error(`[ChartService] feature "${f.id}" onBars failed:`, err); }
                }
            }

            // Prime the aggregator's current bar with the last historical bar so
            // the next live tick mutates it instead of opening a new bucket with
            // a fresh open price.
            if (bars.length) {
                const last = bars[bars.length - 1];
                this.aggregator.current = {
                    time: last.time,
                    open: last.open,
                    high: last.high,
                    low: last.low,
                    close: last.close,
                    volume: volBars[volBars.length - 1].value
                };
            }
        }

        // Normalizes decoded T4Bin binary bars into chart + volume series rows.
        // Times -> UTC seconds, sorted, deduped. Prices are already scaled.
        _normalizeBinaryBars(decoded) {
            const seen = new Set();
            const bars = [];
            const volBars = [];
            for (const b of (decoded || [])) {
                const t = csTimeToUtcSec(b.timeIso);
                if (t == null || seen.has(t)) continue;
                seen.add(t);
                const { open, high, low, close } = b;
                if (![open, high, low, close].every(Number.isFinite)) continue;
                bars.push({ time: t, open, high, low, close });
                volBars.push({
                    time: t,
                    value: Number(b.volume) || 0,
                    color: close >= open ? '#26a69a55' : '#ef535055'
                });
            }
            bars.sort((a, b) => a.time - b.time);
            volBars.sort((a, b) => a.time - b.time);
            return { bars, volBars };
        }

        // Normalizes raw Chart API JSON bars using the supplied integer divisor.
        _normalizeJsonBars(rawBars, scale) {
            const seen = new Set();
            const bars = [];
            const volBars = [];
            for (const b of (rawBars || [])) {
                const t = csTimeToUtcSec(b.time);
                if (t == null || seen.has(t)) continue;
                seen.add(t);
                const open = Number(b.openPrice) / scale;
                const high = Number(b.highPrice) / scale;
                const low = Number(b.lowPrice) / scale;
                const close = Number(b.closePrice) / scale;
                if (![open, high, low, close].every(Number.isFinite)) continue;
                bars.push({ time: t, open, high, low, close });
                volBars.push({
                    time: t,
                    value: Number(b.volume) || 0,
                    color: close >= open ? '#26a69a55' : '#ef535055'
                });
            }
            bars.sort((a, b) => a.time - b.time);
            volBars.sort((a, b) => a.time - b.time);
            return { bars, volBars };
        }

        // Number of logical bars that make up the scroll look-ahead buffer at
        // the current interval. `range.from` from the visible-logical-range
        // callback is measured in bars from the oldest loaded bar, so when it
        // drops below this value the user has scrolled into the buffer and the
        // next older chunk should be fetched. Floored so very coarse intervals
        // (e.g. daily bars) still trigger with a sensible margin.
        _scrollBufferBars() {
            const barsPerDay = 86_400_000 / this.intervalMs;
            return Math.max(20, Math.ceil(barsPerDay * SCROLL_BUFFER_DAYS));
        }

        // Lazily fetches an older slice of history and prepends it. Triggered as
        // the user scrolls toward the left (oldest) edge. Walks back in chunks,
        // skipping empty weekend/holiday windows, until it finds bars or reaches
        // the earliest available data. Lightweight Charts keeps the visible time
        // range stable across setData, so the user's scroll position is preserved.
        async _loadOlderHistory() {
            if (this._loadingOlder || this._noMoreHistory) return;
            const marketId = this.activeMarketId;
            if (!marketId) return;
            if (!Array.isArray(this._historyBars) || !this._historyBars.length) return;
            if (!this._historyWindowStart) return;
            const sub = this.client.currentSubscription;
            if (!sub || sub.marketId !== marketId) return;

            this._loadingOlder = true;
            const token = this._loadToken; // tie to current market/interval load
            // Respect the decode path the initial load actually used for this
            // market. If binary failed and we fell back to JSON, older chunks
            // must use JSON too (otherwise every chunk would retry/fail binary).
            const useBinary = this._decodeMode === 'binary' && typeof this.client.getBarChartBinary === 'function';
            if (!useBinary && typeof this.client.getBarChart !== 'function') {
                this._loadingOlder = false;
                return;
            }
            const spec = intervalMsToBarSpec(this.intervalMs);
            const chunkMs = CHUNK_DAYS * 86_400_000;
            const floorMs = new Date(HISTORY_FLOOR_START).getTime();

            try {
                let end = this._historyWindowStart;
                let newBars = [];
                let newVol = [];
                let consecutiveFailures = 0;

                // Step back chunk-by-chunk until we collect bars or hit the floor.
                // Re-arm at the end keeps continuing past this cap if the user is
                // still near the left edge.
                for (let attempt = 0; attempt < 14 && newBars.length === 0; attempt++) {
                    const startMs = Math.max(end.getTime() - chunkMs, floorMs);
                    const start = new Date(startMs);
                    if (startMs >= end.getTime()) { this._noMoreHistory = true; break; }

                    let norm;
                    let chunkFailed = false;
                    if (useBinary) {
                        try {
                            const decoded = await this.client.getBarChartBinary(
                                sub.exchangeId, sub.contractId, marketId,
                                {
                                    barInterval: spec.barInterval,
                                    barPeriod: spec.barPeriod,
                                    tradeDateStart: formatNoTz(start),
                                    tradeDateEnd: formatNoTz(end),
                                    // Older windows may never warm the binary
                                    // cache; fail-fast so we fall back to JSON
                                    // and keep the gesture responsive instead
                                    // of blocking ~14s per chunk on retries.
                                    maxAttempts: 2
                                }
                            );
                            norm = this._normalizeBinaryBars(decoded);
                        } catch (binErr) {
                            // Per-chunk JSON fallback: binary may stay cold for
                            // an older window even after the initial load was
                            // warm. Fetch this single chunk as JSON so the
                            // older-history walk keeps making progress instead
                            // of dying with a loud "Older history load failed".
                            if (token !== this._loadToken || this.activeMarketId !== marketId) return;
                            try {
                                const data = await this.client.getBarChart(
                                    sub.exchangeId, sub.contractId, marketId,
                                    {
                                        barInterval: spec.barInterval,
                                        barPeriod: spec.barPeriod,
                                        tradeDateStart: formatNoTz(start),
                                        tradeDateEnd: formatNoTz(end)
                                    }
                                );
                                const scale = this._historyScale ?? Math.pow(10, this.knownDecimals ?? 2);
                                norm = this._normalizeJsonBars(Array.isArray(data?.bars) ? data.bars : [], scale);
                            } catch (jsonErr) {
                                // Both paths failed for this chunk; skip it and
                                // try the next older window so a single transient
                                // error doesn't abort the whole pan gesture.
                                this.client.log?.(
                                    `Older history chunk failed for ${marketId} (binary: ${binErr.message}; json: ${jsonErr.message})`,
                                    'warning'
                                );
                                chunkFailed = true;
                            }
                        }
                    } else {
                        try {
                            const data = await this.client.getBarChart(
                                sub.exchangeId, sub.contractId, marketId,
                                {
                                    barInterval: spec.barInterval,
                                    barPeriod: spec.barPeriod,
                                    tradeDateStart: formatNoTz(start),
                                    tradeDateEnd: formatNoTz(end)
                                }
                            );
                            const scale = this._historyScale ?? Math.pow(10, this.knownDecimals ?? 2);
                            norm = this._normalizeJsonBars(Array.isArray(data?.bars) ? data.bars : [], scale);
                        } catch (jsonErr) {
                            this.client.log?.(
                                `Older history chunk failed for ${marketId} (json: ${jsonErr.message})`,
                                'warning'
                            );
                            chunkFailed = true;
                        }
                    }

                    // Race guard: market/interval changed while awaiting.
                    if (token !== this._loadToken || this.activeMarketId !== marketId) return;

                    if (chunkFailed) {
                        consecutiveFailures++;
                        if (consecutiveFailures >= 3) break; // give up this gesture
                        end = start;
                        if (startMs <= floorMs) break;
                        continue;
                    }
                    consecutiveFailures = 0;

                    // Keep only bars strictly older than what we already have.
                    const oldest = this._historyBars[0].time;
                    newBars = norm.bars.filter((b) => b.time < oldest);
                    newVol = norm.volBars.filter((b) => b.time < oldest);

                    this._historyWindowStart = start;
                    end = start;
                    if (startMs <= floorMs) {
                        if (newBars.length === 0) this._noMoreHistory = true;
                        break;
                    }
                }

                if (newBars.length) {
                    // Older segment is fully before the existing set, so a plain
                    // concat preserves ascending time order (no re-sort needed).
                    const mergedBars = newBars.concat(this._historyBars);
                    const mergedVol = newVol.concat(this._historyVolBars || []);
                    this._historyBars = mergedBars;
                    this._historyVolBars = mergedVol;
                    this.renderer.candleSeries.setData(mergedBars);
                    this.renderer.volumeSeries.setData(mergedVol);
                    this._decodeMode = useBinary ? 'binary' : 'json';
                    this.client.log?.(
                        `Loaded older history (${this._decodeMode}): ${newBars.length} bars (dragged into view) for ${marketId}`,
                        'info'
                    );
                    // Rebroadcast the full set so indicators/features recompute.
                    this.bus.emit('bars:loaded', { marketId, bars: mergedBars, volume: mergedVol });
                    for (const f of this._features.values()) {
                        if (typeof f.onBars === 'function') {
                            try { f.onBars(mergedBars); } catch (err) { console.error(`[ChartService] feature "${f.id}" onBars failed:`, err); }
                        }
                    }
                }
            } catch (err) {
                this.client.log?.(`Older history load failed: ${err.message}`, 'warning');
            } finally {
                this._loadingOlder = false;
                // Self re-arm: a single drag fires the visible-range callback
                // many times but only the first wins (the rest early-return
                // because _loadingOlder=true). Without this re-check the loader
                // pulls one chunk per gesture and stops, even if the user is
                // still pinned at the left edge. Re-trigger on the next frame
                // so the renderer can settle before we look at the range.
                this._scheduleOlderHistoryRearm();
            }
        }

        // Re-checks the left-edge condition after an older-history load and
        // kicks off another fetch if the user is still pinned near the edge
        // (or the chart is so zoomed-out that the new prepended bars still
        // leave from<threshold). Guards against infinite scheduling via the
        // standard _loadingOlder / _noMoreHistory flags inside the loader.
        _scheduleOlderHistoryRearm() {
            if (this._noMoreHistory) return;
            if (this._rearmHandle) return;
            const schedule = global.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            this._rearmHandle = schedule(() => {
                this._rearmHandle = 0;
                if (this._loadingOlder || this._noMoreHistory) return;
                const ts = this.renderer?.chart?.timeScale?.();
                const range = ts && ts.getVisibleLogicalRange && ts.getVisibleLogicalRange();
                if (range && range.from < this._scrollBufferBars()) this._loadOlderHistory();
            });
        }

        _setOverlay(text) {
            if (!this.overlayEl) return;
            if (text == null) {
                this.overlayEl.style.display = 'none';
            } else {
                this.overlayEl.textContent = text;
                this.overlayEl.style.display = 'flex';
            }
        }

        // Returns the price of the most recent live tick stored for the given
        // market, or null if none. Live tick prices are already display-scaled
        // so they're a reliable yardstick for calibrating the Chart API divisor.
        _latestLivePrice(marketId) {
            const slot = this.store.byMarket.get(marketId);
            if (!slot || slot.size === 0) return null;
            // Walk newest-to-oldest.
            const cap = this.store.capacity;
            for (let i = 0; i < slot.size; i++) {
                const idx = (slot.head - 1 - i + cap) % cap;
                const tick = slot.buf[idx];
                if (tick && Number.isFinite(tick.price) && tick.price > 0) return tick.price;
            }
            return null;
        }

        // Resolves with the T4Bin decoder API once `window.T4ChartDecoder`
        // appears (set by decoder/loader.js after the ES module finishes
        // evaluating), or null on timeout. Listens for the `t4-decoder-ready`
        // event for low-latency wake-up and also polls as a fallback.
        _waitForDecoder(timeoutMs = 2000) {
            if (global.T4ChartDecoder) return Promise.resolve(global.T4ChartDecoder);
            if (global.T4ChartDecoderError) return Promise.resolve(null);
            return new Promise((resolve) => {
                let settled = false;
                const finish = (val) => {
                    if (settled) return;
                    settled = true;
                    global.removeEventListener?.('t4-decoder-ready', onReady);
                    global.removeEventListener?.('t4-decoder-error', onError);
                    clearTimeout(timer);
                    resolve(val);
                };
                const onReady = () => finish(global.T4ChartDecoder || null);
                const onError = () => finish(null);
                global.addEventListener?.('t4-decoder-ready', onReady, { once: true });
                global.addEventListener?.('t4-decoder-error', onError, { once: true });
                const timer = setTimeout(() => finish(global.T4ChartDecoder || null), timeoutMs);
            });
        }

        // Polls getMarketDetails() until it returns a value or timeoutMs elapses.
        // Returns true if details became available, false on timeout.
        _waitForMarketDetails(marketId, timeoutMs = 5000, stepMs = 100) {
            return new Promise((resolve) => {
                const deadline = Date.now() + timeoutMs;
                const tick = () => {
                    if (this.activeMarketId !== marketId) return resolve(false);
                    if (this.client.getMarketDetails(marketId)) {
                        this._refreshDecimals();
                        return resolve(true);
                    }
                    if (Date.now() >= deadline) return resolve(false);
                    setTimeout(tick, stepMs);
                };
                tick();
            });
        }

        // Waits for at least one live tick on the given market so the Chart API
        // divisor can be calibrated against a known display price. Resolves
        // true as soon as a live price is available (an already-buffered tick
        // counts), false on timeout or market switch.
        _waitForLiveTick(marketId, timeoutMs = 15000, stepMs = 100) {
            return new Promise((resolve) => {
                if (this._latestLivePrice(marketId) != null) return resolve(true);
                const deadline = Date.now() + timeoutMs;
                const poll = () => {
                    if (this.activeMarketId !== marketId) return resolve(false);
                    if (this._latestLivePrice(marketId) != null) return resolve(true);
                    if (Date.now() >= deadline) return resolve(false);
                    setTimeout(poll, stepMs);
                };
                poll();
            });
        }

        _onTrade(tick) {
            // Follow the client's currently subscribed market.
            const current = this.client.currentMarketId;
            if (current && current !== this.activeMarketId) {
                this._switchMarket(current);
            }

            // If price decimals weren't known at emit time, refine them now.
            if (!tick.scaled) {
                const details = this.client.getMarketDetails(tick.marketId);
                if (details) {
                    const pf = this.client.config?.priceFormat ?? 0;
                    const d = (pf === 0 ? details.decimals : details.realDecimals) ?? 2;
                    tick = { ...tick, priceDecimals: d, scaled: true };
                }
                // price is already correct regardless; only label precision may
                // refine once marketDetails arrive. No buffering needed.
            }

            this.store.push(tick);

            if (tick.marketId !== this.activeMarketId) return;

            if (tick.priceDecimals && tick.priceDecimals !== this.knownDecimals) {
                this.knownDecimals = tick.priceDecimals;
                this.renderer.setPriceDecimals(tick.priceDecimals);
            }

            // Flush anything that was waiting on marketDetails.
            if (this.pendingTicks.length) {
                const pending = this.pendingTicks;
                this.pendingTicks = [];
                for (const p of pending) this._onTrade(p);
            }

            this.aggregator.addTick(tick);
            this._setOverlay(null);
        }

        // ---------- Live-trading overlays ----------------------------------
        // Public passthroughs that delegate to the OrderLines / PositionLine
        // feature modules. Kept on the host so existing UI code doesn't change.
        setWorkingOrders(orders) {
            const f = this._features.get('order-lines');
            if (f) f.setOrders(orders);
        }

        // Last live price for the active market, or null. Used by features that
        // need a reference price when an order has none (market orders).
        getLastPrice() {
            return this.activeMarketId ? this._latestLivePrice(this.activeMarketId) : null;
        }

        setPositionLine(avgPrice, net) {
            const f = this._features.get('position-line');
            if (f) f.set(avgPrice, net);
        }

        // Draws a "working position" line for a position that has working
        // orders but no net filled position. `price` is the volume-weighted
        // price of the working orders. Pass price=null or wb+ws=0 to clear it.
        setWorkingPosition(price, workingBuys, workingSells) {
            const f = this._features.get('position-line');
            if (f) f.setWorking(price, workingBuys, workingSells);
        }

        clearOverlays() {
            const ol = this._features.get('order-lines');
            if (ol) ol.clear();
            const pl = this._features.get('position-line');
            if (pl) pl.clear();
        }

        _onChartClick(param) {
            if (!param || !param.point) return;
            const y = param.point.y;
            const series = this.renderer.candleSeries;

            // Hit-test order lines first via the feature.
            const ol = this._features.get('order-lines');
            if (ol) {
                const id = ol.hitTest(y, this._hitTestPx);
                if (id) {
                    if (this.onOrderLineClick) {
                        try { this.onOrderLineClick(id); } catch (_) { /* swallow */ }
                    }
                    return;
                }
            }

            const rawPrice = series.coordinateToPrice(y);
            if (rawPrice == null || !Number.isFinite(rawPrice)) return;
            const price = this._snapToTick(rawPrice);

            // If a drawing tool is active, the click is consumed by it instead
            // of falling through to quick-trade / form prefill.
            const drw = this._features.get('drawings');
            if (drw && drw.handleClick({ time: param.time, price })) return;

            if (!this.onPriceLevelClick) return;
            try { this.onPriceLevelClick(price, param.point); } catch (_) { /* swallow */ }
        }

        // Snap a price to the active market's minPriceIncrement (tick size).
        // Falls back to knownDecimals when the tick isn't available. This is
        // critical for quick-trade orders: exchanges reject prices that aren't
        // aligned to the contract's tick.
        _snapToTick(rawPrice) {
            const details = this.activeMarketId ? this.client.getMarketDetails(this.activeMarketId) : null;
            const tickRaw = details?.minPriceIncrement?.value;
            const tick = tickRaw != null ? Number(tickRaw) : NaN;
            if (Number.isFinite(tick) && tick > 0) {
                const decimals = this.knownDecimals || 0;
                const snapped = Math.round(rawPrice / tick) * tick;
                // Round to decimals to kill float dust (e.g. 5800.2499999999996).
                const factor = Math.pow(10, decimals);
                return Math.round(snapped * factor) / factor;
            }
            const factor = Math.pow(10, this.knownDecimals || 0);
            return Math.round(rawPrice * factor) / factor;
        }
    }

    global.ChartService = ChartService;
    global.ChartService._internals = { TickStore, CandleAggregator, ChartRenderer, csTimeToUtcSec };
})(window);
