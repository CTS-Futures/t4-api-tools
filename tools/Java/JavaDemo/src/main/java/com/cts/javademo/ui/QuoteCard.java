package com.cts.javademo.ui;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.Timer;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;

/**
 * One Bid / Ask / Last quote card, styled after the Rust demo's {@code quote_card}:
 * a colored rounded border, a tinted fill, a small bold title, a large bold price
 * (shown as {@code —} when empty), and the size beneath as {@code ×{volume}}. When
 * the price changes the fill flashes to a bright tint and fades back over ~300ms.
 */
final class QuoteCard extends JPanel {

    private static final int FLASH_MS = 300;
    private static final int TICK_MS = 15;
    private static final int ARC = 12;

    private final Color border;
    private final Color baseFill;
    private final Color flashFill;

    private final JLabel priceLabel = new JLabel("—");
    private final JLabel volumeLabel = new JLabel("×0");

    private Color currentFill;
    private String lastPrice = "";
    private long flashStart = -1;
    private final Timer timer;

    QuoteCard(String title, Color border, Color baseFill, Color flashFill, Color text) {
        this.border = border;
        this.baseFill = baseFill;
        this.flashFill = flashFill;
        this.currentFill = baseFill;

        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(6, 6, 6, 6));
        setLayout(new BoxLayout(this, BoxLayout.Y_AXIS));
        setMinimumSize(new Dimension(0, 90));
        setPreferredSize(new Dimension(0, 90));

        JLabel titleLabel = new JLabel(title);
        titleLabel.setFont(titleLabel.getFont().deriveFont(Font.BOLD, 11f));
        titleLabel.setForeground(text);
        priceLabel.setFont(priceLabel.getFont().deriveFont(Font.BOLD, 20f));
        priceLabel.setForeground(text);
        volumeLabel.setFont(volumeLabel.getFont().deriveFont(11f));
        volumeLabel.setForeground(text);

        add(javax.swing.Box.createVerticalGlue());
        add(center(titleLabel));
        add(javax.swing.Box.createVerticalStrut(6));
        add(center(priceLabel));
        add(javax.swing.Box.createVerticalStrut(2));
        add(center(volumeLabel));
        add(javax.swing.Box.createVerticalGlue());

        timer = new Timer(TICK_MS, e -> animate());
    }

    private static Component center(JLabel label) {
        label.setAlignmentX(Component.CENTER_ALIGNMENT);
        return label;
    }

    /** Push a new quote value; flashes the card if the price string changed. */
    void update(String price, int volume) {
        priceLabel.setText(price == null || price.isEmpty() ? "—" : price);
        volumeLabel.setText("×" + volume);

        String p = price == null ? "" : price;
        if (!p.equals(lastPrice)) {
            lastPrice = p;
            if (!p.isEmpty()) {
                flashStart = System.currentTimeMillis();
                currentFill = flashFill;
                repaint();
                timer.restart();
            }
        }
    }

    private void animate() {
        long elapsed = System.currentTimeMillis() - flashStart;
        float t = Math.min(1f, elapsed / (float) FLASH_MS);
        currentFill = lerp(flashFill, baseFill, t);
        repaint();
        if (t >= 1f) {
            timer.stop();
        }
    }

    private static Color lerp(Color a, Color b, float t) {
        t = Math.max(0f, Math.min(1f, t));
        int r = Math.round(a.getRed() + (b.getRed() - a.getRed()) * t);
        int g = Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * t);
        int bl = Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * t);
        return new Color(r, g, bl);
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int w = getWidth();
        int h = getHeight();
        g2.setColor(currentFill);
        g2.fillRoundRect(1, 1, w - 3, h - 3, ARC, ARC);
        g2.setColor(border);
        g2.setStroke(new java.awt.BasicStroke(2f));
        g2.drawRoundRect(1, 1, w - 3, h - 3, ARC, ARC);
        g2.dispose();
        super.paintComponent(g);
    }
}
