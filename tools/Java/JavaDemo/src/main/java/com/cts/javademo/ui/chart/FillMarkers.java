package com.cts.javademo.ui.chart;

import com.cts.javademo.state.AppState;

import java.awt.Color;
import java.awt.Graphics2D;
import java.util.ArrayList;
import java.util.List;

/**
 * Triangle markers at executed fills (buy = up triangle below the bar, sell =
 * down triangle above), read from {@link AppState#fills} for the active market.
 */
public final class FillMarkers implements ChartOverlay {

    private static final Color BUY = new Color(0x26, 0xa6, 0x9a);
    private static final Color SELL = new Color(0xef, 0x53, 0x50);
    private static final int SIZE = 6;

    @Override
    public void paint(Graphics2D g, ChartCanvas c) {
        List<AppState.Fill> fills = c.state().read(s -> {
            String mkt = s.marketId;
            List<AppState.Fill> out = new ArrayList<>();
            for (AppState.Fill f : s.fills) {
                if (mkt != null && mkt.equals(f.marketId)) {
                    out.add(f);
                }
            }
            return out;
        });
        for (AppState.Fill f : fills) {
            double price;
            try {
                price = Double.parseDouble(f.price);
            } catch (NumberFormatException e) {
                continue;
            }
            int x = (int) c.xForTime(f.timeMs);
            if (x < c.plotLeft() || x > c.plotRight()) {
                continue;
            }
            int y = (int) c.yForPrice(price);
            g.setColor(f.buy ? BUY : SELL);
            if (f.buy) {
                fillTriangle(g, x, y + SIZE + 2, true);
            } else {
                fillTriangle(g, x, y - SIZE - 2, false);
            }
        }
    }

    private static void fillTriangle(Graphics2D g, int cx, int cy, boolean up) {
        int[] xs = {cx - SIZE, cx + SIZE, cx};
        int[] ys = up ? new int[]{cy, cy, cy - SIZE} : new int[]{cy, cy, cy + SIZE};
        g.fillPolygon(xs, ys, 3);
    }
}
