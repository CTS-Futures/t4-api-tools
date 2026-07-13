package com.cts.javademo.ui.chart;

import com.cts.javademo.state.AppState;

import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPopupMenu;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.List;

/**
 * Working-order lines + the net-position line, with drag-to-revise and a
 * right-click cancel/revise menu. Ports the JS demo's OrderLines/PositionLine
 * onto the custom canvas.
 */
public final class OrderOverlay implements ChartOverlay {

    private static final Color BUY = new Color(0x26, 0xa6, 0x9a);
    private static final Color SELL = new Color(0xef, 0x53, 0x50);
    private static final Color POS = new Color(0xf2, 0xb6, 0x36);
    private static final int HIT_PX = 8;

    private String draggingId;
    private double dragPrice;

    /** A snapshot of one working order for painting/hit-testing. */
    private record Line(String uniqueId, double price, boolean buy, int volume, boolean isLimit) {
    }

    private List<Line> lines(ChartCanvas c) {
        return c.state().read(s -> {
            String mkt = s.marketId;
            List<Line> out = new ArrayList<>();
            if (mkt == null) {
                return out;
            }
            for (AppState.OrderRow o : s.orders.values()) {
                if (!mkt.equals(o.marketId) || o.workingVolume <= 0) {
                    continue;
                }
                if (!"Working".equals(o.status) && !"Held".equals(o.status)) {
                    continue;
                }
                boolean isLimit = o.limitPrice != null && !o.limitPrice.isEmpty();
                Double px = parse(isLimit ? o.limitPrice : o.stopPrice);
                if (px == null) {
                    continue;
                }
                out.add(new Line(o.uniqueId, px, "Buy".equals(o.side), o.workingVolume, isLimit));
            }
            return out;
        });
    }

    @Override
    public void paint(Graphics2D g, ChartCanvas c) {
        // Net position line.
        double[] pos = c.state().read(s -> {
            String mkt = s.marketId;
            AppState.PositionRow p = mkt == null ? null : s.positions.get(mkt);
            return (p == null || p.net == 0) ? null : new double[]{p.net, p.avgOpenPrice};
        });
        if (pos != null && pos[1] != 0) {
            int y = (int) c.yForPrice(pos[1]);
            g.setColor(POS);
            g.setStroke(new BasicStroke(1.4f));
            g.drawLine(c.plotLeft(), y, c.plotRight(), y);
            String label = "POS " + (pos[0] > 0 ? "+" : "") + (int) pos[0] + " @ " + c.fmtPrice(pos[1]);
            g.drawString(label, c.plotLeft() + 6, y - 3);
        }

        // Working-order lines. The order being dragged follows the cursor (drawn at
        // dragPrice) so the line itself tracks the mouse; the rest stay put.
        g.setStroke(orderStroke());
        for (Line l : lines(c)) {
            boolean isDrag = l.uniqueId().equals(draggingId);
            double price = isDrag ? dragPrice : l.price();
            int y = (int) c.yForPrice(price);
            g.setColor(l.buy() ? BUY : SELL);
            g.drawLine(c.plotLeft(), y, c.plotRight(), y);
            String label = (l.buy() ? "BUY " : "SELL ") + l.volume() + " @ " + c.fmtPrice(price)
                    + (l.isLimit() ? "" : " STP");
            g.drawString(label, c.plotLeft() + 6, y - 3);
        }
    }

    @Override
    public boolean onPress(MouseEvent e, ChartCanvas c) {
        if (e.getButton() != MouseEvent.BUTTON1 || c.model().tool != ChartModel.Tool.CURSOR) {
            return false;
        }
        Line hit = nearest(e.getY(), c);
        if (hit != null) {
            draggingId = hit.uniqueId();
            dragPrice = hit.price();
            return true;
        }
        return false;
    }

    @Override
    public void onDrag(MouseEvent e, ChartCanvas c) {
        if (draggingId != null) {
            dragPrice = c.priceForY(e.getY());
        }
    }

    @Override
    public void onRelease(MouseEvent e, ChartCanvas c) {
        if (draggingId != null) {
            c.client().reviseOrderPrice(draggingId, c.priceForY(e.getY()));
            draggingId = null;
        }
    }

    @Override
    public boolean onPopup(MouseEvent e, ChartCanvas c) {
        Line hit = nearest(e.getY(), c);
        if (hit == null) {
            return false;
        }
        String[] am = c.state().read(s -> new String[]{s.selectedAccount, s.marketId});
        JPopupMenu menu = new JPopupMenu();
        JMenuItem cancel = new JMenuItem("Cancel order " + shortId(hit.uniqueId()));
        cancel.addActionListener(a -> {
            if (am[0] != null && am[1] != null) {
                c.client().cancelOrder(am[0], am[1], hit.uniqueId());
            }
        });
        menu.add(cancel);
        JMenuItem revise = new JMenuItem("Revise price…");
        revise.addActionListener(a -> {
            String prompt = hit.isLimit() ? "New limit price:" : "New stop price:";
            String in = JOptionPane.showInputDialog(c, prompt, c.fmtPrice(hit.price()));
            Double np = parse(in);
            if (np != null) {
                c.client().reviseOrderPrice(hit.uniqueId(), np);
            }
        });
        menu.add(revise);
        menu.show(c, e.getX(), e.getY());
        return true;
    }

    @Override
    public java.awt.Cursor cursorAt(MouseEvent e, ChartCanvas c) {
        if (c.model().tool != ChartModel.Tool.CURSOR) {
            return null;
        }
        return nearest(e.getY(), c) != null
                ? java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.N_RESIZE_CURSOR)
                : null;
    }

    private Line nearest(int y, ChartCanvas c) {
        Line best = null;
        double bestD = HIT_PX;
        for (Line l : lines(c)) {
            double d = Math.abs(c.yForPrice(l.price()) - y);
            if (d < bestD) {
                bestD = d;
                best = l;
            }
        }
        return best;
    }

    private static BasicStroke orderStroke() {
        return new BasicStroke(1.2f, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER,
                4f, new float[]{8f, 4f}, 0f);
    }

    private static String shortId(String id) {
        return id.length() > 6 ? id.substring(id.length() - 6) : id;
    }

    private static Double parse(String s) {
        if (s == null || s.trim().isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
