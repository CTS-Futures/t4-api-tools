/**
 * DomLadder.js
 *
 * Standalone DOM (Depth-of-Market) ladder panel, docked beside the price chart.
 * Renders a scrollable, price-keyed ladder of the LIVE order book — resting buy
 * BIDS on one side, resting sell OFFERS on the other — with the user's own
 * working orders and net position highlighted on the matching price rows.
 *
 * This is a plain UI component (not a Lightweight-Charts feature): it owns a
 * scrollable table and is fed by the host page. The host wires the data:
 *
 *   ladder.setMarketDetails({ tick, decimals })  // price grid + formatting
 *   ladder.setDepth({ bids, offers })            // normalized live book
 *   ladder.setOrders(workingOrders)              // user's working orders (raw)
 *   ladder.setPosition(avgPrice, net)            // filled position
 *   ladder.clear()                               // on market switch
 *
 * "Middle ground": the inside market (best bid / best offer). The ladder
 * auto-centers on the mid as price shifts; if the user scrolls away, auto-follow
 * pauses and a "Recenter" button appears to snap back, so the full book stays
 * scrollable without the ladder fighting the user.
 *
 * Each row is one price tick. Columns: My Buys | Bid | Price | Offer | My Sells.
 * Bid/offer cells carry a proportional depth bar scaled to the largest resting
 * size currently in view.
 */
(function (global) {
    'use strict';

    const MAX_ROWS = 500;       // cap contiguous tick rows so a stray far level
                                // can't explode the DOM; centered on the mid
    const BID_RGB = '38,166,154';   // teal (matches orderflow bid colour)
    const OFFER_RGB = '239,83,80';  // red  (matches orderflow offer colour)

    // Coerce a protobuf price/volume field into a JS number. Mirrors
    // DepthSnapshotBuffer.num: { value:"5800.25" } Decimal wrapper, plain
    // number, numeric string, or protobuf.js Long { low, high }.
    function num(v, depth) {
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
            if (d > 4) return NaN;
            if ('value' in v) {
                const n = num(v.value, d + 1);
                if (Number.isFinite(n)) return n;
            }
            if ('low' in v && 'high' in v) {
                const low = v.low >>> 0;
                const high = v.high | 0;
                return high * 0x100000000 + low;
            }
        }
        return NaN;
    }

    class DomLadder {
        constructor(container, { onOrder } = {}) {
            this._container = container;
            this._onOrder = onOrder || null;
            this._tick = NaN;
            this._decimals = 2;

            // Aggregated state, keyed by integer tick index (price / tick).
            this._bids = new Map();   // key -> volume
            this._offers = new Map(); // key -> volume
            this._buys = new Map();   // key -> my working buy volume
            this._sells = new Map();  // key -> my working sell volume
            this._maxVol = 0;
            this._bestBidKey = null;
            this._bestOfferKey = null;

            this._posPrice = null;
            this._posNet = 0;

            this._autoFollow = true;
            this._programmaticScroll = false;
            this._rafHandle = 0;

            this._build();
        }

        // ---------- DOM shell --------------------------------------------
        _build() {
            const root = document.createElement('div');
            root.className = 'dom-ladder';

            const header = document.createElement('div');
            header.className = 'dom-ladder-header';
            const title = document.createElement('span');
            title.className = 'dom-ladder-title';
            title.textContent = 'Order Book';
            this._posLabel = document.createElement('span');
            this._posLabel.className = 'dom-ladder-pos';
            this._recenterBtn = document.createElement('button');
            this._recenterBtn.type = 'button';
            this._recenterBtn.className = 'dom-ladder-recenter';
            this._recenterBtn.textContent = 'Recenter';
            this._recenterBtn.style.display = 'none';
            this._recenterBtn.addEventListener('click', () => {
                this._autoFollow = true;
                this._recenterBtn.style.display = 'none';
                this._centerOnMid();
            });

            // Order quantity for click-to-trade. Click a Bid cell to BUY this
            // many at that price; click an Offer cell to SELL.
            const qtyWrap = document.createElement('label');
            qtyWrap.className = 'dom-ladder-qty';
            const qtyLbl = document.createElement('span');
            qtyLbl.textContent = 'Qty:';
            this._qtyInput = document.createElement('input');
            this._qtyInput.type = 'number';
            this._qtyInput.min = '1';
            this._qtyInput.value = '1';
            qtyWrap.appendChild(qtyLbl);
            qtyWrap.appendChild(this._qtyInput);

            header.appendChild(title);
            header.appendChild(this._posLabel);
            header.appendChild(qtyWrap);
            header.appendChild(this._recenterBtn);

            // Column labels (sticky).
            const cols = document.createElement('div');
            cols.className = 'dom-ladder-cols';
            for (const [cls, txt] of [
                ['dl-c-mybuy', 'Buys'], ['dl-c-bid', 'Bid'], ['dl-c-price', 'Price'],
                ['dl-c-offer', 'Offer'], ['dl-c-mysell', 'Sells']
            ]) {
                const c = document.createElement('div');
                c.className = `dl-col ${cls}`;
                c.textContent = txt;
                cols.appendChild(c);
            }

            this._body = document.createElement('div');
            this._body.className = 'dom-ladder-body';
            this._body.addEventListener('scroll', () => {
                if (this._programmaticScroll) { this._programmaticScroll = false; return; }
                // A genuine user scroll pauses auto-follow.
                if (this._autoFollow) {
                    this._autoFollow = false;
                    this._recenterBtn.style.display = '';
                }
            });

            // One-click trading. We fire on mousedown (left button), NOT click:
            // the body wipes and rebuilds every row on each depth tick (~60/s),
            // so the row pressed is usually destroyed before mouseup, and the
            // browser never emits a click. mousedown fires on press while the
            // row is still live. Bid cell -> BUY limit, Offer cell -> SELL
            // limit, at that row's price. Price/side ride on the cell dataset.
            this._body.addEventListener('mousedown', (e) => {
                if (!this._onOrder || e.button !== 0) return;
                const cell = e.target.closest('.dl-bid, .dl-offer');
                if (!cell) return;
                const price = Number(cell.dataset.price);
                if (!Number.isFinite(price)) return;
                const side = cell.dataset.side === 'sell' ? -1 : 1;
                this._onOrder({ side, price, volume: this._getQty() });
            });

            this._empty = document.createElement('div');
            this._empty.className = 'dom-ladder-empty';
            this._empty.textContent = 'Waiting for order book…';
            this._body.appendChild(this._empty);

            root.appendChild(header);
            root.appendChild(cols);
            root.appendChild(this._body);
            this._container.appendChild(root);
        }

        // ---------- public API -------------------------------------------
        setMarketDetails({ tick, decimals } = {}) {
            const t = Number(tick);
            this._tick = Number.isFinite(t) && t > 0
                ? t
                : (Number.isFinite(decimals) ? Math.pow(10, -decimals) : NaN);
            if (Number.isFinite(decimals)) this._decimals = decimals;
            this._scheduleRender();
        }

        setDepth(book) {
            this._bids.clear();
            this._offers.clear();
            this._maxVol = 0;
            this._bestBidKey = null;
            this._bestOfferKey = null;
            if (book) {
                this._ingestSide(book.bids, this._bids, true);
                this._ingestSide(book.offers, this._offers, false);
            }
            this._scheduleRender();
        }

        // Bucket the user's working orders by price tick into buy/sell maps.
        // Accepts the raw order objects (same shape OrderLines consumes).
        setOrders(orders) {
            this._buys.clear();
            this._sells.clear();
            const step = this._tick;
            if (Array.isArray(orders) && Number.isFinite(step) && step > 0) {
                for (const o of orders) {
                    if (!o) continue;
                    const price = num(o.currentLimitPrice ?? o.currentStopPrice ?? o.limitPrice ?? o.stopPrice, 0);
                    const vol = Number(o.currentVolume ?? o.workingVolume ?? o.volume);
                    if (!Number.isFinite(price) || !Number.isFinite(vol) || vol <= 0) continue;
                    const key = Math.round(price / step);
                    const target = Number(o.buySell) < 0 ? this._sells : this._buys;
                    target.set(key, (target.get(key) || 0) + vol);
                }
            }
            this._scheduleRender();
        }

        setPosition(avgPrice, net) {
            const p = Number(avgPrice);
            this._posPrice = Number.isFinite(p) ? p : null;
            this._posNet = Number(net) || 0;
            this._scheduleRender();
        }

        clear() {
            this._bids.clear(); this._offers.clear();
            this._buys.clear(); this._sells.clear();
            this._maxVol = 0;
            this._bestBidKey = this._bestOfferKey = null;
            this._posPrice = null; this._posNet = 0;
            this._autoFollow = true;
            this._recenterBtn.style.display = 'none';
            this._scheduleRender();
        }

        // ---------- ingest helpers ---------------------------------------
        _ingestSide(levels, map, isBid) {
            const step = this._tick;
            if (!Array.isArray(levels) || !(Number.isFinite(step) && step > 0)) return;
            let bestKey = null;
            for (const lvl of levels) {
                if (!lvl) continue;
                const price = num(lvl.price, 0);
                const volume = num(lvl.volume, 0);
                if (!Number.isFinite(price) || !Number.isFinite(volume) || volume <= 0) continue;
                const key = Math.round(price / step);
                map.set(key, (map.get(key) || 0) + volume);
                const total = map.get(key);
                if (total > this._maxVol) this._maxVol = total;
                if (bestKey == null) bestKey = key;
                else bestKey = isBid ? Math.max(bestKey, key) : Math.min(bestKey, key);
            }
            if (isBid) this._bestBidKey = bestKey;
            else this._bestOfferKey = bestKey;
        }

        _midKey() {
            const b = this._bestBidKey, o = this._bestOfferKey;
            if (b != null && o != null) return Math.round((b + o) / 2);
            if (b != null) return b;
            if (o != null) return o;
            return null;
        }

        // ---------- render -----------------------------------------------
        _scheduleRender() {
            if (this._rafHandle) return;
            const raf = global.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            this._rafHandle = raf(() => { this._rafHandle = 0; this._render(); });
        }

        _render() {
            const step = this._tick;
            const haveBook = this._bids.size > 0 || this._offers.size > 0;
            if (!Number.isFinite(step) || step <= 0 || !haveBook) {
                this._body.innerHTML = '';
                this._body.appendChild(this._empty);
                return;
            }

            // Contiguous tick range = union of book + order keys.
            let hiKey = -Infinity, loKey = Infinity;
            const consider = (m) => { for (const k of m.keys()) { if (k > hiKey) hiKey = k; if (k < loKey) loKey = k; } };
            consider(this._bids); consider(this._offers);
            consider(this._buys); consider(this._sells);
            if (!Number.isFinite(hiKey) || !Number.isFinite(loKey)) return;

            // Cap rows around the mid so a stray far level can't explode the DOM.
            const midKey = this._midKey();
            let total = hiKey - loKey + 1;
            if (total > MAX_ROWS) {
                const center = midKey != null ? midKey : Math.round((hiKey + loKey) / 2);
                const half = Math.floor(MAX_ROWS / 2);
                hiKey = center + half;
                loKey = center - half;
                console.warn(`[DomLadder] ${total} tick rows exceeds cap ${MAX_ROWS}; clipped around mid`);
                total = MAX_ROWS;
            }

            const posKey = (this._posPrice != null) ? Math.round(this._posPrice / step) : null;
            const maxVol = this._maxVol > 0 ? this._maxVol : 1;
            const frag = document.createDocumentFragment();

            for (let key = hiKey; key >= loKey; key--) {
                const price = key * step;
                const bidVol = this._bids.get(key) || 0;
                const offerVol = this._offers.get(key) || 0;
                const myBuy = this._buys.get(key) || 0;
                const mySell = this._sells.get(key) || 0;

                const row = document.createElement('div');
                row.className = 'dl-row';
                if (key === this._bestBidKey) row.classList.add('dl-best-bid');
                if (key === this._bestOfferKey) row.classList.add('dl-best-offer');
                if (posKey != null && key === posKey) row.classList.add('dl-pos-row');

                row.appendChild(this._orderCell('dl-mybuy', myBuy));
                row.appendChild(this._depthCell('dl-bid', bidVol, maxVol, BID_RGB, price, 'buy'));
                row.appendChild(this._priceCell(price, posKey != null && key === posKey));
                row.appendChild(this._depthCell('dl-offer', offerVol, maxVol, OFFER_RGB, price, 'sell'));
                row.appendChild(this._orderCell('dl-mysell', mySell));

                frag.appendChild(row);
            }

            this._body.innerHTML = '';
            this._body.appendChild(frag);
            this._updatePosLabel();

            if (this._autoFollow) this._centerOnMid();
        }

        _depthCell(cls, vol, maxVol, rgb, price, side) {
            const cell = document.createElement('div');
            cell.className = `dl-cell ${cls}`;
            // Click-to-trade hooks: whole column is a valid target, so resting
            // limits can be placed away from the inside market too.
            if (Number.isFinite(price)) cell.dataset.price = price;
            if (side) cell.dataset.side = side;
            if (vol > 0) {
                const bar = document.createElement('span');
                bar.className = 'dl-bar';
                bar.style.width = `${Math.min(100, (vol / maxVol) * 100)}%`;
                bar.style.background = `rgba(${rgb},0.35)`;
                const n = document.createElement('span');
                n.className = 'dl-num';
                n.textContent = vol;
                cell.appendChild(bar);
                cell.appendChild(n);
            }
            return cell;
        }

        _orderCell(cls, vol) {
            const cell = document.createElement('div');
            cell.className = `dl-cell ${cls}`;
            if (vol > 0) {
                const chip = document.createElement('span');
                chip.className = 'dl-chip';
                chip.textContent = vol;
                cell.appendChild(chip);
            }
            return cell;
        }

        _priceCell(price, isPos) {
            const cell = document.createElement('div');
            cell.className = 'dl-cell dl-price';
            cell.textContent = price.toFixed(this._decimals);
            if (isPos) cell.classList.add('dl-price-pos');
            return cell;
        }

        _getQty() {
            const q = parseInt(this._qtyInput && this._qtyInput.value, 10);
            return Math.max(1, Number.isFinite(q) ? q : 1);
        }

        _updatePosLabel() {
            if (this._posNet && this._posPrice != null) {
                const dir = this._posNet > 0 ? 'long' : 'short';
                this._posLabel.textContent = `Net ${this._posNet > 0 ? '+' : ''}${this._posNet} @ ${this._posPrice.toFixed(this._decimals)}`;
                this._posLabel.className = `dom-ladder-pos dl-${dir}`;
            } else {
                this._posLabel.textContent = '';
                this._posLabel.className = 'dom-ladder-pos';
            }
        }

        // Scroll the body so the inside market (midpoint of best bid/offer) sits
        // vertically centered. Row positions are measured relative to the scroll
        // container via getBoundingClientRect — NOT offsetTop, whose offsetParent is
        // an unpositioned ancestor here and would be measured against the page.
        _centerOnMid() {
            const body = this._body;
            const bid = body.querySelector('.dl-best-bid');
            const offer = body.querySelector('.dl-best-offer');
            const bodyTop = body.getBoundingClientRect().top;
            // Row center in the body's scroll-content coordinate space (px).
            const rowCenter = (el) => {
                const r = el.getBoundingClientRect();
                return (r.top - bodyTop) + body.scrollTop + r.height / 2;
            };
            let center;
            if (bid && offer) {
                center = (rowCenter(bid) + rowCenter(offer)) / 2;
            } else {
                const row = bid || offer || body.querySelector('.dl-row');
                if (!row) return;
                center = rowCenter(row);
            }
            this._programmaticScroll = true;
            body.scrollTop = Math.max(0, center - body.clientHeight / 2);
        }
    }

    global.DomLadder = DomLadder;
})(window);
