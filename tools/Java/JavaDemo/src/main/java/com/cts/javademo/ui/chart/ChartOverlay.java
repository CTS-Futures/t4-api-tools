package com.cts.javademo.ui.chart;

import java.awt.Cursor;
import java.awt.Graphics2D;
import java.awt.event.MouseEvent;

/**
 * A pluggable chart overlay (order lines, position line, fill markers, order
 * placement). The canvas paints each overlay after the series and routes mouse
 * events to them before its own pan/tool handling. A handler returns {@code true}
 * to consume the event.
 */
public interface ChartOverlay {

    void paint(Graphics2D g, ChartCanvas c);

    default boolean onPress(MouseEvent e, ChartCanvas c) {
        return false;
    }

    default void onDrag(MouseEvent e, ChartCanvas c) {
    }

    default void onRelease(MouseEvent e, ChartCanvas c) {
    }

    /** Right-click / popup trigger. Return true if handled. */
    default boolean onPopup(MouseEvent e, ChartCanvas c) {
        return false;
    }

    /**
     * Hover hint: return a cursor to show when the pointer is over an interactive
     * element (e.g. a draggable order line), or {@code null} to defer. Does not
     * consume the event.
     */
    default Cursor cursorAt(MouseEvent e, ChartCanvas c) {
        return null;
    }
}
