/**
 * chart/ui/DrawingToolbar.js
 *
 * Toolbar for drawing tools. Each tool button arms the corresponding overlay
 * tool (click again to cancel); Clear wipes all drawings on the active market.
 * A hint span shows placement guidance while a tool is armed.
 *
 * Tools map 1:1 to chart/drawings/DrawingTypes.js. Adding a tool there + a row
 * in TOOLS below is all that's needed.
 */
(function (global) {
    'use strict';

    // label + anchor-count hint per tool (order = toolbar order).
    const TOOLS = [
        { type: 'trendline', label: 'Trend', hint: 'Click 2 points' },
        { type: 'ray', label: 'Ray', hint: 'Click 2 points (extends)' },
        { type: 'extended', label: 'Ext Line', hint: 'Click 2 points (both ways)' },
        { type: 'hline', label: 'H-Line', hint: 'Click a price level' },
        { type: 'vline', label: 'V-Line', hint: 'Click a time' },
        { type: 'arrow', label: 'Arrow', hint: 'Click start then tip' },
        { type: 'box', label: 'Box', hint: 'Click 2 corners' },
        { type: 'fib', label: 'Fib', hint: 'Click high then low' },
        { type: 'measure', label: 'Measure', hint: 'Click 2 points' }
    ];

    class DrawingToolbar {
        constructor({ host, chartService, onChange } = {}) {
            if (!host || !chartService) throw new Error('DrawingToolbar requires { host, chartService }');
            this.host = host;
            this.chart = chartService;
            this._feature = chartService.getFeature('drawings');
            if (!this._feature) {
                console.warn('[DrawingToolbar] drawings feature not registered');
                return;
            }
            this._btns = new Map(); // type -> button
            this._feature.setCallbacks({
                onToolChange: (mode) => this._updateActive(mode),
                onChange: typeof onChange === 'function' ? onChange : null
            });
            this._buildDom();
        }

        _buildDom() {
            const root = document.createElement('div');
            root.className = 'drawing-toolbar';

            const mkBtn = (label, cls, onClick) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `drawing-btn ${cls}`;
                b.textContent = label;
                b.addEventListener('click', onClick);
                return b;
            };

            for (const tool of TOOLS) {
                const b = mkBtn(tool.label, `drawing-btn-${tool.type}`, () => this._toggle(tool.type));
                b.dataset.tool = tool.type;
                b.title = tool.hint;
                this._btns.set(tool.type, b);
                root.appendChild(b);
            }

            this._btnClear = mkBtn('Clear', 'drawing-btn-clear', () => this._feature.clearActive());
            root.appendChild(this._btnClear);

            this._hint = document.createElement('span');
            this._hint.className = 'drawing-hint';
            this._hint.textContent = '';
            root.appendChild(this._hint);

            this.host.appendChild(root);
        }

        _toggle(type) {
            const current = this._feature && this._feature._toolMode;
            if (current === type) this._feature.cancelTool();
            else this._feature.beginTool(type);
        }

        _updateActive(mode) {
            for (const [type, btn] of this._btns) {
                btn.classList.toggle('active', type === mode);
            }
            if (this._hint) {
                const tool = TOOLS.find((t) => t.type === mode);
                this._hint.textContent = tool ? `${tool.hint}…` : '';
            }
        }
    }

    global.ChartUI = global.ChartUI || {};
    global.ChartUI.DrawingToolbar = DrawingToolbar;
})(window);
