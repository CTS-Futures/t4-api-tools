package com.cts.javademo.ui.chart;

import com.cts.javademo.state.AppState;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.util.List;

/**
 * Renders the price-pane indicator overlays (SMA/EMA/VWAP/Bollinger) and the
 * stacked oscillator sub-panes (RSI/MACD). Values come from {@link Indicators}
 * (computed over full history); only the visible slice is drawn, breaking
 * polylines at {@link Double#NaN}.
 */
final class ChartIndicators {

    private static final Color SMA20 = new Color(0xf2, 0xb6, 0x36);
    private static final Color SMA50 = new Color(0x5b, 0x9c, 0xf5);
    private static final Color EMA20 = new Color(0xc9, 0x6a, 0xf2);
    private static final Color VWAP = new Color(0x4a, 0xd6, 0xc4);
    private static final Color BOLL = new Color(0x9a, 0x9f, 0xa8);
    private static final Color RSI_C = new Color(0xe0, 0xa8, 0x40);
    private static final Color MACD_C = new Color(0x5b, 0x9c, 0xf5);
    private static final Color SIG_C = new Color(0xef, 0x53, 0x50);

    private ChartIndicators() {
    }

    static void paintPricePane(ChartCanvas cv, Graphics2D g, int firstIdx, int lastIdx) {
        ChartModel m = cv.model();
        List<AppState.Candle> candles = cv.candles();
        int legendY = cv.priceTop() + 44;

        if (m.has(ChartModel.Indicator.BOLLINGER)) {
            double[][] bb = Indicators.bollinger(candles, 20, 2.0);
            drawBand(cv, g, bb[0], bb[2], firstIdx, lastIdx, new Color(0x9a, 0x9f, 0xa8, 36));
            drawLine(cv, g, bb[0], firstIdx, lastIdx, BOLL, 1f);
            drawLine(cv, g, bb[2], firstIdx, lastIdx, BOLL, 1f);
            legendY = legend(g, cv, "BB(20,2)", BOLL, legendY);
        }
        if (m.has(ChartModel.Indicator.SMA20)) {
            drawLine(cv, g, Indicators.sma(candles, 20), firstIdx, lastIdx, SMA20, 1.4f);
            legendY = legend(g, cv, "SMA 20", SMA20, legendY);
        }
        if (m.has(ChartModel.Indicator.SMA50)) {
            drawLine(cv, g, Indicators.sma(candles, 50), firstIdx, lastIdx, SMA50, 1.4f);
            legendY = legend(g, cv, "SMA 50", SMA50, legendY);
        }
        if (m.has(ChartModel.Indicator.EMA20)) {
            drawLine(cv, g, Indicators.ema(candles, 20), firstIdx, lastIdx, EMA20, 1.4f);
            legendY = legend(g, cv, "EMA 20", EMA20, legendY);
        }
        if (m.has(ChartModel.Indicator.VWAP)) {
            drawLine(cv, g, Indicators.vwap(candles), firstIdx, lastIdx, VWAP, 1.4f);
            legendY = legend(g, cv, "VWAP", VWAP, legendY);
        }
    }

    static void paintOscillator(ChartCanvas cv, Graphics2D g, ChartCanvas.PaneRect p,
                                int firstIdx, int lastIdx) {
        List<AppState.Candle> candles = cv.candles();
        g.setColor(ChartCanvas.GRID);
        g.drawLine(cv.plotLeft(), p.top, cv.plotRight(), p.top);

        if (p.kind == ChartModel.Indicator.RSI) {
            double[] rsi = Indicators.rsi(candles, 14);
            // Reference lines at 30 / 70.
            g.setColor(new Color(0x33, 0x36, 0x40));
            int y70 = paneY(p, 70, 0, 100);
            int y30 = paneY(p, 30, 0, 100);
            g.drawLine(cv.plotLeft(), y70, cv.plotRight(), y70);
            g.drawLine(cv.plotLeft(), y30, cv.plotRight(), y30);
            drawPaneLine(cv, g, p, rsi, firstIdx, lastIdx, 0, 100, RSI_C);
            label(g, cv, p, "RSI(14)", RSI_C);
        } else if (p.kind == ChartModel.Indicator.MACD) {
            double[][] macd = Indicators.macd(candles, 12, 26, 9);
            double min = 0;
            double max = 0;
            for (int i = firstIdx; i <= lastIdx; i++) {
                for (double[] s : macd) {
                    if (!Double.isNaN(s[i])) {
                        min = Math.min(min, s[i]);
                        max = Math.max(max, s[i]);
                    }
                }
            }
            if (min == max) {
                min -= 1;
                max += 1;
            }
            int zeroY = paneY(p, 0, min, max);
            g.setColor(new Color(0x33, 0x36, 0x40));
            g.drawLine(cv.plotLeft(), zeroY, cv.plotRight(), zeroY);
            // Histogram.
            double bw = Math.max(1, cv.model().candleWidth - 2);
            for (int i = firstIdx; i <= lastIdx; i++) {
                if (Double.isNaN(macd[2][i])) {
                    continue;
                }
                int x = (int) cv.xForIndex(i);
                int y = paneY(p, macd[2][i], min, max);
                g.setColor(macd[2][i] >= 0 ? new Color(0x26, 0xa6, 0x9a, 150) : new Color(0xef, 0x53, 0x50, 150));
                int top = Math.min(y, zeroY);
                g.fillRect(x - (int) (bw / 2), top, (int) bw, Math.max(1, Math.abs(y - zeroY)));
            }
            drawPaneLine(cv, g, p, macd[0], firstIdx, lastIdx, min, max, MACD_C);
            drawPaneLine(cv, g, p, macd[1], firstIdx, lastIdx, min, max, SIG_C);
            label(g, cv, p, "MACD(12,26,9)", MACD_C);
        }
    }

    // --- drawing helpers ---

    private static void drawLine(ChartCanvas cv, Graphics2D g, double[] v, int firstIdx, int lastIdx,
                                 Color color, float w) {
        g.setColor(color);
        g.setStroke(new BasicStroke(w));
        int prevX = 0;
        int prevY = 0;
        boolean have = false;
        for (int i = firstIdx; i <= lastIdx; i++) {
            if (Double.isNaN(v[i])) {
                have = false;
                continue;
            }
            int x = (int) cv.xForIndex(i);
            int y = (int) cv.yForPrice(v[i]);
            if (have) {
                g.drawLine(prevX, prevY, x, y);
            }
            prevX = x;
            prevY = y;
            have = true;
        }
    }

    private static void drawBand(ChartCanvas cv, Graphics2D g, double[] upper, double[] lower,
                                 int firstIdx, int lastIdx, Color fill) {
        java.awt.Polygon poly = new java.awt.Polygon();
        int added = 0;
        for (int i = firstIdx; i <= lastIdx; i++) {
            if (Double.isNaN(upper[i])) {
                continue;
            }
            poly.addPoint((int) cv.xForIndex(i), (int) cv.yForPrice(upper[i]));
            added++;
        }
        for (int i = lastIdx; i >= firstIdx; i--) {
            if (Double.isNaN(lower[i])) {
                continue;
            }
            poly.addPoint((int) cv.xForIndex(i), (int) cv.yForPrice(lower[i]));
        }
        if (added > 1) {
            g.setColor(fill);
            g.fillPolygon(poly);
        }
    }

    private static void drawPaneLine(ChartCanvas cv, Graphics2D g, ChartCanvas.PaneRect p, double[] v,
                                     int firstIdx, int lastIdx, double min, double max, Color color) {
        g.setColor(color);
        g.setStroke(new BasicStroke(1.2f));
        int prevX = 0;
        int prevY = 0;
        boolean have = false;
        for (int i = firstIdx; i <= lastIdx; i++) {
            if (Double.isNaN(v[i])) {
                have = false;
                continue;
            }
            int x = (int) cv.xForIndex(i);
            int y = paneY(p, v[i], min, max);
            if (have) {
                g.drawLine(prevX, prevY, x, y);
            }
            prevX = x;
            prevY = y;
            have = true;
        }
    }

    private static int paneY(ChartCanvas.PaneRect p, double value, double min, double max) {
        double frac = (max - min) == 0 ? 0.5 : (value - min) / (max - min);
        return (int) (p.bottom - frac * (p.bottom - p.top));
    }

    private static int legend(Graphics2D g, ChartCanvas cv, String text, Color color, int y) {
        g.setColor(color);
        g.setFont(g.getFont().deriveFont(Font.PLAIN, 10f));
        g.drawString(text, cv.plotLeft() + 4, y);
        return y + 12;
    }

    private static void label(Graphics2D g, ChartCanvas cv, ChartCanvas.PaneRect p, String text, Color color) {
        g.setColor(color);
        g.setFont(g.getFont().deriveFont(9f));
        g.drawString(text, cv.plotLeft() + 4, p.top + 11);
    }
}
