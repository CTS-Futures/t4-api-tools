/**
 * chart/features/ContextMenu.js
 *
 * Feature module: right-click trading menu on the chart.
 *
 * Two menu modes, picked by what's under the cursor when right-clicked:
 *
 *   1) Order-line menu — when the click y is within the hit-test tolerance
 *      of a working order line. Offers Cancel / Revise on that order.
 *
 *   2) Price menu — for any other click. Reads the price under the cursor
 *      and offers Market / Limit / Stop entries plus a Bracket (AOCO_P)
 *      submenu where the user types TP and SL prices.
 *
 * The feature is UI-only. It hands intents back to the host via callbacks so
 * account validation, logging, and the actual T4 calls stay in index.html:
 *
 *   feature.onOrder = (intent) => { ... }
 *     side                 : 1 (buy) | -1 (sell)
 *     priceType            : 'market' | 'limit' | 'stop'
 *     price                : tick-snapped price (null for market)
 *     volume               : integer qty
 *     takeProfitPrice?     : absolute price for AOCO TP leg (optional)
 *     stopLossPrice?       : absolute price for AOCO SL leg (optional)
 *
 *   feature.onCancelOrder = (uniqueId) => { ... }
 *   feature.onReviseOrder = (uniqueId) => { ... }
 *
 * Confirmation: when the confirm toggle (#chartConfirmOrders) is checked the
 * menu shows an inline Confirm/Cancel step before firing onOrder. The bracket
 * form is itself a deliberate two-step flow, so the confirm step is skipped
 * after a bracket submit to avoid double-confirmation.
 */
(function (global) {
    'use strict';

    class ContextMenuFeature {
        constructor({ qtyInputId = 'chartQuickQty', confirmToggleId = 'chartConfirmOrders' } = {}) {
            this.id = 'context-menu';
            this._qtyInputId = qtyInputId;
            this._confirmToggleId = confirmToggleId;

            this._container = null;
            this._series = null;
            this._host = null;
            this._client = null;

            this._menu = null;       // root menu element while open
            this._anchor = null;     // { clientX, clientY }
            this._unsubSymbol = null;
            this._onContextMenu = this._onContextMenu.bind(this);
            this._onDocPointerDown = this._onDocPointerDown.bind(this);
            this._onKeyDown = this._onKeyDown.bind(this);

            // Host-supplied callbacks.
            this.onOrder = null;
            this.onCancelOrder = null;
            this.onReviseOrder = null;
        }

        attach(ctx) {
            this._container = ctx.container || ctx.host?.renderer?.container || null;
            this._series = ctx.candleSeries;
            this._host = ctx.host;
            this._client = ctx.client;
            if (this._container) {
                this._container.addEventListener('contextmenu', this._onContextMenu);
            }
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => this._close());
        }

        detach() {
            this._close();
            if (this._container) {
                this._container.removeEventListener('contextmenu', this._onContextMenu);
            }
            if (this._unsubSymbol) this._unsubSymbol();
            this._container = null;
            this._series = null;
            this._host = null;
            this._client = null;
        }

        // ---------- event handling ----------------------------------------
        _onContextMenu(e) {
            if (!this._host?.activeMarketId) return;

            e.preventDefault();
            this._close();
            this._anchor = { clientX: e.clientX, clientY: e.clientY };

            const rect = this._container.getBoundingClientRect();
            const y = e.clientY - rect.top;

            // Order-line hit-test first: a right-click on a working-order line
            // is overwhelmingly "I want to act on this order", not "I want to
            // place a new order at this price."
            const ol = this._host._features?.get('order-lines');
            const orderId = ol && typeof ol.hitTest === 'function'
                ? ol.hitTest(y, this._host._hitTestPx || 6)
                : null;
            if (orderId) {
                if (typeof this.onCancelOrder !== 'function' && typeof this.onReviseOrder !== 'function') return;
                this._openOrderMenu(orderId);
                return;
            }

            if (typeof this.onOrder !== 'function') return;
            const rawPrice = this._series?.coordinateToPrice(y);
            if (rawPrice == null || !Number.isFinite(rawPrice)) return;
            const price = (typeof this._host._snapToTick === 'function')
                ? this._host._snapToTick(rawPrice)
                : rawPrice;

            this._openPriceMenu(price);
        }

        _onDocPointerDown(e) {
            if (this._menu && !this._menu.contains(e.target)) this._close();
        }

        _onKeyDown(e) {
            if (e.key === 'Escape') this._close();
        }

        // ---------- menu primitives ---------------------------------------
        _createMenu() {
            const menu = document.createElement('div');
            menu.className = 'chart-context-menu';
            document.body.appendChild(menu);
            this._menu = menu;
            // Defer global listeners so the opening right-click doesn't
            // immediately close the menu.
            setTimeout(() => {
                document.addEventListener('pointerdown', this._onDocPointerDown, true);
                document.addEventListener('keydown', this._onKeyDown, true);
            }, 0);
            return menu;
        }

        _addHeader(text) {
            const h = document.createElement('div');
            h.className = 'ccm-header';
            h.textContent = text;
            this._menu.appendChild(h);
            return h;
        }

        _addItem(label, cls, onClick) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `ccm-item ${cls || ''}`.trim();
            btn.textContent = label;
            btn.addEventListener('click', onClick);
            this._menu.appendChild(btn);
            return btn;
        }

        _addSep() {
            const s = document.createElement('div');
            s.className = 'ccm-sep';
            this._menu.appendChild(s);
        }

        _reposition() {
            const menu = this._menu;
            const anchor = this._anchor;
            if (!menu || !anchor) return;
            // Render then measure: width/height aren't known until in the DOM.
            const { offsetWidth: w, offsetHeight: h } = menu;
            const vw = global.innerWidth;
            const vh = global.innerHeight;
            const left = (anchor.clientX + w > vw) ? Math.max(0, anchor.clientX - w) : anchor.clientX;
            const top = (anchor.clientY + h > vh) ? Math.max(0, anchor.clientY - h) : anchor.clientY;
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        }

        // ---------- price menu (empty area click) -------------------------
        _openPriceMenu(price) {
            const decimals = this._host?.knownDecimals ?? 2;
            const lbl = Number(price).toFixed(decimals);

            this._createMenu();
            this._addHeader(`Price ${lbl}`);

            const choose = (intent, label) => () => this._chooseSimple(intent, label);

            this._addItem('Buy @ Market', 'ccm-buy',
                choose({ side: 1, priceType: 'market', price: null }, 'Buy @ Market'));
            this._addItem('Sell @ Market', 'ccm-sell',
                choose({ side: -1, priceType: 'market', price: null }, 'Sell @ Market'));

            this._addSep();

            this._addItem(`Buy Limit @ ${lbl}`, 'ccm-buy',
                choose({ side: 1, priceType: 'limit', price }, `Buy Limit @ ${lbl}`));
            this._addItem(`Sell Limit @ ${lbl}`, 'ccm-sell',
                choose({ side: -1, priceType: 'limit', price }, `Sell Limit @ ${lbl}`));

            this._addSep();

            this._addItem(`Buy Stop @ ${lbl}`, 'ccm-buy',
                choose({ side: 1, priceType: 'stop', price }, `Buy Stop @ ${lbl}`));
            this._addItem(`Sell Stop @ ${lbl}`, 'ccm-sell',
                choose({ side: -1, priceType: 'stop', price }, `Sell Stop @ ${lbl}`));

            this._addSep();

            this._addItem(`Buy Bracket @ ${lbl}...`, 'ccm-buy',
                () => this._openBracketForm(1, price));
            this._addItem(`Sell Bracket @ ${lbl}...`, 'ccm-sell',
                () => this._openBracketForm(-1, price));

            this._reposition();
        }

        // ---------- order-line menu --------------------------------------
        _openOrderMenu(uniqueId) {
            const order = this._client?.orders?.get?.(uniqueId);
            const sideText = order?.buySell === 1 ? 'Buy' : (order?.buySell === -1 ? 'Sell' : '?');
            const vol = order?.currentVolume ?? order?.volume ?? '';

            this._createMenu();
            this._addHeader(`Order: ${sideText} ${vol}`);

            this._addItem('Cancel order', 'ccm-sell', () => {
                this._close();
                if (typeof this.onCancelOrder === 'function') {
                    try { this.onCancelOrder(uniqueId); }
                    catch (err) { console.error('[ContextMenu] onCancelOrder failed:', err); }
                }
            });

            if (typeof this.onReviseOrder === 'function') {
                this._addItem('Revise...', '', () => {
                    this._close();
                    try { this.onReviseOrder(uniqueId); }
                    catch (err) { console.error('[ContextMenu] onReviseOrder failed:', err); }
                });
            }

            this._reposition();
        }

        // ---------- bracket form (inline AOCO_P) -------------------------
        _openBracketForm(side, entryPrice) {
            const decimals = this._host?.knownDecimals ?? 2;
            const lbl = Number(entryPrice).toFixed(decimals);
            const sideText = side === 1 ? 'BUY' : 'SELL';
            const sideCls = side === 1 ? 'ccm-buy' : 'ccm-sell';

            const menu = this._menu;
            if (!menu) return;
            menu.innerHTML = '';

            this._addHeader(`${sideText} Bracket — Limit @ ${lbl}`);

            // Pre-fill TP/SL with a sensible offset (a few ticks) so the user
            // sees the shape immediately and can tweak. Use minPriceIncrement
            // when available, falling back to a percentage of the entry price.
            const details = this._host?.activeMarketId
                ? this._client?.getMarketDetails?.(this._host.activeMarketId)
                : null;
            const tickRaw = details?.minPriceIncrement?.value;
            const tick = Number.isFinite(Number(tickRaw)) && Number(tickRaw) > 0
                ? Number(tickRaw)
                : entryPrice * 0.0005;
            const offsetTicks = 10;
            const offset = tick * offsetTicks;
            const tpDefault = side === 1 ? entryPrice + offset : entryPrice - offset;
            const slDefault = side === 1 ? entryPrice - offset : entryPrice + offset;
            const fmt = (n) => Number(n).toFixed(decimals);

            const tpInput = this._addFormRow('TP price', fmt(tpDefault));
            const slInput = this._addFormRow('SL price', fmt(slDefault));

            const row = document.createElement('div');
            row.className = 'ccm-confirm-row';

            const submit = document.createElement('button');
            submit.type = 'button';
            submit.className = `ccm-item ${sideCls}`;
            submit.textContent = 'Submit';
            submit.addEventListener('click', () => {
                const tp = parseFloat(tpInput.value);
                const sl = parseFloat(slInput.value);
                const intent = {
                    side,
                    priceType: 'limit',
                    price: entryPrice,
                    volume: this._readQty(),
                    takeProfitPrice: Number.isFinite(tp) ? tp : null,
                    stopLossPrice: Number.isFinite(sl) ? sl : null
                };
                // Bracket form is already a deliberate confirm step; fire directly.
                this._fire(intent);
            });

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'ccm-item ccm-cancel';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', () => this._close());

            row.appendChild(submit);
            row.appendChild(cancel);
            menu.appendChild(row);

            this._reposition();
            // Focus the TP input so the user can type immediately.
            tpInput.focus();
            tpInput.select();
        }

        _addFormRow(labelText, defaultValue) {
            const wrap = document.createElement('div');
            wrap.className = 'ccm-form-row';
            const lab = document.createElement('label');
            lab.textContent = labelText;
            const input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = defaultValue;
            wrap.appendChild(lab);
            wrap.appendChild(input);
            this._menu.appendChild(wrap);
            return input;
        }

        // ---------- simple confirm flow (market/limit/stop) --------------
        _chooseSimple(intent, label) {
            const full = { ...intent, volume: this._readQty() };
            if (this._shouldConfirm()) {
                this._renderConfirm(full, label);
                return;
            }
            this._fire(full);
        }

        _renderConfirm(intent, label) {
            const menu = this._menu;
            if (!menu) return;
            menu.innerHTML = '';

            this._addHeader(`Confirm: ${intent.side === 1 ? 'BUY' : 'SELL'} ${intent.volume}`);

            const detail = document.createElement('div');
            detail.className = 'ccm-confirm-detail';
            detail.textContent = label;
            menu.appendChild(detail);

            const row = document.createElement('div');
            row.className = 'ccm-confirm-row';

            const yes = document.createElement('button');
            yes.type = 'button';
            yes.className = `ccm-item ${intent.side === 1 ? 'ccm-buy' : 'ccm-sell'}`;
            yes.textContent = 'Confirm';
            yes.addEventListener('click', () => this._fire(intent));

            const no = document.createElement('button');
            no.type = 'button';
            no.className = 'ccm-item ccm-cancel';
            no.textContent = 'Cancel';
            no.addEventListener('click', () => this._close());

            row.appendChild(yes);
            row.appendChild(no);
            menu.appendChild(row);
            this._reposition();
        }

        _fire(intent) {
            this._close();
            try {
                this.onOrder(intent);
            } catch (err) {
                if (global.console) console.error('[ContextMenu] onOrder failed:', err);
            }
        }

        // ---------- helpers -----------------------------------------------
        _readQty() {
            const el = document.getElementById(this._qtyInputId);
            const n = parseInt(el?.value, 10);
            return Number.isFinite(n) && n > 0 ? n : 1;
        }

        _shouldConfirm() {
            const el = document.getElementById(this._confirmToggleId);
            return !!(el && el.checked);
        }

        // Public: route an externally-built intent (e.g. chart click-to-trade)
        // through the same confirm UI as the right-click menu. Honours the
        // confirm toggle: fires immediately when unchecked.
        confirmIntent({ intent, label, clientX, clientY } = {}) {
            if (typeof this.onOrder !== 'function' || !intent) return;
            if (!this._shouldConfirm()) {
                this._fire(intent);
                return;
            }
            this._close();
            const vw = global.innerWidth;
            const vh = global.innerHeight;
            this._anchor = {
                clientX: Number.isFinite(clientX) ? clientX : vw / 2,
                clientY: Number.isFinite(clientY) ? clientY : vh / 2
            };
            this._createMenu();
            this._renderConfirm(intent, label || '');
        }

        _close() {
            if (this._menu) {
                this._menu.remove();
                this._menu = null;
            }
            this._anchor = null;
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            document.removeEventListener('keydown', this._onKeyDown, true);
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.ContextMenu = ContextMenuFeature;
})(window);
