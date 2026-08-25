/**
 * chart/ui/IndicatorToolbar.js
 *
 * Lightweight dropdown UI for adding/removing indicators on the active
 * ChartService. Renders into a host element (passed in) and uses
 * chartService.registerFeature / unregisterFeature.
 *
 * Persistence is delegated to LayoutStore via callbacks the host wires up
 * (onChange fires whenever the indicator set changes).
 */
(function (global) {
    'use strict';

    const TYPES = [
        { value: 'ema', label: 'EMA', needsPeriod: true, defaultPeriod: 20 },
        { value: 'sma', label: 'SMA', needsPeriod: true, defaultPeriod: 50 },
        { value: 'vwap', label: 'VWAP', needsPeriod: false }
    ];

    let _idSeq = 0;
    function nextId(type, period) {
        _idSeq++;
        return `ind-${type}-${period || 'x'}-${_idSeq}`;
    }

    class IndicatorToolbar {
        constructor({ host, chartService, onChange } = {}) {
            if (!host || !chartService) throw new Error('IndicatorToolbar requires { host, chartService }');
            this.host = host;
            this.chart = chartService;
            this.onChange = typeof onChange === 'function' ? onChange : null;
            this._items = new Map(); // id -> { type, period, color, chip }
            this._buildDom();
        }

        _buildDom() {
            const root = document.createElement('div');
            root.className = 'indicator-toolbar';

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'indicator-add-btn';
            addBtn.textContent = '+ Indicator';

            const menu = document.createElement('div');
            menu.className = 'indicator-menu';
            menu.style.display = 'none';

            for (const t of TYPES) {
                const row = document.createElement('div');
                row.className = 'indicator-menu-row';

                const label = document.createElement('span');
                label.className = 'indicator-menu-label';
                label.textContent = t.label;
                row.appendChild(label);

                let periodInput = null;
                if (t.needsPeriod) {
                    periodInput = document.createElement('input');
                    periodInput.type = 'number';
                    periodInput.min = '1';
                    periodInput.value = String(t.defaultPeriod);
                    periodInput.className = 'indicator-menu-period';
                    row.appendChild(periodInput);
                }

                const add = document.createElement('button');
                add.type = 'button';
                add.textContent = 'Add';
                add.className = 'indicator-menu-add';
                add.addEventListener('click', () => {
                    const period = t.needsPeriod ? Math.max(1, parseInt(periodInput.value, 10) || t.defaultPeriod) : 0;
                    this.addIndicator({ type: t.value, period });
                    menu.style.display = 'none';
                });
                row.appendChild(add);
                menu.appendChild(row);
            }

            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            });
            document.addEventListener('click', (e) => {
                if (!root.contains(e.target)) menu.style.display = 'none';
            });

            const chipBar = document.createElement('div');
            chipBar.className = 'indicator-chips';

            root.appendChild(addBtn);
            root.appendChild(menu);
            root.appendChild(chipBar);
            this.host.appendChild(root);

            this._root = root;
            this._chipBar = chipBar;
        }

        addIndicator({ id, type, period, color }) {
            const Ctor = global.ChartFeatures?.IndicatorFeature;
            if (!Ctor) return null;
            const finalId = id || nextId(type, period);
            if (this._items.has(finalId)) return null;

            const feature = new Ctor({ id: finalId, type, period, color });
            this.chart.registerFeature(feature);

            const chip = this._buildChip(finalId, feature);
            this._chipBar.appendChild(chip);
            this._items.set(finalId, { type, period: feature.period, color: feature.color, chip });

            if (this.onChange) this.onChange(this.serialize());
            return finalId;
        }

        removeIndicator(id) {
            const item = this._items.get(id);
            if (!item) return;
            this.chart.unregisterFeature(id);
            try { item.chip.remove(); } catch (_) { /* gone */ }
            this._items.delete(id);
            if (this.onChange) this.onChange(this.serialize());
        }

        clear() {
            for (const id of Array.from(this._items.keys())) this.removeIndicator(id);
        }

        // Replace current indicator set with the given list, without firing
        // onChange per-item (used by persistence on symbol switch).
        load(list) {
            const prevOnChange = this.onChange;
            this.onChange = null;
            try {
                this.clear();
                for (const spec of (list || [])) {
                    this.addIndicator(spec);
                }
            } finally {
                this.onChange = prevOnChange;
            }
        }

        serialize() {
            const out = [];
            for (const [id, item] of this._items) {
                out.push({ id, type: item.type, period: item.period, color: item.color });
            }
            return out;
        }

        _buildChip(id, feature) {
            const chip = document.createElement('span');
            chip.className = 'indicator-chip';
            chip.style.borderColor = feature.color;

            const dot = document.createElement('span');
            dot.className = 'indicator-chip-dot';
            dot.style.background = feature.color;

            const label = document.createElement('span');
            label.textContent = feature.title;

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'indicator-chip-close';
            close.textContent = '×';
            close.title = 'Remove';
            close.addEventListener('click', () => this.removeIndicator(id));

            chip.appendChild(dot);
            chip.appendChild(label);
            chip.appendChild(close);
            return chip;
        }
    }

    global.ChartUI = global.ChartUI || {};
    global.ChartUI.IndicatorToolbar = IndicatorToolbar;
})(window);
