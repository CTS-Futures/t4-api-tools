/**
 * algo/ui/ParamForm.js
 *
 * Shared UI helpers for the algo panels:
 *  - buildParamInputs / readParamInputs render a strategy's `static params`
 *    schema into form inputs and read them back, so AlgoPanel and BacktestPanel
 *    stay generic — a new strategy that declares its own params just works.
 *  - makeEquityChart creates the small Lightweight Charts line chart used by both
 *    the backtest results and the live dashboard.
 */
(function (global) {
    'use strict';

    const Algo = global.Algo || (global.Algo = {});
    Algo.ui = Algo.ui || {};

    // Render `<div class="form-group">` inputs for each schema item into
    // `container`. Input ids are `${idPrefix}${key}` so a panel can scope several
    // forms on one page. Clears the container first (safe to call on re-select).
    function buildParamInputs(container, schema, idPrefix) {
        if (!container) return;
        container.innerHTML = '';
        for (const p of (schema || [])) {
            const id = `${idPrefix}${p.key}`;
            const group = document.createElement('div');
            group.className = 'form-group';

            const label = document.createElement('label');
            label.setAttribute('for', id);
            if (p.title) label.title = p.title;
            label.textContent = `${p.label}:`;

            const input = document.createElement('input');
            input.type = 'number';
            input.id = id;
            input.className = 'chart-qty-input';
            input.value = String(p.default);
            if (p.min != null) input.min = String(p.min);
            if (p.max != null) input.max = String(p.max);
            input.step = p.step != null ? String(p.step) : (p.type === 'float' ? 'any' : '1');
            if (p.title) input.title = p.title;

            group.appendChild(label);
            group.appendChild(input);
            container.appendChild(group);
        }
    }

    // Read the inputs built by buildParamInputs back into a params object,
    // coercing by declared type and clamping to min/max. Falls back to the
    // schema default when a field is blank or unparseable.
    function readParamInputs(container, schema, idPrefix) {
        const out = {};
        for (const p of (schema || [])) {
            const el = container ? container.querySelector(`#${idPrefix}${p.key}`) : null;
            const raw = el ? el.value : '';
            let v = p.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
            if (!Number.isFinite(v)) v = p.default;
            if (p.min != null && v < p.min) v = p.min;
            if (p.max != null && v > p.max) v = p.max;
            out[p.key] = v;
        }
        return out;
    }

    // Create a Lightweight Charts line chart for an equity curve in `hostEl`.
    // Returns { chart, series } or null if the charting library is unavailable.
    function makeEquityChart(hostEl, opts = {}) {
        if (!global.LightweightCharts || !hostEl) return null;
        const chart = global.LightweightCharts.createChart(hostEl, {
            autoSize: true,
            layout: { background: { color: opts.background || '#ffffff' }, textColor: opts.textColor || '#333' },
            rightPriceScale: { borderColor: '#e0e0e0' },
            timeScale: { borderColor: '#e0e0e0', timeVisible: true },
            grid: { horzLines: { color: '#f0f0f0' }, vertLines: { color: '#f7f7f7' } }
        });
        const series = chart.addLineSeries({ color: opts.color || '#4285f4', lineWidth: 2 });
        return { chart, series };
    }

    Object.assign(Algo.ui, { buildParamInputs, readParamInputs, makeEquityChart });
})(window);
