package com.cts.javademo.ui.chart;

import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;

import javax.swing.JPanel;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.Stroke;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Custom-painted chart canvas — the Swing port of the CPPDemo {@code ChartWidget}.
 *
 * <p>Owns the paint pipeline and mouse-interaction state machine. Market data
 * (candles, orders, positions, fills, depth) lives in {@link AppState}; this
 * canvas snapshots the candle list on each refresh and reads the rest at paint
 * time. View state (scroll/zoom/type/tool/indicators) lives in {@link ChartModel}.
 */
public final class ChartCanvas extends JPanel {

    // Layout margins (px).
    private static final int M_LEFT = 8;
    private static final int M_RIGHT = 64;
    private static final int M_TOP = 8;
    private static final int M_BOTTOM = 22;

    // Palette (matches the old CandleChartPanel / CPPDemo dark theme).
    static final Color BG = new Color(0x1e, 0x1e, 0x24);
    static final Color GRID = new Color(0x33, 0x36, 0x40);
    static final Color UP = new Color(0x26, 0xa6, 0x9a);
    static final Color DOWN = new Color(0xef, 0x53, 0x50);
    static final Color TEXT = new Color(0xc8, 0xcc, 0xd4);
    static final Color MUTED = new Color(0x8a, 0x8f, 0x99);
    static final Color CROSS = new Color(0x9a, 0x9f, 0xa8);

    private static final DateTimeFormatter FMT_DT =
            DateTimeFormatter.ofPattern("MM-dd HH:mm").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter FMT_TIME =
            DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneOffset.UTC);

    private final AppState state;
    private final T4Client client;
    private final ChartModel model;

    private List<AppState.Candle> candles = new ArrayList<>();
    private int lastGeneration = -1;
    private int prevCount;
    private long prevOldest = Long.MAX_VALUE;

    private Runnable onNearOldest;

    // Cached geometry/scale from the last paint (used by mouse handlers + overlays).
    private int plotLeft, plotRight, priceTop, priceBottom;
    private double vMin, vMax;

    // Mouse state.
    private int mouseX = -1, mouseY = -1;
    private boolean inside;
    private double dragStartFirst;
    private int dragStartX;
    private boolean panning;

    // Sub-pane bounds computed each paint (for oscillators added in M2).
    List<PaneRect> subPanes = new ArrayList<>();

    /** A stacked bottom sub-pane (volume / RSI / MACD). */
    static final class PaneRect {
        final ChartModel.Indicator kind; // null == volume
        final int top;
        final int bottom;

        PaneRect(ChartModel.Indicator kind, int top, int bottom) {
            this.kind = kind;
            this.top = top;
            this.bottom = bottom;
        }
    }

    public ChartCanvas(AppState state, T4Client client, ChartModel model) {
        this.state = state;
        this.client = client;
        this.model = model;
        setBackground(BG);
        setFocusable(true);
        MouseHandler h = new MouseHandler();
        addMouseListener(h);
        addMouseMotionListener(h);
        addMouseWheelListener(h);
    }

    public void setOnNearOldest(Runnable r) {
        this.onNearOldest = r;
    }

    /** Update the candle snapshot; a new generation re-locks the view to the latest. */
    public void setData(List<AppState.Candle> candles, int generation) {
        this.candles = candles;
        if (generation != lastGeneration) {
            lastGeneration = generation;
            model.follow = true;
        } else if (!candles.isEmpty() && candles.size() > prevCount
                && candles.get(0).timeMs < prevOldest && !model.follow) {
            // Older history was prepended — keep the viewport steady over existing bars.
            int prepended = 0;
            for (AppState.Candle c : candles) {
                if (c.timeMs < prevOldest) {
                    prepended++;
                } else {
                    break;
                }
            }
            model.firstVisible += prepended;
        }
        prevCount = candles.size();
        if (!candles.isEmpty()) {
            prevOldest = candles.get(0).timeMs;
        }
        repaint();
    }

    List<AppState.Candle> candles() {
        return candles;
    }

    // =======================================================================
    // Coordinate mapping (public for overlays)
    // =======================================================================

    double visibleCount() {
        return Math.max(1, (plotRight - plotLeft) / model.candleWidth);
    }

    double xForIndex(double i) {
        return plotLeft + (i - model.firstVisible + 0.5) * model.candleWidth;
    }

    double indexForX(double x) {
        return model.firstVisible + (x - plotLeft) / model.candleWidth - 0.5;
    }

    double yForPrice(double price) {
        double v = model.logScale ? Math.log10(Math.max(price, 1e-9)) : price;
        double frac = (vMax - vMin) == 0 ? 0.5 : (v - vMin) / (vMax - vMin);
        return priceBottom - frac * (priceBottom - priceTop);
    }

    double priceForY(int y) {
        double frac = (priceBottom - y) / (double) (priceBottom - priceTop);
        double v = vMin + frac * (vMax - vMin);
        return model.logScale ? Math.pow(10, v) : v;
    }

    long timeForX(int x) {
        if (candles.isEmpty()) {
            return 0;
        }
        int idx = (int) Math.round(indexForX(x));
        idx = Math.max(0, Math.min(candles.size() - 1, idx));
        return candles.get(idx).timeMs;
    }

    /** Fractional candle index for a timestamp (binary search + interpolation by interval). */
    double indexForTime(long t) {
        int n = candles.size();
        if (n == 0) {
            return 0;
        }
        long first = candles.get(0).timeMs;
        long last = candles.get(n - 1).timeMs;
        long intervalMs = Math.max(1, state.read(s -> s.chartIntervalSecs) * 1000);
        if (t <= first) {
            return (t - first) / (double) intervalMs;
        }
        if (t >= last) {
            return (n - 1) + (t - last) / (double) intervalMs;
        }
        int lo = 0;
        int hi = n - 1;
        while (lo + 1 < hi) {
            int mid = (lo + hi) >>> 1;
            if (candles.get(mid).timeMs <= t) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        long tl = candles.get(lo).timeMs;
        long th = candles.get(hi).timeMs;
        double frac = th == tl ? 0 : (t - tl) / (double) (th - tl);
        return lo + frac;
    }

    double xForTime(long t) {
        return xForIndex(indexForTime(t));
    }

    int plotLeft() {
        return plotLeft;
    }

    int plotRight() {
        return plotRight;
    }

    int priceTop() {
        return priceTop;
    }

    int priceBottom() {
        return priceBottom;
    }

    AppState state() {
        return state;
    }

    T4Client client() {
        return client;
    }

    ChartModel model() {
        return model;
    }

    int decimals() {
        return Math.max(0, state.read(s -> s.marketDecimals));
    }

    // =======================================================================
    // Paint
    // =======================================================================

    @Override
    protected void paintComponent(Graphics g0) {
        super.paintComponent(g0);
        Graphics2D g = (Graphics2D) g0;
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        int w = getWidth();
        int h = getHeight();
        computeLayout(w, h);

        if (candles.isEmpty()) {
            g.setColor(TEXT);
            g.setFont(getFont().deriveFont(13f));
            g.drawString("No chart data — pick a contract or wait for load.", 16, h / 2);
            return;
        }

        // Lock to the latest bars when following.
        double vis = visibleCount();
        double maxFirst = Math.max(0, candles.size() - vis);
        if (model.follow) {
            model.firstVisible = maxFirst;
        } else {
            model.firstVisible = Math.max(0, Math.min(model.firstVisible, maxFirst));
        }

        int firstIdx = Math.max(0, (int) Math.floor(model.firstVisible));
        int lastIdx = Math.min(candles.size() - 1, (int) Math.ceil(model.firstVisible + vis));

        computePriceScale(firstIdx, lastIdx);
        drawGridAndAxis(g);
        drawSeries(g, firstIdx, lastIdx);
        drawLastPriceLine(g);
        paintIndicators(g, firstIdx, lastIdx); // no-op until M2
        drawSubPanes(g, firstIdx, lastIdx);
        paintOverlays(g);                       // no-op until M4
        drawCrosshairAndLegend(g, firstIdx, lastIdx);

        // Page older history when the viewport nears the oldest loaded bar.
        if (model.firstVisible <= vis && onNearOldest != null) {
            onNearOldest.run();
        }
    }

    private void computeLayout(int w, int h) {
        plotLeft = M_LEFT;
        plotRight = w - M_RIGHT;
        priceTop = M_TOP;
        int fullBottom = h - M_BOTTOM;

        subPanes = new ArrayList<>();
        List<ChartModel.Indicator> oscillators = new ArrayList<>();
        if (model.has(ChartModel.Indicator.RSI)) {
            oscillators.add(ChartModel.Indicator.RSI);
        }
        if (model.has(ChartModel.Indicator.MACD)) {
            oscillators.add(ChartModel.Indicator.MACD);
        }
        int paneCount = (model.showVolume ? 1 : 0) + oscillators.size();

        if (paneCount == 0) {
            priceBottom = fullBottom;
            return;
        }
        int gap = 6;
        double totalFrac = Math.min(0.55, 0.2 * paneCount);
        int region = (int) ((fullBottom - priceTop) * totalFrac);
        int eachH = Math.max(24, (region - gap * paneCount) / paneCount);
        priceBottom = fullBottom - region;

        int y = priceBottom + gap;
        if (model.showVolume) {
            subPanes.add(new PaneRect(null, y, y + eachH));
            y += eachH + gap;
        }
        for (ChartModel.Indicator osc : oscillators) {
            subPanes.add(new PaneRect(osc, y, y + eachH));
            y += eachH + gap;
        }
    }

    private void computePriceScale(int firstIdx, int lastIdx) {
        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        boolean closeOnly = model.chartType == ChartModel.ChartType.LINE
                || model.chartType == ChartModel.ChartType.AREA;
        List<AppState.Candle> src = model.chartType == ChartModel.ChartType.HEIKIN_ASHI
                ? Indicators.heikinAshi(candles) : candles;
        for (int i = firstIdx; i <= lastIdx; i++) {
            AppState.Candle c = src.get(i);
            if (closeOnly) {
                min = Math.min(min, c.close);
                max = Math.max(max, c.close);
            } else {
                min = Math.min(min, c.low);
                max = Math.max(max, c.high);
            }
        }
        if (min == Double.MAX_VALUE) {
            min = 0;
            max = 1;
        }
        if (min == max) {
            min -= 1;
            max += 1;
        }
        double pad = (max - min) * 0.05;
        min -= pad;
        max += pad;
        if (model.logScale && min <= 0) {
            min = Math.max(1e-6, max / 1000);
        }
        vMin = model.logScale ? Math.log10(min) : min;
        vMax = model.logScale ? Math.log10(max) : max;
    }

    private void drawGridAndAxis(Graphics2D g) {
        g.setFont(getFont().deriveFont(10f));
        for (int i = 0; i <= 5; i++) {
            int y = priceTop + (priceBottom - priceTop) * i / 5;
            g.setColor(GRID);
            g.drawLine(plotLeft, y, plotRight, y);
            double price = priceForY(y);
            g.setColor(MUTED);
            g.drawString(fmtPrice(price), plotRight + 4, y + 4);
        }
    }

    private void drawSeries(Graphics2D g, int firstIdx, int lastIdx) {
        List<AppState.Candle> src = model.chartType == ChartModel.ChartType.HEIKIN_ASHI
                ? Indicators.heikinAshi(candles) : candles;
        double bw = Math.max(1, model.candleWidth - 2);

        switch (model.chartType) {
            case LINE, AREA -> {
                g.setColor(UP);
                g.setStroke(new BasicStroke(1.4f));
                int[] xs = new int[lastIdx - firstIdx + 1];
                int[] ys = new int[lastIdx - firstIdx + 1];
                int n = 0;
                for (int i = firstIdx; i <= lastIdx; i++) {
                    xs[n] = (int) xForIndex(i);
                    ys[n] = (int) yForPrice(src.get(i).close);
                    n++;
                }
                if (model.chartType == ChartModel.ChartType.AREA) {
                    int[] fx = new int[n + 2];
                    int[] fy = new int[n + 2];
                    System.arraycopy(xs, 0, fx, 0, n);
                    System.arraycopy(ys, 0, fy, 0, n);
                    fx[n] = xs[n - 1];
                    fy[n] = priceBottom;
                    fx[n + 1] = xs[0];
                    fy[n + 1] = priceBottom;
                    g.setColor(new Color(0x26, 0xa6, 0x9a, 48));
                    g.fillPolygon(fx, fy, n + 2);
                    g.setColor(UP);
                }
                g.drawPolyline(xs, ys, n);
            }
            default -> {
                for (int i = firstIdx; i <= lastIdx; i++) {
                    AppState.Candle c = src.get(i);
                    int cx = (int) xForIndex(i);
                    boolean up = c.close >= c.open;
                    g.setColor(up ? UP : DOWN);
                    int yHigh = (int) yForPrice(c.high);
                    int yLow = (int) yForPrice(c.low);
                    int yOpen = (int) yForPrice(c.open);
                    int yClose = (int) yForPrice(c.close);
                    if (model.chartType == ChartModel.ChartType.OHLC) {
                        g.setStroke(new BasicStroke(1.2f));
                        g.drawLine(cx, yHigh, cx, yLow);
                        g.drawLine(cx - (int) (bw / 2), yOpen, cx, yOpen);
                        g.drawLine(cx, yClose, cx + (int) (bw / 2), yClose);
                    } else {
                        g.setStroke(new BasicStroke(1f));
                        g.drawLine(cx, yHigh, cx, yLow);
                        int bodyTop = Math.min(yOpen, yClose);
                        int bodyH = Math.max(1, Math.abs(yClose - yOpen));
                        g.fillRect(cx - (int) (bw / 2), bodyTop, (int) bw, bodyH);
                    }
                }
            }
        }
    }

    private void drawLastPriceLine(Graphics2D g) {
        AppState.Candle last = candles.get(candles.size() - 1);
        boolean up = last.close >= last.open;
        int y = (int) yForPrice(last.close);
        if (y < priceTop || y > priceBottom) {
            return;
        }
        g.setColor(up ? UP : DOWN);
        g.setStroke(dashed());
        g.drawLine(plotLeft, y, plotRight, y);
        g.setStroke(new BasicStroke(1f));
        String label = fmtPrice(last.close);
        g.fillRect(plotRight, y - 8, M_RIGHT, 16);
        g.setColor(Color.WHITE);
        g.setFont(getFont().deriveFont(Font.BOLD, 10f));
        g.drawString(label, plotRight + 3, y + 4);
    }

    /** Overridden in M2; kept as a hook so the paint pipeline is stable. */
    private void paintIndicators(Graphics2D g, int firstIdx, int lastIdx) {
        ChartIndicators.paintPricePane(this, g, firstIdx, lastIdx);
    }

    private void drawSubPanes(Graphics2D g, int firstIdx, int lastIdx) {
        for (PaneRect p : subPanes) {
            if (p.kind == null) {
                drawVolumePane(g, p, firstIdx, lastIdx);
            } else {
                ChartIndicators.paintOscillator(this, g, p, firstIdx, lastIdx);
            }
        }
    }

    private void drawVolumePane(Graphics2D g, PaneRect p, int firstIdx, int lastIdx) {
        long maxVol = 1;
        for (int i = firstIdx; i <= lastIdx; i++) {
            maxVol = Math.max(maxVol, candles.get(i).volume);
        }
        double bw = Math.max(1, model.candleWidth - 2);
        int paneH = p.bottom - p.top;
        for (int i = firstIdx; i <= lastIdx; i++) {
            AppState.Candle c = candles.get(i);
            int cx = (int) xForIndex(i);
            int barH = (int) (paneH * (c.volume / (double) maxVol));
            boolean up = c.close >= c.open;
            g.setColor(up ? new Color(0x26, 0xa6, 0x9a, 140) : new Color(0xef, 0x53, 0x50, 140));
            g.fillRect(cx - (int) (bw / 2), p.bottom - barH, (int) bw, barH);
        }
        g.setColor(MUTED);
        g.setFont(getFont().deriveFont(9f));
        g.drawString("Vol " + humanVol(maxVol), plotRight - 70, p.top + 10);
        g.setColor(GRID);
        g.drawLine(plotLeft, p.top, plotRight, p.top);
    }

    /** Overridden in M4; hook for order/position/fill overlays. */
    private void paintOverlays(Graphics2D g) {
        for (ChartOverlay o : overlays) {
            o.paint(g, this);
        }
    }

    private void drawCrosshairAndLegend(Graphics2D g, int firstIdx, int lastIdx) {
        // Legend: hovered candle, else the latest.
        int hoverIdx = inside ? (int) Math.round(indexForX(mouseX)) : candles.size() - 1;
        hoverIdx = Math.max(0, Math.min(candles.size() - 1, hoverIdx));
        AppState.Candle c = candles.get(hoverIdx);
        double prevClose = hoverIdx > 0 ? candles.get(hoverIdx - 1).close : c.open;
        double changePct = prevClose == 0 ? 0 : (c.close - prevClose) / prevClose * 100;
        g.setFont(getFont().deriveFont(Font.BOLD, 11f));
        g.setColor(c.close >= c.open ? UP : DOWN);
        String legend = String.format("O %s  H %s  L %s  C %s  V %s  %+.2f%%",
                fmtPrice(c.open), fmtPrice(c.high), fmtPrice(c.low), fmtPrice(c.close),
                humanVol(c.volume), changePct);
        g.drawString(legend, plotLeft + 4, priceTop + 14);

        g.setColor(MUTED);
        g.setFont(getFont().deriveFont(9f));
        g.drawString(candles.size() + " bars" + (model.follow ? "  (live)" : "  (scrolled)"),
                plotLeft + 4, priceTop + 28);

        // Time axis labels (first / mid / last visible).
        g.setColor(MUTED);
        g.setFont(getFont().deriveFont(10f));
        int[] ticks = {firstIdx, (firstIdx + lastIdx) / 2, lastIdx};
        for (int idx : ticks) {
            int x = (int) xForIndex(idx);
            String t = FMT_DT.format(Instant.ofEpochMilli(candles.get(idx).timeMs));
            g.drawString(t, Math.max(plotLeft, Math.min(x - 28, plotRight - 60)), getHeight() - 6);
        }

        // Crosshair.
        if (!inside) {
            return;
        }
        g.setColor(CROSS);
        g.setStroke(dashed());
        g.drawLine(mouseX, priceTop, mouseX, getHeight() - M_BOTTOM);
        if (mouseY >= priceTop && mouseY <= priceBottom) {
            g.drawLine(plotLeft, mouseY, plotRight, mouseY);
            double price = priceForY(mouseY);
            g.setStroke(new BasicStroke(1f));
            g.setColor(new Color(0x2a, 0x2d, 0x38));
            g.fillRect(plotRight, mouseY - 8, M_RIGHT, 16);
            g.setColor(TEXT);
            g.setFont(getFont().deriveFont(10f));
            g.drawString(fmtPrice(price), plotRight + 3, mouseY + 4);
        }
        g.setStroke(new BasicStroke(1f));
        // Time tag under the cursor.
        long tt = timeForX(mouseX);
        if (tt != 0) {
            String ts = FMT_TIME.format(Instant.ofEpochMilli(tt));
            int tw = g.getFontMetrics().stringWidth(ts) + 8;
            g.setColor(new Color(0x2a, 0x2d, 0x38));
            g.fillRect(mouseX - tw / 2, getHeight() - M_BOTTOM, tw, M_BOTTOM);
            g.setColor(TEXT);
            g.drawString(ts, mouseX - tw / 2 + 4, getHeight() - 6);
        }
    }

    // =======================================================================
    // Overlays registry (populated in M4/M5)
    // =======================================================================

    final List<ChartOverlay> overlays = new ArrayList<>();

    public void addOverlay(ChartOverlay o) {
        overlays.add(o);
    }

    // =======================================================================
    // Public view controls (wired to toolbar buttons)
    // =======================================================================

    public void zoomIn() {
        zoomAt(1.25, (plotLeft + plotRight) / 2);
    }

    public void zoomOut() {
        zoomAt(1 / 1.25, (plotLeft + plotRight) / 2);
    }

    public void scrollToLatest() {
        model.follow = true;
        repaint();
    }

    private void zoomAt(double factor, int anchorX) {
        double idxAtAnchor = indexForX(anchorX);
        model.candleWidth = clamp(model.candleWidth * factor, ChartModel.MIN_CW, ChartModel.MAX_CW);
        model.firstVisible = idxAtAnchor + 0.5 - (anchorX - plotLeft) / model.candleWidth;
        double maxFirst = Math.max(0, candles.size() - visibleCount());
        model.follow = model.firstVisible >= maxFirst - 0.5;
        model.firstVisible = Math.max(0, Math.min(model.firstVisible, maxFirst));
        repaint();
    }

    // =======================================================================
    // Mouse handling
    // =======================================================================

    private final class MouseHandler extends MouseAdapter {
        @Override
        public void mouseEntered(MouseEvent e) {
            inside = true;
        }

        @Override
        public void mouseExited(MouseEvent e) {
            inside = false;
            mouseX = mouseY = -1;
            repaint();
        }

        @Override
        public void mouseMoved(MouseEvent e) {
            mouseX = e.getX();
            mouseY = e.getY();
            inside = true;
            // Hover feedback: let an overlay advertise a cursor (e.g. resize over a
            // draggable order line); otherwise fall back to the default.
            Cursor hover = null;
            for (ChartOverlay o : overlays) {
                hover = o.cursorAt(e, ChartCanvas.this);
                if (hover != null) {
                    break;
                }
            }
            setCursor(hover != null ? hover : Cursor.getDefaultCursor());
            repaint();
        }

        @Override
        public void mousePressed(MouseEvent e) {
            requestFocusInWindow();
            mouseX = e.getX();
            mouseY = e.getY();
            if (e.isPopupTrigger()) {
                routePopup(e);
                return;
            }
            // Offer the press to overlays (order-line drag) before pan.
            for (ChartOverlay o : overlays) {
                if (o.onPress(e, ChartCanvas.this)) {
                    activeDrag = o;
                    return;
                }
            }
            if (e.getButton() == MouseEvent.BUTTON1 && model.tool == ChartModel.Tool.CURSOR) {
                panning = true;
                dragStartX = e.getX();
                dragStartFirst = model.firstVisible;
                model.follow = false;
                setCursor(Cursor.getPredefinedCursor(Cursor.MOVE_CURSOR));
            }
        }

        @Override
        public void mouseDragged(MouseEvent e) {
            mouseX = e.getX();
            mouseY = e.getY();
            if (activeDrag != null) {
                activeDrag.onDrag(e, ChartCanvas.this);
                repaint();
                return;
            }
            if (panning) {
                double deltaBars = (dragStartX - e.getX()) / model.candleWidth;
                model.firstVisible = dragStartFirst + deltaBars;
                double maxFirst = Math.max(0, candles.size() - visibleCount());
                if (model.firstVisible >= maxFirst) {
                    model.follow = true;
                }
                model.firstVisible = Math.max(0, Math.min(model.firstVisible, maxFirst));
            }
            repaint();
        }

        @Override
        public void mouseReleased(MouseEvent e) {
            if (e.isPopupTrigger()) {
                routePopup(e);
                return;
            }
            if (activeDrag != null) {
                activeDrag.onRelease(e, ChartCanvas.this);
                activeDrag = null;
                repaint();
                return;
            }
            panning = false;
            setCursor(Cursor.getDefaultCursor());
        }

        @Override
        public void mouseWheelMoved(java.awt.event.MouseWheelEvent e) {
            double factor = e.getWheelRotation() < 0 ? 1.1 : 1 / 1.1;
            zoomAt(factor, e.getX());
        }
    }

    private ChartOverlay activeDrag;

    private void routePopup(MouseEvent e) {
        for (ChartOverlay o : overlays) {
            if (o.onPopup(e, this)) {
                return;
            }
        }
    }

    // =======================================================================
    // Helpers
    // =======================================================================

    String fmtPrice(double v) {
        return String.format("%." + decimals() + "f", v);
    }

    private static String humanVol(long v) {
        if (v >= 1_000_000) {
            return String.format("%.1fM", v / 1_000_000.0);
        }
        if (v >= 1_000) {
            return String.format("%.1fK", v / 1_000.0);
        }
        return Long.toString(v);
    }

    private static Stroke dashed() {
        return new BasicStroke(1f, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER,
                4f, new float[]{4f, 4f}, 0f);
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
