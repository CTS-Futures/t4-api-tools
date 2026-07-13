package com.cts.javademo.ui;

import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;
import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.FlatLightLaf;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;
import javax.swing.JToolBar;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Top-level demo window: a toolbar (connection status, market breadcrumb, theme
 * toggle), a tabbed body (Trading / Chart), and a collapsible log console.
 *
 * <p>Subscribes to {@link AppState}; every state change triggers a refresh
 * marshalled onto the Swing EDT.
 */
public final class MainWindow {

    private final AppState state;
    private final T4Client client;

    private final JFrame frame = new JFrame("T4 Java Demo");
    private final JLabel statusChip = new JLabel("● Disconnected");
    private final JLabel breadcrumb = new JLabel("—");
    private final JButton themeToggle = new JButton("☀");
    private final JTextArea logArea = new JTextArea();
    private final JTabbedPane tabs = new JTabbedPane();
    private TradingPanel tradingPanel;
    private ChartPanel chartPanel;

    private boolean dark = true;

    /** Guards against queuing a fresh EDT refresh for every state write under a busy market. */
    private final AtomicBoolean refreshPending = new AtomicBoolean(false);

    public MainWindow(AppState state, T4Client client) {
        this.state = state;
        this.client = client;
        build();
        state.addListener(this::refreshLater);
    }

    private void build() {
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.setLayout(new BorderLayout());
        frame.setPreferredSize(new Dimension(1280, 820));

        frame.add(buildToolbar(), BorderLayout.NORTH);

        tradingPanel = new TradingPanel(state, client);
        chartPanel = new ChartPanel(state, client);
        tabs.addTab("Trading", tradingPanel);
        tabs.addTab("Chart", chartPanel);

        logArea.setEditable(false);
        logArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
        JScrollPane logScroll = new JScrollPane(logArea);
        logScroll.setBorder(BorderFactory.createTitledBorder("Log"));

        JSplitPane split = new JSplitPane(JSplitPane.VERTICAL_SPLIT, tabs, logScroll);
        split.setResizeWeight(0.82);
        split.setDividerLocation(640);
        logScroll.setMinimumSize(new Dimension(0, 60));
        frame.add(split, BorderLayout.CENTER);
    }

    private JToolBar buildToolbar() {
        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setBorder(BorderFactory.createEmptyBorder(6, 10, 6, 10));

        statusChip.setFont(statusChip.getFont().deriveFont(Font.BOLD, 13f));
        bar.add(statusChip);
        bar.add(Box.createHorizontalStrut(18));
        bar.add(new JLabel("Market: "));
        breadcrumb.setFont(breadcrumb.getFont().deriveFont(Font.BOLD));
        bar.add(breadcrumb);

        bar.add(Box.createHorizontalGlue());
        themeToggle.setToolTipText("Toggle light / dark theme");
        themeToggle.addActionListener(e -> toggleTheme());
        bar.add(themeToggle);
        return bar;
    }

    private void toggleTheme() {
        dark = !dark;
        state.write(s -> s.darkMode = dark);
        try {
            UIManager.setLookAndFeel(dark ? new FlatDarkLaf() : new FlatLightLaf());
            FlatLaf.updateUI();
        } catch (Exception ignored) {
            // keep current L&F on failure
        }
        themeToggle.setText(dark ? "☀" : "🌙");
    }

    public void show() {
        SwingUtilities.invokeLater(() -> {
            frame.pack();
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
            refresh();
        });
    }

    private void refreshLater() {
        // Coalesce bursts of state writes (quote/depth ticks) into a single EDT refresh:
        // only schedule when no refresh is already pending. The flag is cleared before
        // refresh() runs, so writes arriving mid-refresh queue the next one.
        if (refreshPending.compareAndSet(false, true)) {
            SwingUtilities.invokeLater(() -> {
                refreshPending.set(false);
                refresh();
            });
        }
    }

    private void refresh() {
        AppState.ConnStatus conn = state.read(s -> s.connection);
        int accountCount = state.read(s -> s.accounts.size());
        statusChip.setText("● " + statusText(conn, accountCount));
        statusChip.setForeground(statusColor(conn));
        breadcrumb.setText(breadcrumbText());

        String logText = state.read(s -> String.join("\n", s.logLines));
        if (!logText.equals(logArea.getText())) {
            logArea.setText(logText);
            logArea.setCaretPosition(logArea.getDocument().getLength());
        }

        if (tradingPanel != null) {
            tradingPanel.refresh();
        }
        if (chartPanel != null) {
            chartPanel.refresh();
        }
    }

    private String breadcrumbText() {
        return state.read(s -> {
            if (s.marketId == null) {
                return "—";
            }
            String ex = s.exchangeId == null ? "" : s.exchangeId;
            String ct = s.contractId == null ? "" : s.contractId;
            return ex + " / " + ct + "  →  " + s.marketId;
        });
    }

    private static String statusText(AppState.ConnStatus conn, int accountCount) {
        return switch (conn) {
            case DISCONNECTED -> "Disconnected";
            case CONNECTING -> "Connecting…";
            case CONNECTED -> "Connected — logging in…";
            case LOGGED_IN -> "Logged in (" + accountCount + " account" + (accountCount == 1 ? "" : "s") + ")";
            case ERROR -> "Connection error";
        };
    }

    private static Color statusColor(AppState.ConnStatus conn) {
        return switch (conn) {
            case LOGGED_IN -> new Color(0x2e, 0xbd, 0x6e);
            case CONNECTED, CONNECTING -> new Color(0xe0, 0xa8, 0x40);
            case ERROR -> new Color(0xef, 0x53, 0x50);
            default -> new Color(0x8a, 0x8f, 0x99);
        };
    }
}
