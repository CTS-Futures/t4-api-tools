package com.cts.javademo.ui.chart;

import java.util.EnumSet;

/**
 * Mutable view/config state for the chart, separate from the market data (which
 * lives in {@code AppState}). Holds the viewport (fractional scroll position +
 * candle width), the active chart type, indicator toggles, and the drawing tool
 * mode. Mirrors the fields the CPPDemo {@code ChartWidget} keeps as members.
 */
public final class ChartModel {

    public enum ChartType { CANDLES, OHLC, LINE, AREA, HEIKIN_ASHI }

    public enum Tool { CURSOR, TRENDLINE, HLINE, MEASURE }

    public enum Indicator { SMA20, SMA50, EMA20, VWAP, BOLLINGER, RSI, MACD }

    // --- viewport ---
    /** Fractional index of the leftmost visible candle. */
    public double firstVisible;
    /** Pixels per candle (body + gap). Clamped to [MIN_CW, MAX_CW]. */
    public double candleWidth = 7;
    /** When true, the view stays locked to the newest candle. */
    public boolean follow = true;

    public static final double MIN_CW = 2;
    public static final double MAX_CW = 200;

    // --- display options ---
    public ChartType chartType = ChartType.CANDLES;
    public boolean logScale;
    public boolean showVolume = true;
    public final EnumSet<Indicator> indicators = EnumSet.noneOf(Indicator.class);

    // --- interaction ---
    public Tool tool = Tool.CURSOR;

    public boolean has(Indicator i) {
        return indicators.contains(i);
    }

    public void toggle(Indicator i, boolean on) {
        if (on) {
            indicators.add(i);
        } else {
            indicators.remove(i);
        }
    }

    /** True if any bottom oscillator sub-pane (RSI/MACD) is enabled. */
    public boolean hasOscillator() {
        return has(Indicator.RSI) || has(Indicator.MACD);
    }
}
