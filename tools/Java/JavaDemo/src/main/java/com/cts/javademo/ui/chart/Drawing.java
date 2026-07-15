package com.cts.javademo.ui.chart;

/**
 * A user drawing anchored to <b>(timeMs, price)</b> rather than pixels, so it
 * survives pan / zoom / history-prepend / interval reload. Mirrors the CPPDemo
 * {@code Drawing} struct.
 */
public record Drawing(Kind kind, long t1, double p1, long t2, double p2) {

    public enum Kind { TREND, HLINE }
}
