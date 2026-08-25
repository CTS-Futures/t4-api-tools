/**
 * chart/ui/OrderToolbar.js
 *
 * Toolbar for the drag-to-place order tool (DragOrder feature). Two toggle
 * buttons (Buy / Sell) arm the tool; clicking the active button again or
 * pressing Escape disarms. A "Bracket" checkbox flips the tool into a
 * two-step bracket flow: drag the entry, then drag the TP/SL box edges,
 * then Submit.
 */
(function (global) {
    'use strict';

    class OrderToolbar {
        constructor({ host, chartService } = {}) {
            if (!host || !chartService) throw new Error('OrderToolbar requires { host, chartService }');
            this.host = host;
            this.chart = chartService;
            this._feature = chartService.getFeature('order-drag');
            if (!this._feature) {
                console.warn('[OrderToolbar] order-drag feature not registered');
                return;
            }
            this._feature.setCallbacks({
                onToolChange: (mode) => this._updateActive(mode),
                onStateChange: (state) => this._updateState(state)
            });
            this._buildDom();
        }

        _buildDom() {
            const root = document.createElement('div');
            root.className = 'order-toolbar';

            const mkBtn = (label, cls, onClick) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `order-btn ${cls}`;
                b.textContent = label;
                b.addEventListener('click', onClick);
                return b;
            };

            this._btnBuy = mkBtn('Buy Order', 'order-btn-buy',
                () => this._toggle('buy'));
            this._btnSell = mkBtn('Sell Order', 'order-btn-sell',
                () => this._toggle('sell'));

            // Type selector: 'auto' keeps the drop-vs-last inference; limit/stop/
            // market force the type for the simple drag entry; 'oco' turns a drop
            // into a two-line OCO builder. Market/OCO are incompatible with the
            // Bracket flow, so Bracket is disabled while either is selected.
            this._typeSelect = document.createElement('select');
            this._typeSelect.className = 'order-type-select';
            this._typeSelect.title = 'Order type for chart-placed orders';
            [
                ['auto', 'Auto'], ['limit', 'Limit'], ['stop', 'Stop'],
                ['market', 'Market'], ['oco', 'OCO']
            ].forEach(([value, text]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                this._typeSelect.appendChild(opt);
            });
            this._typeSelect.addEventListener('change', () => {
                const type = this._typeSelect.value;
                this._feature.setOrderType(type);
                const incompatible = type === 'market' || type === 'oco';
                if (this._bracketChk) {
                    this._bracketChk.disabled = incompatible;
                    if (incompatible && this._bracketChk.checked) {
                        this._bracketChk.checked = false;
                        this._feature.setBracketMode(false);
                    }
                }
                this._updateHint();
            });

            // Bracket toggle: when on, entry drop opens the TP/SL setup
            // overlay instead of submitting an immediate order.
            const bracketWrap = document.createElement('label');
            bracketWrap.className = 'order-bracket-toggle';
            this._bracketChk = document.createElement('input');
            this._bracketChk.type = 'checkbox';
            this._bracketChk.addEventListener('change', () => {
                this._feature.setBracketMode(this._bracketChk.checked);
                this._updateHint();
            });
            const bracketLbl = document.createElement('span');
            bracketLbl.textContent = 'Bracket';
            bracketWrap.appendChild(this._bracketChk);
            bracketWrap.appendChild(bracketLbl);

            this._hint = document.createElement('span');
            this._hint.className = 'order-hint';
            this._hint.textContent = '';

            root.appendChild(this._btnBuy);
            root.appendChild(this._btnSell);
            root.appendChild(this._typeSelect);
            root.appendChild(bracketWrap);
            root.appendChild(this._hint);
            this.host.appendChild(root);
        }

        _toggle(mode) {
            const current = this._feature && this._feature._toolMode;
            if (current === mode) this._feature.cancelTool();
            else this._feature.beginTool(mode);
        }

        _updateActive(mode) {
            this._mode = mode;
            this._btnBuy?.classList.toggle('active', mode === 'buy');
            this._btnSell?.classList.toggle('active', mode === 'sell');
            this._updateHint();
        }

        _updateState(state) {
            this._state = state;
            this._updateHint();
        }

        _updateHint() {
            if (!this._hint) return;
            if (!this._mode) {
                this._hint.textContent = '';
                return;
            }
            const type = this._typeSelect?.value || 'auto';
            if (this._state === 'setup') {
                this._hint.textContent = type === 'oco'
                    ? 'Drag the two OCO lines, then Submit OCO (Esc cancels)'
                    : 'Adjust TP/SL, then Submit (Esc cancels)';
                return;
            }
            if (type === 'oco') {
                this._hint.textContent = 'Drag on chart to place two OCO lines (Esc to cancel)';
                return;
            }
            if (type === 'market') {
                this._hint.textContent = 'Click chart to place at Market (Esc to cancel)';
                return;
            }
            this._hint.textContent = this._bracketChk?.checked
                ? 'Drag entry; then position TP/SL boxes (Esc to cancel)'
                : 'Drag on chart to place… (Esc to cancel)';
        }
    }

    global.ChartUI = global.ChartUI || {};
    global.ChartUI.OrderToolbar = OrderToolbar;
})(window);
