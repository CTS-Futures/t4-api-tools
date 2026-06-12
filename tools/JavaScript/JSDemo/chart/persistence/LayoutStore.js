/**
 * chart/persistence/LayoutStore.js
 *
 * Per-symbol localStorage for chart layouts:
 *   { indicators: [...], drawings: [...] }
 *
 * Keys use a stable prefix so a single ContractPicker reset can wipe them.
 * Caller is responsible for hydrating the toolbars on symbol switch and
 * for persisting on change (via the toolbars' onChange callbacks).
 *
 * Writes are debounced (60ms) per key so a burst of changes (e.g. dragging
 * a slider, batch-adding indicators) collapses into a single write.
 */
(function (global) {
    'use strict';

    const PREFIX = 't4chart.layout.';
    const DEBOUNCE_MS = 60;

    function safeJSON(parse, value, fallback) {
        try { return parse ? JSON.parse(value) : JSON.stringify(value); }
        catch (_) { return fallback; }
    }

    class LayoutStore {
        constructor({ prefix = PREFIX, storage = global.localStorage } = {}) {
            this.prefix = prefix;
            this.storage = storage;
            this._pending = new Map(); // key -> timeoutId
        }

        _key(symbolId) {
            return `${this.prefix}${symbolId}`;
        }

        load(symbolId) {
            if (!symbolId || !this.storage) return { indicators: [], drawings: [] };
            const raw = this.storage.getItem(this._key(symbolId));
            if (!raw) return { indicators: [], drawings: [] };
            const parsed = safeJSON(true, raw, null);
            if (!parsed || typeof parsed !== 'object') return { indicators: [], drawings: [] };
            return {
                indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
                drawings: Array.isArray(parsed.drawings) ? parsed.drawings : []
            };
        }

        save(symbolId, layout) {
            if (!symbolId || !this.storage) return;
            const key = this._key(symbolId);
            const prev = this._pending.get(key);
            if (prev) clearTimeout(prev);
            const t = setTimeout(() => {
                this._pending.delete(key);
                try {
                    const payload = {
                        indicators: Array.isArray(layout?.indicators) ? layout.indicators : [],
                        drawings: Array.isArray(layout?.drawings) ? layout.drawings : []
                    };
                    this.storage.setItem(key, JSON.stringify(payload));
                } catch (err) {
                    console.warn('[LayoutStore] save failed:', err);
                }
            }, DEBOUNCE_MS);
            this._pending.set(key, t);
        }

        clear(symbolId) {
            if (!symbolId || !this.storage) return;
            try { this.storage.removeItem(this._key(symbolId)); } catch (_) { /* ignore */ }
        }
    }

    global.ChartLayoutStore = LayoutStore;
})(window);
