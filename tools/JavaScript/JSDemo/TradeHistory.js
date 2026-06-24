/**
 * TradeHistory.js
 *
 * Tabbed trade panel with two views:
 *   • My Fills      — the session's executed fills (own trades), rich detail.
 *   • Market Trades — the public Time & Sales tape for the charted contract.
 *
 * Data sources (two independent feeds):
 *   • My Fills:      T4APIClient pushes each fill onto client.fills and calls
 *                    client.onFillsUpdate(fills). Independent of client.onFill
 *                    (which the chart's FillMarkers owns).
 *   • Market Trades: client.onTrade (T4APIClient._emitTradeTick) — the same tick
 *                    stream the chart consumes. We CHAIN it (save prior, call it,
 *                    then buffer) so the chart/algo chain stays intact. The tape
 *                    only has Time/Price/Volume; aggressor Side is *inferred*
 *                    (quote rule vs best bid/offer, tick-rule fallback) and is
 *                    therefore approximate.
 *
 * Scope: live-session only — T4 has no historical backfill on connect. The tape
 * is per-contract (the currently subscribed market) and resets on contract
 * change. Busy markets emit hundreds of prints/sec, so the tape buffers cheaply
 * on every tick and only renders (throttled) while its tab is visible.
 *
 * Wiring (host glue in index.html):
 *   new TradeHistory({ host, client, log, onOrderClick });
 */
(function (global) {
    'use strict';

    const TAPE_CAP = 200;
    const TAPE_RENDER_MS = 250;

    // ---- Defensive extraction (mirrors chart/features/FillMarkers.js) --------
    // Proto field names for the matched price/volume vary by exchange; probe in
    // order. Scale a raw-integer price down by the market's decimals.

    function extractPrice(fill, decimals) {
        const raw = fill.raw || {};
        const candidates = [
            raw.tradePrice?.value, raw.tradePrice,
            raw.matchedPrice?.value, raw.matchedPrice,
            raw.price?.value, raw.price,
            raw.currentLimitPrice?.value
        ];
        for (const c of candidates) {
            const n = Number(c);
            if (!Number.isFinite(n) || n <= 0) continue;
            if (decimals > 0 && Number.isInteger(n) && n >= Math.pow(10, decimals)) {
                return n / Math.pow(10, decimals);
            }
            return n;
        }
        return null;
    }

    function extractVolume(fill) {
        const raw = fill.raw || {};
        const candidates = [raw.tradeVolume, raw.matchedVolume, raw.volume, raw.fillVolume];
        for (const c of candidates) {
            const n = Number(c?.value ?? c);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return null;
    }

    // Parse a fill timestamp into UTC epoch seconds. Handles protobuf Timestamp
    // {seconds,nanos}, ms/sec numbers, and CST wall-clock ISO strings.
    function parseFillTimeSec(fill) {
        const candidates = [fill.time, fill.raw?.time, fill.raw?.exchangeTime];
        for (const c of candidates) {
            if (c == null) continue;
            if (typeof c === 'object' && c.seconds != null) {
                const s = Number(c.seconds);
                if (Number.isFinite(s) && s > 0) return Math.floor(s);
            }
            if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
                return c > 1e12 ? Math.floor(c / 1000) : Math.floor(c);
            }
            if (typeof c === 'string') {
                const fn = global.ChartService?._internals?.csTimeToUtcSec || global.csTimeToUtcSec;
                if (typeof fn === 'function') {
                    const sec = fn(c);
                    if (Number.isFinite(sec)) return sec;
                }
                const ms = Date.parse(c);
                if (Number.isFinite(ms)) return Math.floor(ms / 1000);
            }
        }
        return null;
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    // Render a single raw-message value into a readable string for the detail
    // dump. Skips empties; collapses {value} wrappers, Timestamps, and Longs.
    function fmtDetailValue(v) {
        if (v == null || v === '') return null;
        if (typeof v !== 'object') return String(v);
        if ('value' in v && Object.keys(v).length <= 2) {
            return v.value == null || v.value === '' ? null : String(v.value);
        }
        if (v.seconds != null) {
            const s = Number(v.seconds);
            if (Number.isFinite(s) && s > 0) return new Date(s * 1000).toLocaleString();
        }
        if ('low' in v && 'high' in v && Object.keys(v).length <= 3) {
            const low = v.low >>> 0, high = v.high >>> 0;
            return high === 0 ? String(low) : String(high * 0x100000000 + low);
        }
        try {
            const json = JSON.stringify(v);
            if (!json || json === '{}' || json === '[]') return null;
            return json.length > 200 ? json.slice(0, 200) + '…' : json;
        } catch (_) {
            return null;
        }
    }

    function sideText(side) {
        return side === 'buy' ? '▲ Buy' : side === 'sell' ? '▼ Sell' : '-';
    }
    function sideClass(side) {
        return side === 'buy' ? 'positive-pnl' : side === 'sell' ? 'negative-pnl' : '';
    }

    class TradeHistory {
        constructor({ host, client, log, onOrderClick } = {}) {
            this.host = host;
            this.client = client;
            this.log = log || (() => {});
            this.onOrderClick = onOrderClick || (() => {});

            this._activeTab = 'market';                      // 'fills' | 'market'
            this._filterAccount = client?.selectedAccount || 'all';
            this._expanded = new Set();                      // fill refs expanded in My Fills

            // Market Trades tape (current contract only).
            this._tape = [];
            this._tapeKey = null;                            // String(marketId) of buffered contract
            this._tapeMarketId = null;                       // raw marketId for detail/label lookups
            this._lastTapePrice = null;
            this._lastTapeSide = null;
            this._tapeRenderScheduled = false;

            this._build();

            if (client) {
                // Fills feed (independent callback).
                client.onFillsUpdate = () => { if (this._activeTab === 'fills') this._renderFills(); };
                // Market tape feed — CHAIN onTrade so we don't clobber the chart.
                const prior = client.onTrade;
                client.onTrade = (tick) => {
                    if (typeof prior === 'function') prior(tick);
                    this._onMarketTrade(tick);
                };
                this.render();
            }
        }

        _build() {
            this.host.innerHTML = `
                <div class="th-tabs">
                    <button type="button" class="th-tab active" data-tab="market">Market Trades</button>
                    <button type="button" class="th-tab" data-tab="fills">My Fills</button>
                </div>
                <div class="th-toolbar">
                    <div class="th-summary" id="thSummary"></div>
                    <div class="th-controls">
                        <label class="th-filter-label" id="thFilterWrap">Account:
                            <select class="th-filter" id="thAccountFilter"></select>
                        </label>
                        <button type="button" class="th-clear-btn" id="thClearBtn">Clear</button>
                    </div>
                </div>
                <div class="th-scroll">
                    <table class="th-table" id="thTable">
                        <thead id="thHead"></thead>
                        <tbody></tbody>
                    </table>
                </div>`;

            this._summaryEl = this.host.querySelector('#thSummary');
            this._filterWrapEl = this.host.querySelector('#thFilterWrap');
            this._filterEl = this.host.querySelector('#thAccountFilter');
            this._headEl = this.host.querySelector('#thHead');
            this._tbodyEl = this.host.querySelector('#thTable tbody');

            this.host.querySelectorAll('.th-tab').forEach(btn => {
                btn.addEventListener('click', () => this._setTab(btn.dataset.tab));
            });
            this._filterEl.addEventListener('change', () => {
                this._filterAccount = this._filterEl.value;
                this._renderFills();
            });
            this.host.querySelector('#thClearBtn').addEventListener('click', () => {
                if (this._activeTab === 'fills') {
                    if (this.client?.fills) this.client.fills.length = 0;
                    this._expanded.clear();
                    this.log('Trade history cleared', 'info');
                } else {
                    this._tape.length = 0;
                    this._lastTapePrice = null;
                    this._lastTapeSide = null;
                    this.log('Market tape cleared', 'info');
                }
                this.render();
            });
        }

        _setTab(tab) {
            if (tab === this._activeTab) return;
            this._activeTab = tab;
            this.host.querySelectorAll('.th-tab').forEach(b =>
                b.classList.toggle('active', b.dataset.tab === tab));
            this.render();
        }

        render() {
            if (this._activeTab === 'fills') this._renderFills();
            else this._renderMarket();
        }

        // ---- shared helpers --------------------------------------------------

        _decimalsFor(marketId) {
            const md = this.client?.getMarketDetails?.(marketId);
            if (!md) return 2;
            const d = (this.client?.config?.priceFormat === 0) ? md.decimals : md.realDecimals;
            return Number.isFinite(Number(d)) ? Number(d) : 2;
        }

        _marketLabel(marketId) {
            const md = this.client?.getMarketDetails?.(marketId);
            return (md && (md.contractId || md.description)) || marketId;
        }

        _accountLabel(accountId) {
            const info = this.client?.accounts?.get(accountId);
            return info ? (info.accountName || info.displayName || accountId) : accountId;
        }

        // ===================== My Fills view =================================

        _syncFilterOptions() {
            const accounts = this.client?.accounts ? Array.from(this.client.accounts.values()) : [];
            const opts = ['<option value="all">All accounts</option>'];
            for (const a of accounts) {
                const id = a.accountId;
                const name = a.accountName || a.displayName || id;
                opts.push(`<option value="${esc(id)}">${esc(name)}</option>`);
            }
            const prev = this._filterAccount;
            this._filterEl.innerHTML = opts.join('');
            const hasPrev = prev === 'all' || accounts.some(a => a.accountId === prev);
            this._filterEl.value = hasPrev ? prev : 'all';
            this._filterAccount = this._filterEl.value;
        }

        _renderFills() {
            this._filterWrapEl.style.display = '';
            this._headEl.innerHTML = `
                <tr>
                    <th class="th-expander-col"></th>
                    <th>Time</th><th>Market</th><th>Side</th><th>Qty</th><th>Price</th><th>Order</th>
                </tr>`;
            this._syncFilterOptions();

            const all = Array.isArray(this.client?.fills) ? this.client.fills : [];
            const filtered = this._filterAccount === 'all'
                ? all
                : all.filter(f => f.accountId === this._filterAccount);

            let lots = 0, buys = 0, sells = 0;
            for (const f of filtered) {
                const v = extractVolume(f) || 0;
                lots += v;
                if (f.side === 1) buys += v;
                else if (f.side === -1) sells += v;
            }
            const net = buys - sells;
            this._summaryEl.textContent = filtered.length
                ? `${filtered.length} trade${filtered.length === 1 ? '' : 's'} · ${lots} lot${lots === 1 ? '' : 's'} · ${buys} buy / ${sells} sell · net ${net > 0 ? '+' : ''}${net}`
                : 'No trades yet this session';

            const rows = filtered.slice().reverse();
            this._tbodyEl.innerHTML = '';

            for (const fill of rows) {
                const decimals = this._decimalsFor(fill.marketId);
                const price = extractPrice(fill, decimals);
                const volume = extractVolume(fill);
                const sec = parseFillTimeSec(fill);
                const timeText = sec != null ? new Date(sec * 1000).toLocaleTimeString() : '-';
                const sText = fill.side === 1 ? 'BUY' : fill.side === -1 ? 'SELL' : '-';
                const sClass = fill.side === 1 ? 'positive-pnl' : fill.side === -1 ? 'negative-pnl' : '';
                const priceText = Number.isFinite(price) ? price.toFixed(decimals) : '-';
                const uid = fill.uniqueId != null ? String(fill.uniqueId) : '';
                const uidShort = uid.length > 8 ? uid.slice(0, 8) + '…' : uid;
                const expanded = this._expanded.has(fill);

                const tr = document.createElement('tr');
                tr.className = 'th-row';
                tr.innerHTML = `
                    <td class="th-expander-col"><span class="th-expander">${expanded ? '▾' : '▸'}</span></td>
                    <td>${esc(timeText)}</td>
                    <td>${esc(this._marketLabel(fill.marketId))}</td>
                    <td class="${sClass}">${sText}</td>
                    <td>${volume != null ? volume : '-'}</td>
                    <td>${esc(priceText)}</td>
                    <td>${uid ? `<button type="button" class="th-order-link" title="Open order ${esc(uid)}">${esc(uidShort)} ↗</button>` : '-'}</td>`;

                tr.querySelector('.th-expander-col').addEventListener('click', () => {
                    if (this._expanded.has(fill)) this._expanded.delete(fill);
                    else this._expanded.add(fill);
                    this._renderFills();
                });
                const link = tr.querySelector('.th-order-link');
                if (link) {
                    link.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.onOrderClick(fill.uniqueId);
                    });
                }
                this._tbodyEl.appendChild(tr);

                if (expanded) {
                    const detail = document.createElement('tr');
                    detail.className = 'th-detail-row';
                    detail.innerHTML = `<td colspan="7"><div class="th-detail">${this._detailHtml(fill)}</div></td>`;
                    this._tbodyEl.appendChild(detail);
                }
            }
        }

        _detailHtml(fill) {
            const raw = fill.raw || {};
            const pairs = [['account', this._accountLabel(fill.accountId)]];
            for (const key of Object.keys(raw)) {
                const val = fmtDetailValue(raw[key]);
                if (val != null) pairs.push([key, val]);
            }
            return pairs
                .map(([k, v]) => `<div class="th-kv"><span class="th-k">${esc(k)}</span><span class="th-v">${esc(v)}</span></div>`)
                .join('');
        }

        // ===================== Market Trades view ============================

        // Infer aggressor side: quote rule (vs best bid/offer) first, tick rule
        // (vs previous print) as fallback. Approximate — T4 doesn't send side.
        _inferSide(marketId, price) {
            const snap = this.client?.getMarketSnapshot?.(marketId);
            const bestBid = Number(snap?.bids?.[0]?.price?.value);
            const bestOffer = Number(snap?.offers?.[0]?.price?.value);
            let side = null;
            if (Number.isFinite(bestOffer) && price >= bestOffer) side = 'buy';
            else if (Number.isFinite(bestBid) && price <= bestBid) side = 'sell';
            else if (this._lastTapePrice != null) {
                if (price > this._lastTapePrice) side = 'buy';
                else if (price < this._lastTapePrice) side = 'sell';
                else side = this._lastTapeSide; // unchanged price carries prior side
            }
            if (side) this._lastTapeSide = side;
            return side;
        }

        _onMarketTrade(tick) {
            if (!tick || tick.marketId == null) return;
            const price = Number(tick.price);
            const volume = Number(tick.volume);
            if (!Number.isFinite(price) || !Number.isFinite(volume)) return;

            const key = String(tick.marketId);
            if (key !== this._tapeKey) {
                // Contract changed — reset the tape.
                this._tapeKey = key;
                this._tapeMarketId = tick.marketId;
                this._tape = [];
                this._lastTapePrice = null;
                this._lastTapeSide = null;
            }

            const side = this._inferSide(tick.marketId, price);
            this._lastTapePrice = price;

            const decimals = Number.isFinite(Number(tick.priceDecimals))
                ? Number(tick.priceDecimals)
                : this._decimalsFor(tick.marketId);

            this._tape.push({ time: tick.time, price, volume, side, decimals });
            if (this._tape.length > TAPE_CAP) this._tape.splice(0, this._tape.length - TAPE_CAP);

            if (this._activeTab === 'market') this._scheduleMarketRender();
        }

        _scheduleMarketRender() {
            if (this._tapeRenderScheduled) return;
            this._tapeRenderScheduled = true;
            setTimeout(() => {
                this._tapeRenderScheduled = false;
                if (this._activeTab === 'market') this._renderMarket();
            }, TAPE_RENDER_MS);
        }

        _renderMarket() {
            this._filterWrapEl.style.display = 'none';
            this._headEl.innerHTML = `
                <tr><th>Time</th><th>Price</th><th>Volume</th><th>Side*</th></tr>`;

            const label = this._tapeMarketId != null ? this._marketLabel(this._tapeMarketId) : null;
            this._summaryEl.textContent = this._tape.length
                ? `${label ?? 'Contract'} · ${this._tape.length} print${this._tape.length === 1 ? '' : 's'} (Side inferred)`
                : 'Waiting for trades on the subscribed contract…';

            const rows = this._tape.slice().reverse();
            this._tbodyEl.innerHTML = rows.map(t => {
                const timeText = Number.isFinite(Number(t.time))
                    ? new Date(t.time).toLocaleTimeString() : '-';
                const priceText = t.price.toFixed(t.decimals);
                return `
                    <tr class="th-row">
                        <td>${esc(timeText)}</td>
                        <td>${esc(priceText)}</td>
                        <td>${t.volume}</td>
                        <td class="${sideClass(t.side)}">${sideText(t.side)}</td>
                    </tr>`;
            }).join('');
        }
    }

    global.TradeHistory = TradeHistory;
})(window);
