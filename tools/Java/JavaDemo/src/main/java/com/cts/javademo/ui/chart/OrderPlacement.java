package com.cts.javademo.ui.chart;

import com.cts.javademo.net.OrderRequest;

import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.event.MouseEvent;
import java.util.function.Consumer;
import java.util.function.IntSupplier;

/**
 * Chart-based order placement, mirroring the JS demo's DragOrder + OrderToolbar:
 * the user arms a side (Buy/Sell), picks a Type (Auto/Limit/Stop/Market), and
 * optionally toggles Bracket. A left-drag on the chart drops an order at the
 * release price. In Auto the order type is inferred from the drop price vs the
 * last trade (buy below last = limit, above = stop; sell mirrors). With Bracket
 * on, the drop submits an entry plus TP/SL protection sized by the drag distance,
 * with visual green (TP) / red (SL) zones. A right-click menu also drops plain
 * market/limit/stop orders at the cursor price.
 */
public final class OrderPlacement implements ChartOverlay {

    /** Armed side; null = disarmed. */
    public enum Side { BUY, SELL }

    /** Order type for chart-placed orders; AUTO infers limit-vs-stop from drop-vs-last. */
    public enum Type { AUTO, LIMIT, STOP, MARKET }

    private static final Color TP_ZONE = new Color(0x26, 0xa6, 0x9a, 40);
    private static final Color SL_ZONE = new Color(0xef, 0x53, 0x50, 40);

    private final IntSupplier qty;

    private Side toolMode;                 // null = disarmed
    private Type orderType = Type.AUTO;
    private boolean bracketMode;
    private Consumer<Side> onToolChange;

    private boolean dragging;
    private double entryPrice;
    private double curPrice;
    private boolean buySide;

    public OrderPlacement(IntSupplier qty) {
        this.qty = qty;
    }

    // ---------- arm / disarm -------------------------------------------------
    public void beginTool(Side side) {
        if (side == null || toolMode == side) {
            return;
        }
        dragging = false;
        toolMode = side;
        emitToolChange();
    }

    public void cancelTool() {
        if (toolMode == null) {
            return;
        }
        toolMode = null;
        dragging = false;
        emitToolChange();
    }

    public boolean isArmed() {
        return toolMode != null;
    }

    public void setOrderType(Type type) {
        this.orderType = type == null ? Type.AUTO : type;
    }

    public void setBracketMode(boolean bracketMode) {
        this.bracketMode = bracketMode;
    }

    /** Called when the armed side changes (incl. disarm, side = null) so the toolbar can sync. */
    public void setOnToolChange(Consumer<Side> cb) {
        this.onToolChange = cb;
    }

    private void emitToolChange() {
        if (onToolChange != null) {
            onToolChange.accept(toolMode);
        }
    }

    @Override
    public boolean onPress(MouseEvent e, ChartCanvas c) {
        if (toolMode == null || e.getButton() != MouseEvent.BUTTON1 || c.model().tool != ChartModel.Tool.CURSOR) {
            return false;
        }
        entryPrice = c.priceForY(e.getY());
        curPrice = entryPrice;
        buySide = toolMode == Side.BUY;
        dragging = true;
        return true;
    }

    @Override
    public void onDrag(MouseEvent e, ChartCanvas c) {
        if (dragging) {
            curPrice = c.priceForY(e.getY());
        }
    }

    @Override
    public void onRelease(MouseEvent e, ChartCanvas c) {
        if (!dragging) {
            return;
        }
        dragging = false;
        int volume = Math.max(1, qty.getAsInt());
        String accountId = c.state().read(s -> s.selectedAccount);
        if (accountId == null) {
            c.repaint();
            return;
        }
        Type type = effectiveType(c, entryPrice);

        if (type == Type.MARKET) {
            c.client().submitAtPrice(buySide, OrderRequest.Kind.MARKET, volume, entryPrice, OrderRequest.TimeInForce.DAY);
        } else if (bracketMode) {
            OrderRequest req = new OrderRequest();
            req.accountId = accountId;
            req.buy = buySide;
            req.kind = type == Type.STOP ? OrderRequest.Kind.STOP : OrderRequest.Kind.LIMIT;
            req.volume = volume;
            req.tif = OrderRequest.TimeInForce.DAY;
            String p = c.fmtPrice(entryPrice);
            if (req.kind.hasLimit()) {
                req.limitPrice = p;
            }
            if (req.kind.hasStop()) {
                req.stopPrice = p;
            }
            double dist = Math.abs(curPrice - entryPrice);
            Double pv = pointValue(c);
            if (pv != null && pv > 0 && dist > 0) {
                double dollars = dist * pv * volume;
                req.takeProfit = dollars;
                req.stopLoss = dollars;
            }
            c.client().submitOrder(req);
        } else {
            OrderRequest.Kind kind = type == Type.STOP ? OrderRequest.Kind.STOP : OrderRequest.Kind.LIMIT;
            c.client().submitAtPrice(buySide, kind, volume, entryPrice, OrderRequest.TimeInForce.DAY);
        }
        c.repaint();
    }

    @Override
    public boolean onPopup(MouseEvent e, ChartCanvas c) {
        double price = c.priceForY(e.getY());
        int volume = Math.max(1, qty.getAsInt());
        JPopupMenu menu = new JPopupMenu();
        menu.add(header("@ " + c.fmtPrice(price) + "  (qty " + volume + ")"));
        menu.addSeparator();
        menu.add(item("Buy Limit", () ->
                c.client().submitAtPrice(true, OrderRequest.Kind.LIMIT, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.add(item("Sell Limit", () ->
                c.client().submitAtPrice(false, OrderRequest.Kind.LIMIT, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.add(item("Buy Stop", () ->
                c.client().submitAtPrice(true, OrderRequest.Kind.STOP, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.add(item("Sell Stop", () ->
                c.client().submitAtPrice(false, OrderRequest.Kind.STOP, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.addSeparator();
        menu.add(item("Buy Market", () ->
                c.client().submitAtPrice(true, OrderRequest.Kind.MARKET, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.add(item("Sell Market", () ->
                c.client().submitAtPrice(false, OrderRequest.Kind.MARKET, volume, price, OrderRequest.TimeInForce.DAY)));
        menu.show(c, e.getX(), e.getY());
        return true;
    }

    @Override
    public void paint(Graphics2D g, ChartCanvas c) {
        if (!dragging) {
            return;
        }
        int volume = Math.max(1, qty.getAsInt());
        Type type = effectiveType(c, entryPrice);
        int yEntry = (int) c.yForPrice(entryPrice);
        String sideStr = buySide ? "BUY " : "SELL ";

        // Bracket preview (green TP / red SL zones) only for a working-order entry.
        if (bracketMode && type != Type.MARKET) {
            double dist = Math.abs(curPrice - entryPrice);
            double tp = buySide ? entryPrice + dist : entryPrice - dist;
            double sl = buySide ? entryPrice - dist : entryPrice + dist;
            int yTp = (int) c.yForPrice(tp);
            int ySl = (int) c.yForPrice(sl);

            g.setColor(TP_ZONE);
            g.fillRect(c.plotLeft(), Math.min(yEntry, yTp), c.plotRight() - c.plotLeft(), Math.abs(yTp - yEntry));
            g.setColor(SL_ZONE);
            g.fillRect(c.plotLeft(), Math.min(yEntry, ySl), c.plotRight() - c.plotLeft(), Math.abs(ySl - yEntry));

            g.setColor(Color.WHITE);
            g.setStroke(new BasicStroke(1.2f));
            g.drawLine(c.plotLeft(), yEntry, c.plotRight(), yEntry);

            Double pv = pointValue(c);
            String risk = pv == null ? "?" : String.format("$%.0f", dist * pv * volume);
            g.drawString(sideStr + volume + " " + typeLabel(type) + " @ " + c.fmtPrice(entryPrice), c.plotLeft() + 6, yEntry - 4);
            g.setColor(ChartCanvas.UP);
            g.drawString("TP " + c.fmtPrice(tp) + "  +" + risk, c.plotLeft() + 6, yTp + 12);
            g.setColor(ChartCanvas.DOWN);
            g.drawString("SL " + c.fmtPrice(sl) + "  -" + risk, c.plotLeft() + 6, ySl - 4);
            return;
        }

        // Simple order: just the entry line + label.
        g.setColor(Color.WHITE);
        g.setStroke(new BasicStroke(1.2f));
        g.drawLine(c.plotLeft(), yEntry, c.plotRight(), yEntry);
        String label = type == Type.MARKET
                ? sideStr + volume + " MKT"
                : sideStr + volume + " " + typeLabel(type) + " @ " + c.fmtPrice(entryPrice);
        g.drawString(label, c.plotLeft() + 6, yEntry - 4);
    }

    // ---------- helpers ------------------------------------------------------

    /** Honour a forced Type; otherwise infer limit-vs-stop from the drop price vs last trade. */
    private Type effectiveType(ChartCanvas c, double price) {
        if (orderType != Type.AUTO) {
            return orderType;
        }
        double last = lastPrice(c);
        if (last == 0) {
            return Type.LIMIT;
        }
        if (buySide) {
            return price <= last ? Type.LIMIT : Type.STOP;
        }
        return price >= last ? Type.LIMIT : Type.STOP;
    }

    private static String typeLabel(Type type) {
        return switch (type) {
            case STOP -> "STP";
            case MARKET -> "MKT";
            default -> "LMT";
        };
    }

    private static double lastPrice(ChartCanvas c) {
        Double p = parse(c.state().read(s -> s.quote.lastPrice));
        return p == null ? 0 : p;
    }

    private static Double pointValue(ChartCanvas c) {
        return parse(c.state().read(s -> s.marketPointValue));
    }

    private static Double parse(String s) {
        if (s == null || s.isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static JMenuItem item(String label, Runnable action) {
        JMenuItem it = new JMenuItem(label);
        it.addActionListener(e -> action.run());
        return it;
    }

    private static JMenuItem header(String label) {
        JMenuItem it = new JMenuItem(label);
        it.setEnabled(false);
        return it;
    }
}
