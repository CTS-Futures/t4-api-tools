/**
 * chart/features/OrderLines.js
 *
 * Feature module: draws a horizontal price line on the candle series for each
 * working order in the active market. Click hit-testing for order lines is
 * also owned here so the host doesn't need to know about line geometry.
 *
 * Feature contract:
 *   id              : string
 *   attach(ctx)     : { chart, candleSeries, bus, host }  -> void
 *   detach()        : remove all series/lines, drop subscriptions
 *
 * Public methods (called by the host via host.getFeature('order-lines')):
 *   setOrders(orders)  : diff & sync price lines
 *   hitTest(yPx)       : returns uniqueId | null for a click at pixel y
 *   clear()            : remove all lines
 */
(function (global) {
    'use strict';

    // Coerce a protobuf price/decimal field into a JS number. The wire shapes
    // we've seen include: plain number, numeric string, Long ({low,high}),
    // Decimal wrapper { value: "4250.00" }, doubly-wrapped { value: { value: "..." } },
    // and the occasional .toString()-able object. Returns NaN when no usable
    // numeric value is found, so callers can skip "no-price" orders cleanly.
    function coercePrice(v, depth) {
        if (v == null) return NaN;
        if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'string') {
            if (v === '') return NaN;
            const n = Number(v);
            return Number.isFinite(n) ? n : NaN;
        }
        if (typeof v === 'object') {
            const d = (depth | 0);
            if (d > 4) return NaN; // bail on deep recursion
            // Common nested-wrapper paths first.
            if ('value' in v) {
                const n = coercePrice(v.value, d + 1);
                if (Number.isFinite(n)) return n;
            }
            if ('amount' in v) {
                const n = coercePrice(v.amount, d + 1);
                if (Number.isFinite(n)) return n;
            }
            // protobuf.js Long fallback ({low, high}). Treat as signed 64-bit.
            if ('low' in v && 'high' in v) {
                const low = v.low >>> 0;
                const high = v.high | 0;
                return high * 0x100000000 + low;
            }
            // Last-ditch: toString() (e.g. Decimal.js).
            if (typeof v.toString === 'function') {
                const s = v.toString();
                if (s && s !== '[object Object]') {
                    const n = Number(s);
                    if (Number.isFinite(n)) return n;
                }
            }
        }
        return NaN;
    }

    // First non-zero, finite price across the limit/stop fields. Mirrors the
    // priority used elsewhere (current* fields win over the original ones).
    function orderTriggerPrice(o) {
        const candidates = [
            o.currentStopPrice,
            o.currentLimitPrice,
            o.stopPrice,
            o.limitPrice
        ];
        for (const c of candidates) {
            const n = coercePrice(c, 0);
            if (Number.isFinite(n) && n !== 0) return n;
        }
        return NaN;
    }

    // True if the working order has a stop price set; covers both stop-market
    // and stop-limit. We don't try to distinguish those in the label because
    // the trigger line price is the same.
    function isStopOrder(o) {
        const n = coercePrice(o.currentStopPrice ?? o.stopPrice, 0);
        return Number.isFinite(n) && n !== 0;
    }

    function formatPrice(p, decimals) {
        const d = Number.isFinite(decimals) ? decimals : 2;
        return Number(p).toFixed(d);
    }

    class OrderLinesFeature {
        constructor() {
            this.id = 'order-lines';
            this._lines = new Map(); // uniqueId -> { line, price, side, volume, type } (currently DRAWN)
            this._specs = new Map(); // uniqueId -> render spec for ALL working/held orders
            this._series = null;
            this._host = null;
            this._unsubSymbol = null;
            this._hiddenCount = 0;
        }

        attach(ctx) {
            this._series = ctx.candleSeries;
            this._host = ctx.host;
            // Clear lines whenever the symbol changes.
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => this.clear());
        }

        detach() {
            this.clear();
            if (this._unsubSymbol) this._unsubSymbol();
            this._series = null;
            this._host = null;
        }

        setOrders(orders) {
            if (!this._series) return;
            const decimals = this._host?.knownDecimals ?? 2;

            // Build render-ready specs for every working/held order. Drawing is
            // deferred to _render() so we can cap the count to the nearest few.
            this._specs.clear();
            for (const o of (orders || [])) {
                if (!o || !o.uniqueId) continue;
                let price = orderTriggerPrice(o);
                // Market orders have no trigger price; we anchor them at the last
                // price (resolved live in _render so the marker tracks the tape).
                const isMarket = !Number.isFinite(price);
                if (isMarket) price = NaN;

                const side = o.buySell === 1 ? 'B' : 'S';
                const volume = Number(o.currentVolume ?? o.volume ?? 0);
                const type = isMarket ? 'Market' : (isStopOrder(o) ? 'Stop' : 'Limit');
                const color = o.buySell === 1 ? '#26a69a' : '#ef5350';

                this._specs.set(o.uniqueId, { price, side, volume, type, color, isMarket, decimals });
            }

            this._render();
        }

        // Resolve the price a spec should draw at: market orders track the last
        // price; everything else uses its stored trigger price.
        _effectivePrice(spec) {
            if (!spec) return NaN;
            if (spec.isMarket) {
                const last = typeof this._host?.getLastPrice === 'function'
                    ? this._host.getLastPrice()
                    : null;
                return Number.isFinite(last) ? Number(last) : NaN;
            }
            return spec.price;
        }

        // Pick the nearest `_maxVisible` orders to the last price and sync the
        // drawn price lines to exactly that set. Called on order changes and on
        // each bar update so the visible window follows the market.
        _render() {
            const series = this._series;
            if (!series) return;
            const LS = global.LightweightCharts?.LineStyle;
            const dashed = LS?.Dashed ?? 2;

            // Resolve drawable orders. Every working order gets its own line —
            // no cap, no sort, no dependency on a live "last price" (the market
            // anchor for market orders is still resolved when available).
            const drawable = [];
            for (const [id, spec] of this._specs) {
                const price = this._effectivePrice(spec);
                if (!Number.isFinite(price)) continue;
                drawable.push({ id, spec, price });
            }

            const visibleIds = new Set(drawable.map(v => v.id));
            this._hiddenCount = 0;

            // Drop lines whose order is gone (filled / cancelled / unpriced).
            for (const [id, entry] of this._lines) {
                if (!visibleIds.has(id)) {
                    try { series.removePriceLine(entry.line); } catch (_) { /* gone */ }
                    this._lines.delete(id);
                }
            }

            // Create or update one dashed line per working order.
            for (const { id, spec, price } of drawable) {
                const title = spec.isMarket
                    ? `${spec.side} ${spec.volume} Market`
                    : `${spec.side} ${spec.volume} ${spec.type} @ ${formatPrice(price, spec.decimals)}`;
                const existing = this._lines.get(id);
                if (existing) {
                    if (existing.price !== price || existing.volume !== spec.volume || existing.side !== spec.side || existing.type !== spec.type) {
                        existing.line.applyOptions({ price, title, color: spec.color });
                        existing.price = price;
                        existing.volume = spec.volume;
                        existing.side = spec.side;
                        existing.type = spec.type;
                    }
                } else {
                    try {
                        const line = series.createPriceLine({
                            price,
                            color: spec.color,
                            lineWidth: 1,
                            lineStyle: dashed,
                            axisLabelVisible: true,
                            title
                        });
                        this._lines.set(id, { line, price, side: spec.side, volume: spec.volume, type: spec.type });
                    } catch (err) {
                        console.error('[OrderLines] createPriceLine failed', { id, price, title, spec }, err);
                    }
                }
            }
        }

        // Market-order anchor tracks the last price; re-render to keep it in sync.
        onBarUpdate() {
            // Only matters when there's a market order in the working set.
            for (const spec of this._specs.values()) {
                if (spec.isMarket) { this._render(); return; }
            }
        }

        // Overflow info for the host UI. No cap is applied anymore, so hidden
        // is always 0; kept for API compatibility with the host's "+N more" note.
        getOverflow() {
            const shown = this._lines.size;
            return { shown, hidden: 0, total: shown };
        }

        hitTest(yPx, tolPx = 6) {
            if (!this._series) return null;
            for (const [id, entry] of this._lines) {
                const lineY = this._series.priceToCoordinate(entry.price);
                if (lineY != null && Math.abs(lineY - yPx) <= tolPx) return id;
            }
            return null;
        }

        clear() {
            this._specs.clear();
            this._hiddenCount = 0;
            if (!this._series) {
                this._lines.clear();
                return;
            }
            for (const entry of this._lines.values()) {
                try { this._series.removePriceLine(entry.line); } catch (_) { /* gone */ }
            }
            this._lines.clear();
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.OrderLines = OrderLinesFeature;
})(window);
