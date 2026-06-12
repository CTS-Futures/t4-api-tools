/**
 * chart/EventBus.js
 *
 * Tiny synchronous pub/sub. Used by ChartService to broadcast pipeline
 * events (bars:loaded, bar:update, bar:close, symbol:changed, ...) to any
 * number of registered chart features without coupling the host to them.
 *
 * Handlers run in registration order. A throwing handler is logged but does
 * not stop subsequent handlers (defensive — one bad indicator shouldn't kill
 * the chart).
 */
(function (global) {
    'use strict';

    class EventBus {
        constructor() {
            this._handlers = new Map(); // event -> Set<fn>
        }

        on(event, fn) {
            if (typeof fn !== 'function') return () => {};
            let set = this._handlers.get(event);
            if (!set) {
                set = new Set();
                this._handlers.set(event, set);
            }
            set.add(fn);
            return () => this.off(event, fn);
        }

        off(event, fn) {
            const set = this._handlers.get(event);
            if (set) set.delete(fn);
        }

        emit(event, payload) {
            const set = this._handlers.get(event);
            if (!set || set.size === 0) return;
            for (const fn of set) {
                try {
                    fn(payload);
                } catch (err) {
                    if (global.console) console.error(`[EventBus] handler for "${event}" threw:`, err);
                }
            }
        }

        clear() {
            this._handlers.clear();
        }
    }

    global.ChartEventBus = EventBus;
})(window);
