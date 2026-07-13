package com.cts.javademo.ui.chart;

import com.cts.javademo.state.AppState;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure technical-indicator math, ported from the CPPDemo {@code ChartWidget}.
 *
 * <p>Every series is computed over the <b>full</b> candle history (not just the
 * visible slice) and returned aligned to the candle indices, with {@link Double#NaN}
 * for warmup gaps — this is what makes the leftmost visible value correct.
 */
public final class Indicators {

    private Indicators() {
    }

    public static double[] sma(List<AppState.Candle> c, int period) {
        double[] out = nan(c.size());
        double sum = 0;
        for (int i = 0; i < c.size(); i++) {
            sum += c.get(i).close;
            if (i >= period) {
                sum -= c.get(i - period).close;
            }
            if (i >= period - 1) {
                out[i] = sum / period;
            }
        }
        return out;
    }

    public static double[] ema(List<AppState.Candle> c, int period) {
        double[] out = nan(c.size());
        if (c.size() < period) {
            return out;
        }
        double k = 2.0 / (period + 1);
        double seed = 0;
        for (int i = 0; i < period; i++) {
            seed += c.get(i).close;
        }
        double prev = seed / period;
        out[period - 1] = prev;
        for (int i = period; i < c.size(); i++) {
            prev = c.get(i).close * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    public static double[] vwap(List<AppState.Candle> c) {
        double[] out = nan(c.size());
        double cumPV = 0;
        double cumV = 0;
        for (int i = 0; i < c.size(); i++) {
            AppState.Candle b = c.get(i);
            double typical = (b.high + b.low + b.close) / 3.0;
            cumPV += typical * b.volume;
            cumV += b.volume;
            if (cumV > 0) {
                out[i] = cumPV / cumV;
            }
        }
        return out;
    }

    /** @return {upper, mid, lower} each aligned to candle indices. */
    public static double[][] bollinger(List<AppState.Candle> c, int period, double k) {
        double[] mid = sma(c, period);
        double[] upper = nan(c.size());
        double[] lower = nan(c.size());
        for (int i = period - 1; i < c.size(); i++) {
            double mean = mid[i];
            double var = 0;
            for (int j = i - period + 1; j <= i; j++) {
                double d = c.get(j).close - mean;
                var += d * d;
            }
            double sd = Math.sqrt(var / period);
            upper[i] = mean + k * sd;
            lower[i] = mean - k * sd;
        }
        return new double[][]{upper, mid, lower};
    }

    /** Wilder-smoothed RSI, pinned to 0..100. */
    public static double[] rsi(List<AppState.Candle> c, int period) {
        double[] out = nan(c.size());
        if (c.size() <= period) {
            return out;
        }
        double gain = 0;
        double loss = 0;
        for (int i = 1; i <= period; i++) {
            double d = c.get(i).close - c.get(i - 1).close;
            if (d >= 0) {
                gain += d;
            } else {
                loss -= d;
            }
        }
        double avgGain = gain / period;
        double avgLoss = loss / period;
        out[period] = rsiFrom(avgGain, avgLoss);
        for (int i = period + 1; i < c.size(); i++) {
            double d = c.get(i).close - c.get(i - 1).close;
            double g = d > 0 ? d : 0;
            double l = d < 0 ? -d : 0;
            avgGain = (avgGain * (period - 1) + g) / period;
            avgLoss = (avgLoss * (period - 1) + l) / period;
            out[i] = rsiFrom(avgGain, avgLoss);
        }
        return out;
    }

    private static double rsiFrom(double avgGain, double avgLoss) {
        if (avgLoss == 0) {
            return 100;
        }
        double rs = avgGain / avgLoss;
        return 100 - 100 / (1 + rs);
    }

    /** @return {macd, signal, histogram}. */
    public static double[][] macd(List<AppState.Candle> c, int fast, int slow, int signal) {
        double[] emaFast = ema(c, fast);
        double[] emaSlow = ema(c, slow);
        double[] macd = nan(c.size());
        for (int i = 0; i < c.size(); i++) {
            if (!Double.isNaN(emaFast[i]) && !Double.isNaN(emaSlow[i])) {
                macd[i] = emaFast[i] - emaSlow[i];
            }
        }
        // Signal = EMA(signal) of the macd line, seeded by SMA over the first valid window.
        double[] sig = nan(c.size());
        int firstValid = -1;
        for (int i = 0; i < c.size(); i++) {
            if (!Double.isNaN(macd[i])) {
                firstValid = i;
                break;
            }
        }
        if (firstValid >= 0 && firstValid + signal <= c.size()) {
            double k = 2.0 / (signal + 1);
            double seed = 0;
            for (int i = firstValid; i < firstValid + signal; i++) {
                seed += macd[i];
            }
            double prev = seed / signal;
            sig[firstValid + signal - 1] = prev;
            for (int i = firstValid + signal; i < c.size(); i++) {
                prev = macd[i] * k + prev * (1 - k);
                sig[i] = prev;
            }
        }
        double[] hist = nan(c.size());
        for (int i = 0; i < c.size(); i++) {
            if (!Double.isNaN(macd[i]) && !Double.isNaN(sig[i])) {
                hist[i] = macd[i] - sig[i];
            }
        }
        return new double[][]{macd, sig, hist};
    }

    /** Heikin-Ashi transform (recursive), returned as a new candle list of the same length. */
    public static List<AppState.Candle> heikinAshi(List<AppState.Candle> c) {
        List<AppState.Candle> out = new ArrayList<>(c.size());
        double prevOpen = 0;
        double prevClose = 0;
        for (int i = 0; i < c.size(); i++) {
            AppState.Candle b = c.get(i);
            double haClose = (b.open + b.high + b.low + b.close) / 4.0;
            double haOpen = i == 0 ? (b.open + b.close) / 2.0 : (prevOpen + prevClose) / 2.0;
            double haHigh = Math.max(b.high, Math.max(haOpen, haClose));
            double haLow = Math.min(b.low, Math.min(haOpen, haClose));
            out.add(new AppState.Candle(b.timeMs, haOpen, haHigh, haLow, haClose, b.volume));
            prevOpen = haOpen;
            prevClose = haClose;
        }
        return out;
    }

    private static double[] nan(int n) {
        double[] a = new double[n];
        java.util.Arrays.fill(a, Double.NaN);
        return a;
    }
}
