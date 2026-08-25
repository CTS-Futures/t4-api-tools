/**
 * chart/features/PositionLine.js
 *
 * Feature module: draws a single horizontal line for the active market's
 * net position average price. Pass net=0 or avgPrice=null to clear.
 */
(function (global) {
    'use strict';

    class PositionLineFeature {
        constructor() {
            this.id = 'position-line';
            this._series = null;
            this._line = null;        // filled net position: { line, price, net }
            this._workingLine = null; // working-but-flat position: { line, price, wb, ws }
            this._unsubSymbol = null;
        }

        attach(ctx) {
            this._series = ctx.candleSeries;
            this._unsubSymbol = ctx.bus.on('symbol:changed', () => this.clear());
        }

        detach() {
            this.clear();
            if (this._unsubSymbol) this._unsubSymbol();
            this._series = null;
        }

        set(avgPrice, net) {
            if (!this._series) return;
            const want = Number.isFinite(avgPrice) && avgPrice > 0 && Number(net) !== 0;
            if (!want) return this.clear();

            const LS = global.LightweightCharts?.LineStyle;
            const solid = LS?.Solid ?? 0;
            const title = `Pos ${net > 0 ? '+' : ''}${net}`;

            if (this._line) {
                this._line.line.applyOptions({ price: avgPrice, title });
                this._line.price = avgPrice;
                this._line.net = net;
            } else {
                const line = this._series.createPriceLine({
                    price: avgPrice,
                    color: '#f0b90b',
                    lineWidth: 2,
                    lineStyle: solid,
                    axisLabelVisible: true,
                    title
                });
                this._line = { line, price: avgPrice, net };
            }
        }

        // Draws a distinct line for a "working" position: one that has working
        // orders (workingBuys/workingSells) but no net filled position, so it
        // has no average open price. We anchor it at `price` — the caller passes
        // the volume-weighted price of the working orders. Pass price=null or
        // wb+ws=0 to clear it.
        setWorking(price, wb, ws) {
            if (!this._series) return;
            const want = Number.isFinite(price) && price > 0 && (Number(wb) || Number(ws));
            if (!want) return this.clearWorking();

            const LS = global.LightweightCharts?.LineStyle;
            const dotted = LS?.Dotted ?? 1;
            const title = `Working ${Number(wb) ? `+${wb}` : ''}${Number(ws) ? ` -${ws}` : ''}`.trim();

            if (this._workingLine) {
                this._workingLine.line.applyOptions({ price, title });
                this._workingLine.price = price;
                this._workingLine.wb = wb;
                this._workingLine.ws = ws;
            } else {
                const line = this._series.createPriceLine({
                    price,
                    color: '#c79100',
                    lineWidth: 1,
                    lineStyle: dotted,
                    axisLabelVisible: true,
                    title
                });
                this._workingLine = { line, price, wb, ws };
            }
        }

        clearWorking() {
            if (this._workingLine && this._series) {
                try { this._series.removePriceLine(this._workingLine.line); } catch (_) { /* gone */ }
            }
            this._workingLine = null;
        }

        clear() {
            if (this._line && this._series) {
                try { this._series.removePriceLine(this._line.line); } catch (_) { /* gone */ }
            }
            this._line = null;
            this.clearWorking();
        }
    }

    global.ChartFeatures = global.ChartFeatures || {};
    global.ChartFeatures.PositionLine = PositionLineFeature;
})(window);
