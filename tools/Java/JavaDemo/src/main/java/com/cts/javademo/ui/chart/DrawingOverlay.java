package com.cts.javademo.ui.chart;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.event.MouseEvent;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Drawing tools overlay: trend lines, horizontal lines, and a transient measure
 * box. Drawings are stored per market (anchored to time/price) and hit-tested for
 * right-click delete. Ports the tool logic from CPPDemo {@code ChartWidget}.
 */
public final class DrawingOverlay implements ChartOverlay {

    private static final Color LINE = new Color(0xf2, 0xd6, 0x36);
    private static final Color MEASURE_FILL = new Color(0x5b, 0x9c, 0xf5, 40);
    private static final Color MEASURE_LINE = new Color(0x5b, 0x9c, 0xf5);
    private static final int HIT_PX = 6;

    private final Map<String, List<Drawing>> byMarket = new HashMap<>();

    // Pending trend line being drawn.
    private boolean drawingTrend;
    private long t1;
    private double p1;
    private int curX, curY;

    // Transient measure box (pixel coords while dragging).
    private boolean measuring;
    private int mStartX, mStartY, mCurX, mCurY;

    private List<Drawing> list(ChartCanvas c) {
        String market = c.state().read(s -> s.marketId);
        return byMarket.computeIfAbsent(market == null ? "" : market, k -> new ArrayList<>());
    }

    public void clear(ChartCanvas c) {
        list(c).clear();
        c.repaint();
    }

    @Override
    public boolean onPress(MouseEvent e, ChartCanvas c) {
        if (e.getButton() != MouseEvent.BUTTON1) {
            return false;
        }
        switch (c.model().tool) {
            case HLINE -> {
                double price = c.priceForY(e.getY());
                list(c).add(new Drawing(Drawing.Kind.HLINE, c.timeForX(e.getX()), price, 0, price));
                c.repaint();
                return true;
            }
            case TRENDLINE -> {
                drawingTrend = true;
                t1 = c.timeForX(e.getX());
                p1 = c.priceForY(e.getY());
                curX = e.getX();
                curY = e.getY();
                return true;
            }
            case MEASURE -> {
                measuring = true;
                mStartX = mCurX = e.getX();
                mStartY = mCurY = e.getY();
                return true;
            }
            default -> {
                return false;
            }
        }
    }

    @Override
    public void onDrag(MouseEvent e, ChartCanvas c) {
        if (drawingTrend) {
            curX = e.getX();
            curY = e.getY();
        } else if (measuring) {
            mCurX = e.getX();
            mCurY = e.getY();
        }
    }

    @Override
    public void onRelease(MouseEvent e, ChartCanvas c) {
        if (drawingTrend) {
            list(c).add(new Drawing(Drawing.Kind.TREND, t1, p1, c.timeForX(e.getX()), c.priceForY(e.getY())));
            drawingTrend = false;
        }
        measuring = false; // measure is transient
        c.repaint();
    }

    @Override
    public boolean onPopup(MouseEvent e, ChartCanvas c) {
        // Delete the nearest drawing within a small radius; otherwise let other handlers run.
        List<Drawing> ds = list(c);
        int bestIdx = -1;
        double best = HIT_PX;
        for (int i = 0; i < ds.size(); i++) {
            double d = distance(ds.get(i), e.getX(), e.getY(), c);
            if (d < best) {
                best = d;
                bestIdx = i;
            }
        }
        if (bestIdx >= 0) {
            ds.remove(bestIdx);
            c.repaint();
            return true;
        }
        return false;
    }

    @Override
    public void paint(Graphics2D g, ChartCanvas c) {
        g.setStroke(new BasicStroke(1.4f));
        g.setColor(LINE);
        for (Drawing d : list(c)) {
            if (d.kind() == Drawing.Kind.HLINE) {
                int y = (int) c.yForPrice(d.p1());
                g.drawLine(c.plotLeft(), y, c.plotRight(), y);
                g.drawString(c.fmtPrice(d.p1()), c.plotRight() - 60, y - 3);
            } else {
                int x1 = (int) c.xForTime(d.t1());
                int y1 = (int) c.yForPrice(d.p1());
                int x2 = (int) c.xForTime(d.t2());
                int y2 = (int) c.yForPrice(d.p2());
                g.drawLine(x1, y1, x2, y2);
            }
        }
        if (drawingTrend) {
            int x1 = (int) c.xForTime(t1);
            int y1 = (int) c.yForPrice(p1);
            g.setColor(LINE);
            g.drawLine(x1, y1, curX, curY);
        }
        if (measuring) {
            paintMeasure(g, c);
        }
    }

    private void paintMeasure(Graphics2D g, ChartCanvas c) {
        int x = Math.min(mStartX, mCurX);
        int y = Math.min(mStartY, mCurY);
        int w = Math.abs(mCurX - mStartX);
        int h = Math.abs(mCurY - mStartY);
        g.setColor(MEASURE_FILL);
        g.fillRect(x, y, w, h);
        g.setColor(MEASURE_LINE);
        g.setStroke(new BasicStroke(1f));
        g.drawRect(x, y, w, h);

        double p0 = c.priceForY(mStartY);
        double p1c = c.priceForY(mCurY);
        double delta = p1c - p0;
        double pct = p0 == 0 ? 0 : delta / p0 * 100;
        int bars = (int) Math.abs(Math.round(c.indexForX(mCurX) - c.indexForX(mStartX)));
        long dt = Math.abs(c.timeForX(mCurX) - c.timeForX(mStartX));
        String label = String.format("%+.2f (%+.2f%%)  %d bars  %s",
                delta, pct, bars, humanDuration(dt));
        g.setColor(new Color(0x2a, 0x2d, 0x38));
        int tw = g.getFontMetrics().stringWidth(label) + 8;
        g.fillRect(mCurX + 6, mCurY, tw, 16);
        g.setColor(Color.WHITE);
        g.drawString(label, mCurX + 10, mCurY + 12);
    }

    private static double distance(Drawing d, int px, int py, ChartCanvas c) {
        if (d.kind() == Drawing.Kind.HLINE) {
            return Math.abs(c.yForPrice(d.p1()) - py);
        }
        double x1 = c.xForTime(d.t1());
        double y1 = c.yForPrice(d.p1());
        double x2 = c.xForTime(d.t2());
        double y2 = c.yForPrice(d.p2());
        return pointToSegment(px, py, x1, y1, x2, y2);
    }

    private static double pointToSegment(double px, double py, double x1, double y1, double x2, double y2) {
        double dx = x2 - x1;
        double dy = y2 - y1;
        double len2 = dx * dx + dy * dy;
        if (len2 == 0) {
            return Math.hypot(px - x1, py - y1);
        }
        double t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        double cx = x1 + t * dx;
        double cy = y1 + t * dy;
        return Math.hypot(px - cx, py - cy);
    }

    private static String humanDuration(long ms) {
        Duration d = Duration.ofMillis(ms);
        long days = d.toDays();
        if (days > 0) {
            return days + "d " + (d.toHours() % 24) + "h";
        }
        long hours = d.toHours();
        if (hours > 0) {
            return hours + "h " + (d.toMinutes() % 60) + "m";
        }
        return d.toMinutes() + "m";
    }
}
