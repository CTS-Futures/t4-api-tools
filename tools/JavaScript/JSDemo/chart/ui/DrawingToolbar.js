/**
 * chart/ui/DrawingToolbar.js
 *
 * Toolbar for drawing tools. Buttons:
 *   - Trendline:   activates 2-click placement
 *   - Fib:         activates 2-click placement (retracement)
 *   - Clear:       wipes all drawings on the active market
 *   - Cancel hint: shown while a tool is armed; click cancels
 */
(function (global) {
    'use strict';

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

            this._btnTrend = mkBtn('Trendline', 'drawing-btn-trendline',
                () => this._toggle('trendline'));
            this._btnFib = mkBtn('Fib', 'drawing-btn-fib',
                () => this._toggle('fib'));
            this._btnBox = mkBtn('Box', 'drawing-btn-box',
                () => this._toggle('box'));
            this._btnClear = mkBtn('Clear', 'drawing-btn-clear',
                () => this._feature.clearActive());

            this._hint = document.createElement('span');
            this._hint.className = 'drawing-hint';
            this._hint.textContent = '';

            root.appendChild(this._btnTrend);
            root.appendChild(this._btnFib);
            root.appendChild(this._btnBox);
            root.appendChild(this._btnClear);
            root.appendChild(this._hint);
            this.host.appendChild(root);
        }

        _toggle(mode) {
            const current = this._feature && this._feature._toolMode;
            if (current === mode) this._feature.cancelTool();
            else this._feature.beginTool(mode);
        }

        _updateActive(mode) {
            this._btnTrend?.classList.toggle('active', mode === 'trendline');
            this._btnFib?.classList.toggle('active', mode === 'fib');
            this._btnBox?.classList.toggle('active', mode === 'box');
            if (this._hint) {
                this._hint.textContent = mode ? 'Click 2 points on chart…' : '';
            }
        }
    }

    global.ChartUI = global.ChartUI || {};
    global.ChartUI.DrawingToolbar = DrawingToolbar;
})(window);
