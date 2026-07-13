package com.cts.javademo.ui;

import com.cts.javademo.net.OrderRequest;
import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.IntSupplier;

/**
 * A depth-of-market ladder: columns <em>My Buys | Bid | Price | Offer | My
 * Sells</em>, proportional depth bars, auto-centering on the inside market with a
 * Recenter button, and click-to-trade (bid side = buy limit, offer side = sell
 * limit). Ports the JS demo's DomLadder onto a custom-painted Swing panel.
 */
public final class DomLadderPanel extends JPanel {

    private static final int ROW_H = 16;
    private static final Color BG = new Color(0x1e, 0x1e, 0x24);
    private static final Color TEXT = new Color(0xc8, 0xcc, 0xd4);
    private static final Color MUTED = new Color(0x8a, 0x8f, 0x99);
    private static final Color BID = new Color(0x26, 0xa6, 0x9a);
    private static final Color OFFER = new Color(0xef, 0x53, 0x50);
    private static final Color BID_BAR = new Color(0x26, 0xa6, 0x9a, 70);
    private static final Color OFFER_BAR = new Color(0xef, 0x53, 0x50, 70);
    private static final Color MID_BG = new Color(0x2a, 0x2d, 0x38);
    private static final Color MINE = new Color(0xf2, 0xb6, 0x36);

    private final AppState state;
    private final T4Client client;
    private final IntSupplier qty;

    private final Ladder ladder = new Ladder();
    private final OpenPositions openPositions = new OpenPositions();
    private final JScrollPane posScroll = new JScrollPane(openPositions,
            JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
    private int scrollRows; // 0 = auto-centered on the inside market

    public DomLadderPanel(AppState state, T4Client client, IntSupplier qty) {
        this.state = state;
        this.client = client;
        this.qty = qty;
        setLayout(new BorderLayout());

        JPanel header = new JPanel(new BorderLayout());
        header.setBorder(BorderFactory.createEmptyBorder(2, 6, 2, 6));
        header.add(new JLabel("Depth"), BorderLayout.WEST);
        JButton recenter = new JButton("Center");
        recenter.setMargin(new java.awt.Insets(1, 6, 1, 6));
        recenter.addActionListener(e -> {
            scrollRows = 0;
            repaint();
        });
        header.add(recenter, BorderLayout.EAST);
        add(header, BorderLayout.NORTH);
        add(ladder, BorderLayout.CENTER);

        // South section: a fixed "Open Positions" title above a scrollable list that
        // grows to fit every open position (capped to ~half the panel; overflow scrolls).
        JPanel south = new JPanel(new BorderLayout());
        south.setBackground(BG);
        south.setBorder(BorderFactory.createMatteBorder(1, 0, 0, 0, new Color(0x33, 0x36, 0x40)));
        JLabel posTitle = new JLabel(" Open Positions");
        posTitle.setForeground(MUTED);
        posTitle.setFont(new Font(Font.MONOSPACED, Font.BOLD, 11));
        posTitle.setBorder(BorderFactory.createEmptyBorder(2, 0, 2, 0));
        south.add(posTitle, BorderLayout.NORTH);
        posScroll.setBorder(null);
        posScroll.getViewport().setBackground(BG);
        south.add(posScroll, BorderLayout.CENTER);
        add(south, BorderLayout.SOUTH);
    }

    public void refresh() {
        ladder.repaint();
        // Grow the positions viewport to fit all open positions, but never take more
        // than half the panel so the ladder stays usable; the rest scrolls.
        int content = Math.max(1, openPositions.openCount()) * ROW_H + 2;
        int cap = Math.max(ROW_H * 4, getHeight() / 2);
        posScroll.setPreferredSize(new Dimension(0, Math.min(content, cap)));
        revalidate();
        openPositions.repaint();
    }

    private final class Ladder extends JPanel {
        Ladder() {
            setBackground(BG);
            MouseAdapter h = new MouseAdapter() {
                @Override
                public void mouseWheelMoved(java.awt.event.MouseWheelEvent e) {
                    scrollRows += e.getWheelRotation();
                    repaint();
                }

                @Override
                public void mouseClicked(MouseEvent e) {
                    onClick(e);
                }
            };
            addMouseListener(h);
            addMouseWheelListener(h);
        }

        @Override
        protected void paintComponent(Graphics g0) {
            super.paintComponent(g0);
            Graphics2D g = (Graphics2D) g0;
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            paintLadder(g, getWidth(), getHeight());
        }

        private void onClick(MouseEvent e) {
            Snapshot s = snapshot();
            if (s.tick <= 0) {
                return;
            }
            int rows = getHeight() / ROW_H;
            int rowIdx = e.getY() / ROW_H;
            double price = s.centerPrice + (rows / 2 - rowIdx + scrollRows) * s.tick;
            int volume = Math.max(1, qty.getAsInt());
            boolean buy = e.getX() < getWidth() / 2;
            client.submitAtPrice(buy, OrderRequest.Kind.LIMIT, volume, price, OrderRequest.TimeInForce.DAY);
        }
    }

    private void paintLadder(Graphics2D g, int w, int h) {
        Snapshot s = snapshot();
        g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 11));
        if (s.tick <= 0 || (s.bidVol.isEmpty() && s.offerVol.isEmpty())) {
            g.setColor(MUTED);
            g.drawString("No depth", 8, 20);
            return;
        }
        int rows = h / ROW_H;
        int priceColW = 62;
        int side = (w - priceColW) / 2;
        int xPrice = side;
        int xOffer = side + priceColW;

        for (int r = 0; r < rows; r++) {
            double price = s.centerPrice + (rows / 2 - r + scrollRows) * s.tick;
            long key = Math.round(price / s.tick);
            int y = r * ROW_H;

            boolean isMid = Math.abs(price - s.centerPrice) < s.tick / 2;
            if (isMid) {
                g.setColor(MID_BG);
                g.fillRect(0, y, w, ROW_H);
            }

            int bv = s.bidVol.getOrDefault(key, 0);
            int ov = s.offerVol.getOrDefault(key, 0);
            if (bv > 0) {
                int bar = (int) (side * Math.min(1.0, bv / (double) s.maxVol));
                g.setColor(BID_BAR);
                g.fillRect(xPrice - bar, y, bar, ROW_H - 1);
                g.setColor(BID);
                g.drawString(Integer.toString(bv), xPrice - 42, y + 12);
            }
            if (ov > 0) {
                int bar = (int) (side * Math.min(1.0, ov / (double) s.maxVol));
                g.setColor(OFFER_BAR);
                g.fillRect(xOffer, y, bar, ROW_H - 1);
                g.setColor(OFFER);
                g.drawString(Integer.toString(ov), xOffer + 6, y + 12);
            }

            // My working orders at this price.
            int myBuy = s.myBuys.getOrDefault(key, 0);
            int mySell = s.mySells.getOrDefault(key, 0);
            g.setColor(MINE);
            if (myBuy > 0) {
                g.drawString("•" + myBuy, 2, y + 12);
            }
            if (mySell > 0) {
                g.drawString(mySell + "•", w - 24, y + 12);
            }

            // Position avg-open marker.
            if (s.hasPos && Math.abs(price - s.posAvg) < s.tick / 2) {
                g.setColor(MINE);
                g.drawRect(xPrice, y, priceColW - 1, ROW_H - 1);
            }

            g.setColor(isMid ? Color.WHITE : TEXT);
            String pxs = fmtPrice(price, s.decimals);
            int tw = g.getFontMetrics().stringWidth(pxs);
            g.drawString(pxs, xPrice + (priceColW - tw) / 2, y + 12);
        }

        // Column separators.
        g.setColor(new Color(0x33, 0x36, 0x40));
        g.drawLine(xPrice, 0, xPrice, h);
        g.drawLine(xOffer, 0, xOffer, h);
    }

    private Snapshot snapshot() {
        return state.read(s -> {
            Snapshot snap = new Snapshot();
            snap.tick = s.marketTickSize;
            snap.decimals = Math.max(0, s.marketDecimals);
            double bestBid = 0;
            double bestOffer = 0;
            for (AppState.DepthLine b : s.bids) {
                Double p = parse(b.price);
                if (p == null || snap.tick <= 0) {
                    continue;
                }
                long k = Math.round(p / snap.tick);
                snap.bidVol.merge(k, b.volume, Integer::sum);
                snap.maxVol = Math.max(snap.maxVol, b.volume);
                bestBid = Math.max(bestBid, p);
            }
            for (AppState.DepthLine o : s.offers) {
                Double p = parse(o.price);
                if (p == null || snap.tick <= 0) {
                    continue;
                }
                long k = Math.round(p / snap.tick);
                snap.offerVol.merge(k, o.volume, Integer::sum);
                snap.maxVol = Math.max(snap.maxVol, o.volume);
                bestOffer = bestOffer == 0 ? p : Math.min(bestOffer, p);
            }
            double mid = bestBid > 0 && bestOffer > 0 ? (bestBid + bestOffer) / 2
                    : bestBid > 0 ? bestBid : bestOffer;
            snap.centerPrice = snap.tick > 0 ? Math.round(mid / snap.tick) * snap.tick : mid;
            snap.maxVol = Math.max(1, snap.maxVol);

            String mkt = s.marketId;
            for (AppState.OrderRow ord : s.orders.values()) {
                if (mkt == null || !mkt.equals(ord.marketId) || ord.workingVolume <= 0) {
                    continue;
                }
                if (!"Working".equals(ord.status) && !"Held".equals(ord.status)) {
                    continue;
                }
                Double p = parse(ord.limitPrice != null && !ord.limitPrice.isEmpty() ? ord.limitPrice : ord.stopPrice);
                if (p == null || snap.tick <= 0) {
                    continue;
                }
                long k = Math.round(p / snap.tick);
                (("Buy".equals(ord.side)) ? snap.myBuys : snap.mySells).merge(k, ord.workingVolume, Integer::sum);
            }
            AppState.PositionRow pos = mkt == null ? null : s.positions.get(mkt);
            if (pos != null && pos.net != 0 && pos.avgOpenPrice != 0) {
                snap.hasPos = true;
                snap.posAvg = pos.avgOpenPrice;
            }
            return snap;
        });
    }

    private static final class Snapshot {
        double tick;
        int decimals;
        double centerPrice;
        int maxVol;
        boolean hasPos;
        double posAvg;
        final Map<Long, Integer> bidVol = new HashMap<>();
        final Map<Long, Integer> offerVol = new HashMap<>();
        final Map<Long, Integer> myBuys = new HashMap<>();
        final Map<Long, Integer> mySells = new HashMap<>();
    }

    /**
     * A compact list of every open position (net != 0) across all markets — so the
     * order book "captures" positions the single-market ladder above can't show. The
     * row for the currently displayed market is highlighted.
     */
    private final class OpenPositions extends JPanel implements javax.swing.Scrollable {
        private static final int MARKET_COL = 72;

        OpenPositions() {
            setBackground(BG);
        }

        /** Number of open positions (net != 0); used for sizing without a full copy. */
        int openCount() {
            return state.read(s -> {
                int n = 0;
                for (AppState.PositionRow p : s.positions.values()) {
                    if (p.net != 0) {
                        n++;
                    }
                }
                return n;
            });
        }

        private List<AppState.PositionRow> openRows() {
            return state.read(s -> {
                List<AppState.PositionRow> out = new ArrayList<>();
                for (AppState.PositionRow p : s.positions.values()) {
                    if (p.net != 0) {
                        AppState.PositionRow c = new AppState.PositionRow();
                        c.marketId = p.marketId;
                        c.net = p.net;
                        c.avgOpenPrice = p.avgOpenPrice;
                        c.rpl = p.rpl;
                        c.upl = p.upl;
                        out.add(c);
                    }
                }
                return out;
            });
        }

        @Override
        public Dimension getPreferredSize() {
            // Full content height; how much is actually shown is governed by posScroll.
            return new Dimension(0, Math.max(1, openCount()) * ROW_H);
        }

        @Override
        protected void paintComponent(Graphics g0) {
            super.paintComponent(g0);
            Graphics2D g = (Graphics2D) g0;
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            int w = getWidth();
            g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 11));

            List<AppState.PositionRow> rows = openRows();
            if (rows.isEmpty()) {
                g.setColor(MUTED);
                g.drawString("No open positions", 6, 12);
                return;
            }
            String mkt = state.read(s -> s.marketId);
            int decimals = state.read(s -> Math.max(0, s.marketDecimals));

            // Paint only the rows intersecting the clip so cost is O(visible), not O(total).
            java.awt.Rectangle clip = g.getClipBounds();
            int first = clip == null ? 0 : Math.max(0, clip.y / ROW_H);
            int last = clip == null ? rows.size()
                    : Math.min(rows.size(), (clip.y + clip.height) / ROW_H + 1);
            for (int i = first; i < last; i++) {
                AppState.PositionRow p = rows.get(i);
                int y = i * ROW_H;
                boolean active = p.marketId != null && p.marketId.equals(mkt);
                if (active) {
                    g.setColor(MID_BG);
                    g.fillRect(0, y, w, ROW_H);
                }
                g.setColor(active ? Color.WHITE : TEXT);
                g.drawString(clip(g, p.marketId, MARKET_COL - 8), 6, y + 12);

                boolean isLong = p.net > 0;
                g.setColor(isLong ? BID : OFFER);
                g.drawString((isLong ? "+" : "") + p.net + " @ " + fmtPrice(p.avgOpenPrice, decimals),
                        MARKET_COL, y + 12);

                double pl = p.upl;
                g.setColor(pl > 0 ? BID : pl < 0 ? OFFER : MUTED);
                String plStr = String.format("%+,.2f", pl);
                int tw = g.getFontMetrics().stringWidth(plStr);
                g.drawString(plStr, w - tw - 6, y + 12);
            }
        }

        // --- Scrollable: fill the viewport width, scroll vertically by rows. ---
        @Override
        public Dimension getPreferredScrollableViewportSize() {
            return getPreferredSize();
        }

        @Override
        public int getScrollableUnitIncrement(java.awt.Rectangle visible, int orientation, int direction) {
            return ROW_H;
        }

        @Override
        public int getScrollableBlockIncrement(java.awt.Rectangle visible, int orientation, int direction) {
            return visible.height > 0 ? visible.height : ROW_H * 4;
        }

        @Override
        public boolean getScrollableTracksViewportWidth() {
            return true;
        }

        @Override
        public boolean getScrollableTracksViewportHeight() {
            return false;
        }

        private String clip(Graphics2D g, String s, int maxWidth) {
            if (s == null) {
                return "";
            }
            if (g.getFontMetrics().stringWidth(s) <= maxWidth) {
                return s;
            }
            String ell = "…";
            while (s.length() > 1 && g.getFontMetrics().stringWidth(s + ell) > maxWidth) {
                s = s.substring(0, s.length() - 1);
            }
            return s + ell;
        }
    }

    private static String fmtPrice(double v, int decimals) {
        return String.format("%." + decimals + "f", v);
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
}
