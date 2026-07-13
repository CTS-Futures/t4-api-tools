package com.cts.javademo.ui;

import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;
import com.cts.javademo.ui.chart.ChartCanvas;
import com.cts.javademo.ui.chart.ChartModel;
import com.cts.javademo.ui.chart.DrawingOverlay;
import com.cts.javademo.ui.chart.FillMarkers;
import com.cts.javademo.ui.chart.OrderOverlay;
import com.cts.javademo.ui.chart.OrderPlacement;

import javax.imageio.ImageIO;
import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JCheckBoxMenuItem;
import javax.swing.JComboBox;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JSpinner;
import javax.swing.JSplitPane;
import javax.swing.JToggleButton;
import javax.swing.JToolBar;
import javax.swing.SpinnerNumberModel;
import java.awt.BorderLayout;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;

/**
 * The Chart tab: a toolbar (interval/period, chart type, indicators, view
 * controls, contract switcher) above the custom-painted {@link ChartCanvas}.
 */
public final class ChartPanel extends JPanel {

    private final AppState state;
    private final T4Client client;
    private final ChartModel model = new ChartModel();
    private final ChartCanvas chart;
    private final DrawingOverlay drawings = new DrawingOverlay();
    private final OrderPlacement placement;
    private final DomLadderPanel domLadder;

    /** Standard interval presets (label -> API barInterval/barPeriod), matching the other demos. */
    private record Interval(String label, String barInterval, int barPeriod) {
        @Override
        public String toString() {
            return label;
        }
    }

    private static final Interval[] INTERVALS = {
            new Interval("15s", "Second", 15),
            new Interval("30s", "Second", 30),
            new Interval("1m", "Minute", 1),
            new Interval("5m", "Minute", 5),
            new Interval("15m", "Minute", 15),
            new Interval("1h", "Hour", 1),
            new Interval("1D", "Day", 1),
    };

    private final JComboBox<Interval> intervalCombo = new JComboBox<>(INTERVALS);
    private final JSpinner qtySpinner = new JSpinner(new SpinnerNumberModel(1, 1, 100000, 1));
    private final JLabel marketLabel = new JLabel("-");
    /** Suppresses reloads during construction (e.g. the initial setSelectedItem). */
    private boolean reloadWired;

    public ChartPanel(AppState state, T4Client client) {
        this.state = state;
        this.client = client;
        this.chart = new ChartCanvas(state, client, model);
        this.placement = new OrderPlacement(() -> (Integer) qtySpinner.getValue());
        this.domLadder = new DomLadderPanel(state, client, () -> (Integer) qtySpinner.getValue());
        setLayout(new BorderLayout());

        // Overlay order sets both paint z-order and mouse/popup priority:
        // order lines (drag-revise / cancel) > fills > drawings (delete) > placement (price menu).
        chart.addOverlay(new OrderOverlay());
        chart.addOverlay(new FillMarkers());
        chart.addOverlay(drawings);
        chart.addOverlay(placement);

        add(buildToolbar(), BorderLayout.NORTH);
        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, chart, domLadder);
        split.setResizeWeight(1.0);
        split.setDividerLocation(820);
        domLadder.setMinimumSize(new java.awt.Dimension(180, 0));
        add(split, BorderLayout.CENTER);

        chart.setOnNearOldest(client::loadOlderChart);
        intervalCombo.setSelectedItem(INTERVALS[2]); // 1m
        reloadWired = true;
    }

    /** Reload the chart at the currently selected interval/period. */
    private void reloadChart() {
        if (!reloadWired) {
            return;
        }
        Interval sel = (Interval) intervalCombo.getSelectedItem();
        client.loadChart(sel.barInterval(), sel.barPeriod());
    }

    /** Exposed so later milestones (overlays / DOM ladder) can attach to the canvas. */
    public ChartCanvas canvas() {
        return chart;
    }

    private JPanel buildToolbar() {
        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setBorder(BorderFactory.createEmptyBorder(4, 6, 4, 6));

        bar.add(new JLabel(" Interval: "));
        intervalCombo.addActionListener(e -> reloadChart());
        intervalCombo.setMaximumSize(intervalCombo.getPreferredSize());
        bar.add(intervalCombo);
        JButton load = new JButton("Load");
        load.addActionListener(e -> reloadChart());
        bar.add(load);
        bar.addSeparator();

        // Chart type.
        JComboBox<String> typeCombo =
                new JComboBox<>(new String[]{"Candles", "OHLC", "Line", "Area", "Heikin-Ashi"});
        typeCombo.addActionListener(e -> {
            model.chartType = switch (typeCombo.getSelectedIndex()) {
                case 1 -> ChartModel.ChartType.OHLC;
                case 2 -> ChartModel.ChartType.LINE;
                case 3 -> ChartModel.ChartType.AREA;
                case 4 -> ChartModel.ChartType.HEIKIN_ASHI;
                default -> ChartModel.ChartType.CANDLES;
            };
            chart.repaint();
        });
        bar.add(new JLabel(" Type: "));
        typeCombo.setMaximumSize(typeCombo.getPreferredSize());
        bar.add(typeCombo);

        // Indicators popup.
        JButton indicators = new JButton("Indicators ▾");
        JPopupMenu indMenu = new JPopupMenu();
        addIndicatorItem(indMenu, "SMA 20", ChartModel.Indicator.SMA20);
        addIndicatorItem(indMenu, "SMA 50", ChartModel.Indicator.SMA50);
        addIndicatorItem(indMenu, "EMA 20", ChartModel.Indicator.EMA20);
        addIndicatorItem(indMenu, "VWAP", ChartModel.Indicator.VWAP);
        addIndicatorItem(indMenu, "Bollinger (20,2)", ChartModel.Indicator.BOLLINGER);
        indMenu.addSeparator();
        addIndicatorItem(indMenu, "RSI (14)", ChartModel.Indicator.RSI);
        addIndicatorItem(indMenu, "MACD (12,26,9)", ChartModel.Indicator.MACD);
        indicators.addActionListener(e -> indMenu.show(indicators, 0, indicators.getHeight()));
        bar.add(indicators);

        JToggleButton volume = new JToggleButton("Vol", model.showVolume);
        volume.addActionListener(e -> {
            model.showVolume = volume.isSelected();
            chart.repaint();
        });
        bar.add(volume);

        JToggleButton log = new JToggleButton("Log", model.logScale);
        log.addActionListener(e -> {
            model.logScale = log.isSelected();
            chart.repaint();
        });
        bar.add(log);
        bar.addSeparator();

        JButton zoomIn = new JButton("+");
        zoomIn.addActionListener(e -> chart.zoomIn());
        JButton zoomOut = new JButton("−");
        zoomOut.addActionListener(e -> chart.zoomOut());
        JButton latest = new JButton("⇥ Latest");
        latest.addActionListener(e -> chart.scrollToLatest());
        bar.add(zoomIn);
        bar.add(zoomOut);
        bar.add(latest);
        bar.addSeparator();

        // Drawing tools.
        ButtonGroup tools = new ButtonGroup();
        bar.add(toolButton(tools, "Cursor", ChartModel.Tool.CURSOR, true));
        bar.add(toolButton(tools, "Trend", ChartModel.Tool.TRENDLINE, false));
        bar.add(toolButton(tools, "HLine", ChartModel.Tool.HLINE, false));
        bar.add(toolButton(tools, "Measure", ChartModel.Tool.MEASURE, false));
        JButton clear = new JButton("Clear");
        clear.addActionListener(e -> drawings.clear(chart));
        bar.add(clear);
        JButton png = new JButton("Save PNG");
        png.addActionListener(e -> savePng());
        bar.add(png);
        bar.addSeparator();

        // Chart-based order placement (shared qty with the DOM ladder). Mirrors the
        // JS demo: arm a side (Buy/Sell), pick a Type, optionally toggle Bracket, then
        // left-drag on the chart to drop the order at the release price.
        bar.add(new JLabel(" Qty: "));
        qtySpinner.setMaximumSize(qtySpinner.getPreferredSize());
        bar.add(qtySpinner);

        JToggleButton buy = new JToggleButton("Buy");
        JToggleButton sell = new JToggleButton("Sell");
        buy.setToolTipText("Arm the chart to place BUY orders on left-drag");
        sell.setToolTipText("Arm the chart to place SELL orders on left-drag");
        buy.addActionListener(e -> {
            if (buy.isSelected()) {
                sell.setSelected(false);
                placement.beginTool(OrderPlacement.Side.BUY);
            } else {
                placement.cancelTool();
            }
        });
        sell.addActionListener(e -> {
            if (sell.isSelected()) {
                buy.setSelected(false);
                placement.beginTool(OrderPlacement.Side.SELL);
            } else {
                placement.cancelTool();
            }
        });
        // Keep the buttons in sync when the tool disarms programmatically.
        placement.setOnToolChange(side -> {
            buy.setSelected(side == OrderPlacement.Side.BUY);
            sell.setSelected(side == OrderPlacement.Side.SELL);
        });
        bar.add(buy);
        bar.add(sell);

        JComboBox<String> orderType = new JComboBox<>(new String[] {"Auto", "Limit", "Stop", "Market"});
        orderType.setToolTipText("Order type for chart-placed orders (Auto = limit/stop by drop vs last)");
        orderType.setMaximumSize(orderType.getPreferredSize());
        JCheckBox bracket = new JCheckBox("Bracket");
        bracket.setToolTipText("When on, the drop places an entry plus TP/SL sized by the drag distance");
        orderType.addActionListener(e -> {
            OrderPlacement.Type type = switch (orderType.getSelectedIndex()) {
                case 1 -> OrderPlacement.Type.LIMIT;
                case 2 -> OrderPlacement.Type.STOP;
                case 3 -> OrderPlacement.Type.MARKET;
                default -> OrderPlacement.Type.AUTO;
            };
            placement.setOrderType(type);
            boolean market = type == OrderPlacement.Type.MARKET;
            if (market && bracket.isSelected()) {
                bracket.setSelected(false);
                placement.setBracketMode(false);
            }
            bracket.setEnabled(!market);
        });
        bracket.addActionListener(e -> placement.setBracketMode(bracket.isSelected()));
        bar.add(orderType);
        bar.add(bracket);
        bar.addSeparator();

        JButton contract = new JButton("Change Contract…");
        contract.addActionListener(e -> ContractPickerDialog.show(this, state, client));
        bar.add(contract);

        bar.add(new JLabel("  "));
        bar.add(marketLabel);

        JPanel wrap = new JPanel(new BorderLayout());
        wrap.add(bar, BorderLayout.CENTER);
        return wrap;
    }

    private JToggleButton toolButton(ButtonGroup group, String label, ChartModel.Tool tool, boolean selected) {
        JToggleButton b = new JToggleButton(label, selected);
        b.addActionListener(e -> model.tool = tool);
        group.add(b);
        return b;
    }

    private void savePng() {
        BufferedImage img = new BufferedImage(chart.getWidth(), chart.getHeight(), BufferedImage.TYPE_INT_RGB);
        chart.paint(img.getGraphics());
        JFileChooser fc = new JFileChooser();
        fc.setSelectedFile(new File("chart.png"));
        if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) {
            return;
        }
        try {
            ImageIO.write(img, "png", fc.getSelectedFile());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "Save failed: " + ex.getMessage());
        }
    }

    private void addIndicatorItem(JPopupMenu menu, String label, ChartModel.Indicator ind) {
        JCheckBoxMenuItem item = new JCheckBoxMenuItem(label, model.has(ind));
        item.addActionListener(e -> {
            model.toggle(ind, item.isSelected());
            chart.repaint();
        });
        menu.add(item);
    }

    /** Called on the EDT by MainWindow. */
    public void refresh() {
        marketLabel.setText(orDash(state.read(s -> s.marketId)));
        int generation = state.read(s -> s.chartGeneration);
        java.util.List<AppState.Candle> snapshot = state.read(s -> new ArrayList<>(s.candles));
        chart.setData(snapshot, generation);
        domLadder.refresh();
    }

    private static String orDash(String s) {
        return s == null || s.isEmpty() ? "-" : s;
    }
}
