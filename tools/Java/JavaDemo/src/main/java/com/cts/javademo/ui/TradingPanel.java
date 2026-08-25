package com.cts.javademo.ui;

import com.cts.javademo.net.OrderRequest;
import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;

import javax.swing.BorderFactory;
import javax.swing.DefaultComboBoxModel;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.SpinnerNumberModel;
import javax.swing.UIManager;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * The Trading tab: account picker + funds, live quote, order entry (with TP/SL
 * brackets), and positions / orders tables with cancel / flatten / reverse.
 */
public final class TradingPanel extends JPanel {

    private final AppState state;
    private final T4Client client;

    // Account / funds
    private final JComboBox<AppState.AccountInfo> accountCombo = new JComboBox<>();
    private boolean updatingAccounts;
    private final JLabel balanceLabel = new JLabel("-");
    private final JLabel marginLabel = new JLabel("-");
    private final JLabel cashLabel = new JLabel("-");

    // Quote — three cards styled after the Rust demo (Bid green / Ask red / Last blue).
    private final JLabel marketLabel = new JLabel("-");
    private final QuoteCard bidCard = new QuoteCard("Bid",
            new Color(0x4C, 0xAF, 0x50), new Color(0xE8, 0xF5, 0xE9),
            new Color(0xCC, 0xFF, 0xCC), new Color(0x2E, 0x7D, 0x32));
    private final QuoteCard askCard = new QuoteCard("Ask",
            new Color(0xF4, 0x43, 0x36), new Color(0xFF, 0xEB, 0xEE),
            new Color(0xFF, 0xCC, 0xCC), new Color(0xC6, 0x28, 0x28));
    private final QuoteCard lastCard = new QuoteCard("Last",
            new Color(0x19, 0x76, 0xD2), new Color(0xE3, 0xF2, 0xFD),
            new Color(0xCC, 0xE5, 0xFF), new Color(0x0D, 0x47, 0xA1));

    // Order entry
    private final JComboBox<String> sideCombo = new JComboBox<>(new String[]{"Buy", "Sell"});
    private final JComboBox<String> kindCombo = new JComboBox<>(new String[]{"Market", "Limit", "Stop", "StopLimit"});
    private final JSpinner volumeSpinner = new JSpinner(new SpinnerNumberModel(1, 1, 100000, 1));
    private final JTextField limitField = new JTextField(8);
    private final JTextField stopField = new JTextField(8);
    private final JComboBox<String> tifCombo = new JComboBox<>(new String[]{"Day", "GTC", "IOC", "FOK"});
    private final JTextField tpField = new JTextField(6);
    private final JTextField slField = new JTextField(6);

    // Tables
    private final DefaultTableModel positionsModel = new NonEditableModel(
            new String[]{"Market", "Net", "WrkBuy", "WrkSell", "AvgOpen", "RPL", "UPL"}, 0);
    private final JTable positionsTable = new JTable(positionsModel);
    private final DefaultTableModel ordersModel = new NonEditableModel(
            new String[]{"Order", "Market", "Side", "Type", "Vol", "Working", "Limit", "Stop", "Status"}, 0);
    private final JTable ordersTable = new JTable(ordersModel);
    private final DefaultTableModel fillsModel = new NonEditableModel(
            new String[]{"Time", "Side", "Vol", "Price"}, 0);
    private final JTable fillsTable = new JTable(fillsModel);

    private static final Color GREEN = new Color(0x2e, 0xbd, 0x6e);
    private static final Color RED = new Color(0xef, 0x53, 0x50);
    private static final DateTimeFormatter FILL_FMT =
            DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneOffset.UTC);

    private int prevFillGen = -1;
    private boolean limitFieldWasEnabled;

    public TradingPanel(AppState state, T4Client client) {
        this.state = state;
        this.client = client;
        setLayout(new BorderLayout(8, 8));
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        add(buildHeader(), BorderLayout.NORTH);

        JPanel left = new JPanel(new BorderLayout(6, 6));
        left.add(buildQuotePanel(), BorderLayout.NORTH);
        left.add(buildOrderEntry(), BorderLayout.CENTER);
        left.setPreferredSize(new Dimension(340, 400));
        add(left, BorderLayout.WEST);

        add(buildTables(), BorderLayout.CENTER);

        // Colour realized/unrealized P&L green/red.
        PnlRenderer pnl = new PnlRenderer();
        positionsTable.getColumnModel().getColumn(5).setCellRenderer(pnl); // RPL
        positionsTable.getColumnModel().getColumn(6).setCellRenderer(pnl); // UPL
        fillsTable.getColumnModel().getColumn(1).setCellRenderer(new SideRenderer());
    }

    // -----------------------------------------------------------------------
    // Layout
    // -----------------------------------------------------------------------

    private JComponent buildHeader() {
        JPanel p = new JPanel(new GridBagLayout());
        GridBagConstraints g = gbc();
        p.add(new JLabel("Account:"), g);
        g.gridx++;
        accountCombo.setPreferredSize(new Dimension(220, 24));
        accountCombo.addActionListener(e -> {
            if (updatingAccounts) {
                return;
            }
            AppState.AccountInfo sel = (AppState.AccountInfo) accountCombo.getSelectedItem();
            if (sel != null) {
                client.subscribeAccount(sel.accountId);
            }
        });
        p.add(accountCombo, g);
        g.gridx++;
        balanceLabel.setToolTipText("Account balance");
        marginLabel.setToolTipText("Margin requirement");
        cashLabel.setToolTipText("Available cash");
        p.add(fundLabel("Balance:", balanceLabel), g);
        g.gridx++;
        p.add(fundLabel("Margin:", marginLabel), g);
        g.gridx++;
        p.add(fundLabel("Cash:", cashLabel), g);
        return p;
    }

    private JComponent buildQuotePanel() {
        JPanel p = new JPanel(new BorderLayout(0, 6));
        p.setBorder(BorderFactory.createTitledBorder("Market Data"));

        JPanel header = new JPanel(new BorderLayout(6, 0));
        JPanel marketBox = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        marketBox.add(new JLabel("Market:"));
        marketBox.add(bold(marketLabel));
        header.add(marketBox, BorderLayout.WEST);

        JPanel pickers = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 0));
        JButton contractBtn = new JButton("Contract…");
        contractBtn.addActionListener(e -> ContractPickerDialog.show(this, state, client));
        JButton expiryBtn = new JButton("Expiry…");
        expiryBtn.addActionListener(e -> ExpiryPickerDialog.show(this, state, client));
        pickers.add(contractBtn);
        pickers.add(expiryBtn);
        header.add(pickers, BorderLayout.EAST);
        p.add(header, BorderLayout.NORTH);

        JPanel cards = new JPanel(new GridLayout(1, 3, 6, 0));
        cards.add(bidCard);
        cards.add(askCard);
        cards.add(lastCard);
        p.add(cards, BorderLayout.CENTER);
        return p;
    }

    private JComponent buildOrderEntry() {
        JPanel p = new JPanel(new GridBagLayout());
        p.setBorder(BorderFactory.createTitledBorder("Order Entry"));
        GridBagConstraints g = gbc();

        addRow(p, g, "Side:", sideCombo);
        addRow(p, g, "Type:", kindCombo);
        addRow(p, g, "Volume:", volumeSpinner);
        addRow(p, g, "Limit:", limitField);
        addRow(p, g, "Stop:", stopField);
        addRow(p, g, "TIF:", tifCombo);
        addRow(p, g, "TP $:", tpField);
        addRow(p, g, "SL $:", slField);

        JButton submit = new JButton("Submit Order");
        submit.addActionListener(e -> submitOrder());
        g.gridx = 0;
        g.gridy++;
        g.gridwidth = 2;
        p.add(submit, g);

        JPanel posBtns = new JPanel(new GridLayout(1, 3, 4, 0));
        JButton flatten = new JButton("Flatten");
        flatten.addActionListener(e -> positionAction(false));
        JButton reverse = new JButton("Reverse");
        reverse.addActionListener(e -> positionAction(true));
        JButton cancelAll = new JButton("Cancel All");
        cancelAll.addActionListener(e -> {
            String acct = state.read(s -> s.selectedAccount);
            if (acct != null) {
                client.cancelAll(acct);
            }
        });
        posBtns.add(flatten);
        posBtns.add(reverse);
        posBtns.add(cancelAll);
        g.gridy++;
        p.add(posBtns, g);

        kindCombo.addActionListener(e -> updateOrderFields());
        updateOrderFields();
        return p;
    }

    private JComponent buildTables() {
        JPanel p = new JPanel(new GridLayout(3, 1, 6, 6));

        JPanel posWrap = new JPanel(new BorderLayout());
        posWrap.setBorder(BorderFactory.createTitledBorder("Positions"));
        posWrap.add(new JScrollPane(positionsTable), BorderLayout.CENTER);

        JPanel ordWrap = new JPanel(new BorderLayout());
        ordWrap.setBorder(BorderFactory.createTitledBorder("Orders"));
        ordWrap.add(new JScrollPane(ordersTable), BorderLayout.CENTER);
        JButton cancel = new JButton("Cancel Selected");
        cancel.addActionListener(e -> cancelSelectedOrder());
        JPanel ordBtns = new JPanel(new BorderLayout());
        ordBtns.add(cancel, BorderLayout.WEST);
        ordWrap.add(ordBtns, BorderLayout.SOUTH);

        JPanel fillWrap = new JPanel(new BorderLayout());
        fillWrap.setBorder(BorderFactory.createTitledBorder("Fills"));
        fillWrap.add(new JScrollPane(fillsTable), BorderLayout.CENTER);

        p.add(posWrap);
        p.add(ordWrap);
        p.add(fillWrap);
        return p;
    }

    // -----------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------

    private void submitOrder() {
        String acct = state.read(s -> s.selectedAccount);
        if (acct == null) {
            JOptionPane.showMessageDialog(this, "No account selected.");
            return;
        }
        OrderRequest req = new OrderRequest();
        req.accountId = acct;
        req.buy = sideCombo.getSelectedIndex() == 0;
        req.kind = switch (kindCombo.getSelectedIndex()) {
            case 1 -> OrderRequest.Kind.LIMIT;
            case 2 -> OrderRequest.Kind.STOP;
            case 3 -> OrderRequest.Kind.STOP_LIMIT;
            default -> OrderRequest.Kind.MARKET;
        };
        req.volume = (Integer) volumeSpinner.getValue();
        req.limitPrice = limitField.getText();
        req.stopPrice = stopField.getText();
        req.tif = switch (tifCombo.getSelectedIndex()) {
            case 1 -> OrderRequest.TimeInForce.GTC;
            case 2 -> OrderRequest.TimeInForce.IOC;
            case 3 -> OrderRequest.TimeInForce.FOK;
            default -> OrderRequest.TimeInForce.DAY;
        };
        req.takeProfit = parseOrNull(tpField.getText());
        req.stopLoss = parseOrNull(slField.getText());
        client.submitOrder(req);
    }

    private void positionAction(boolean reverse) {
        String acct = state.read(s -> s.selectedAccount);
        String market = selectedPositionMarket();
        if (market == null) {
            market = state.read(s -> s.marketId);
        }
        if (acct == null || market == null) {
            JOptionPane.showMessageDialog(this, "No account/market selected.");
            return;
        }
        client.flattenOrReverse(acct, market, reverse);
    }

    private void cancelSelectedOrder() {
        int row = ordersTable.getSelectedRow();
        if (row < 0) {
            return;
        }
        String uniqueId = (String) ordersModel.getValueAt(row, 0);
        String market = (String) ordersModel.getValueAt(row, 1);
        String acct = state.read(s -> s.selectedAccount);
        if (acct != null) {
            client.cancelOrder(acct, market, uniqueId);
        }
    }

    private String selectedPositionMarket() {
        int row = positionsTable.getSelectedRow();
        return row < 0 ? null : (String) positionsModel.getValueAt(row, 0);
    }

    private void updateOrderFields() {
        OrderRequest.Kind kind = switch (kindCombo.getSelectedIndex()) {
            case 1 -> OrderRequest.Kind.LIMIT;
            case 2 -> OrderRequest.Kind.STOP;
            case 3 -> OrderRequest.Kind.STOP_LIMIT;
            default -> OrderRequest.Kind.MARKET;
        };
        // When the limit price field first becomes relevant (switching to a
        // Limit / StopLimit order), seed it with the current market price so the
        // user starts from a sensible level instead of an empty field.
        if (kind.hasLimit() && !limitFieldWasEnabled) {
            String price = currentPrice();
            if (!price.isEmpty()) {
                limitField.setText(price);
            }
        }
        limitFieldWasEnabled = kind.hasLimit();

        limitField.setEnabled(kind.hasLimit());
        stopField.setEnabled(kind.hasStop());
    }

    /** Current market price to seed the limit field: side-appropriate, last as fallback. */
    private String currentPrice() {
        boolean buy = sideCombo.getSelectedIndex() == 0;
        return state.read(s -> {
            String side = buy ? s.quote.bidPrice : s.quote.askPrice;
            if (side != null && !side.isEmpty()) {
                return side;
            }
            String last = s.quote.lastPrice;
            if (last != null && !last.isEmpty()) {
                return last;
            }
            String other = buy ? s.quote.askPrice : s.quote.bidPrice;
            return other == null ? "" : other;
        });
    }

    // -----------------------------------------------------------------------
    // Refresh (called on EDT by MainWindow)
    // -----------------------------------------------------------------------

    public void refresh() {
        refreshAccounts();

        balanceLabel.setText(money(state.read(s -> s.balance)));
        marginLabel.setText(money(state.read(s -> s.margin)));
        cashLabel.setText(money(state.read(s -> s.availableCash)));

        marketLabel.setText(orDash(state.read(s -> s.marketId)));
        AppState.Quote q = state.read(s -> {
            AppState.Quote c = new AppState.Quote();
            c.bidPrice = s.quote.bidPrice;
            c.bidVolume = s.quote.bidVolume;
            c.askPrice = s.quote.askPrice;
            c.askVolume = s.quote.askVolume;
            c.lastPrice = s.quote.lastPrice;
            c.lastVolume = s.quote.lastVolume;
            return c;
        });
        bidCard.update(q.bidPrice, q.bidVolume);
        askCard.update(q.askPrice, q.askVolume);
        lastCard.update(q.lastPrice, q.lastVolume);

        refreshPositions();
        refreshOrders();
        refreshFills();
    }

    private void refreshFills() {
        int gen = state.read(s -> s.fillGeneration);
        if (gen == prevFillGen) {
            return;
        }
        prevFillGen = gen;
        List<AppState.Fill> fills = state.read(s -> new ArrayList<>(s.fills));
        fillsModel.setRowCount(0);
        int from = Math.max(0, fills.size() - 100);
        for (int i = fills.size() - 1; i >= from; i--) {
            AppState.Fill f = fills.get(i);
            fillsModel.addRow(new Object[]{
                    FILL_FMT.format(Instant.ofEpochMilli(f.timeMs)),
                    f.buy ? "Buy" : "Sell", f.volume, f.price});
        }
    }

    private void refreshAccounts() {
        List<AppState.AccountInfo> accts = state.read(s -> new ArrayList<>(s.accounts));
        String selected = state.read(s -> s.selectedAccount);
        if (accountCombo.getItemCount() == accts.size() && accountCombo.getItemCount() > 0) {
            return; // already populated
        }
        updatingAccounts = true;
        try {
            accountCombo.setModel(new DefaultComboBoxModel<>(accts.toArray(new AppState.AccountInfo[0])));
            if (selected != null) {
                for (int i = 0; i < accts.size(); i++) {
                    if (accts.get(i).accountId.equals(selected)) {
                        accountCombo.setSelectedIndex(i);
                        break;
                    }
                }
            }
        } finally {
            updatingAccounts = false;
        }
    }

    private void refreshPositions() {
        String keep = selectedPositionMarket();
        List<AppState.PositionRow> rows = state.read(s -> new ArrayList<>(s.positions.values()));
        positionsModel.setRowCount(0);
        for (AppState.PositionRow r : rows) {
            positionsModel.addRow(new Object[]{
                    r.marketId, r.net, r.workingBuys, r.workingSells,
                    fmt(r.avgOpenPrice), money(r.rpl), money(r.upl)});
        }
        reselect(positionsTable, positionsModel, 0, keep);
    }

    private void refreshOrders() {
        String keep = ordersTable.getSelectedRow() < 0 ? null
                : (String) ordersModel.getValueAt(ordersTable.getSelectedRow(), 0);
        List<AppState.OrderRow> rows = state.read(s -> new ArrayList<>(s.orders.values()));
        ordersModel.setRowCount(0);
        for (AppState.OrderRow r : rows) {
            ordersModel.addRow(new Object[]{
                    r.uniqueId, r.marketId, r.side, r.priceType, r.volume, r.workingVolume,
                    r.limitPrice, r.stopPrice, r.status});
        }
        reselect(ordersTable, ordersModel, 0, keep);
    }

    private static void reselect(JTable table, DefaultTableModel model, int keyCol, String key) {
        if (key == null) {
            return;
        }
        for (int i = 0; i < model.getRowCount(); i++) {
            if (key.equals(model.getValueAt(i, keyCol))) {
                table.setRowSelectionInterval(i, i);
                return;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    private static GridBagConstraints gbc() {
        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(3, 4, 3, 4);
        g.anchor = GridBagConstraints.WEST;
        g.gridx = 0;
        g.gridy = 0;
        return g;
    }

    private static void addRow(JPanel p, GridBagConstraints g, String label, JComponent field) {
        g.gridx = 0;
        g.gridy++;
        g.gridwidth = 1;
        p.add(new JLabel(label), g);
        g.gridx = 1;
        p.add(field, g);
    }

    private static JComponent fundLabel(String caption, JLabel value) {
        JPanel p = new JPanel();
        p.add(new JLabel(caption));
        p.add(bold(value));
        return p;
    }

    private static JLabel bold(JLabel l) {
        l.setFont(l.getFont().deriveFont(Font.BOLD));
        return l;
    }

    private static String money(double v) {
        return String.format("%,.2f", v);
    }

    private static String fmt(double v) {
        return v == 0 ? "-" : String.format("%.4f", v);
    }

    private static String orDash(String s) {
        return s == null || s.isEmpty() ? "-" : s;
    }

    private static Double parseOrNull(String s) {
        if (s == null || s.trim().isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Colours a numeric money cell green (positive) / red (negative). */
    private static final class PnlRenderer extends DefaultTableCellRenderer {
        @Override
        public Component getTableCellRendererComponent(JTable table, Object value, boolean sel,
                                                       boolean focus, int row, int col) {
            Component c = super.getTableCellRendererComponent(table, value, sel, focus, row, col);
            double v = parseMoney(value);
            if (!sel) {
                c.setForeground(v > 0 ? GREEN : v < 0 ? RED : UIManager.getColor("Table.foreground"));
            }
            return c;
        }

        private static double parseMoney(Object value) {
            if (value == null) {
                return 0;
            }
            try {
                return Double.parseDouble(value.toString().replace(",", ""));
            } catch (NumberFormatException e) {
                return 0;
            }
        }
    }

    /** Colours a Buy/Sell cell. */
    private static final class SideRenderer extends DefaultTableCellRenderer {
        @Override
        public Component getTableCellRendererComponent(JTable table, Object value, boolean sel,
                                                       boolean focus, int row, int col) {
            Component c = super.getTableCellRendererComponent(table, value, sel, focus, row, col);
            if (!sel) {
                c.setForeground("Buy".equals(value) ? GREEN : "Sell".equals(value) ? RED
                        : UIManager.getColor("Table.foreground"));
            }
            return c;
        }
    }

    private static final class NonEditableModel extends DefaultTableModel {
        NonEditableModel(String[] columns, int rows) {
            super(columns, rows);
        }

        @Override
        public boolean isCellEditable(int row, int column) {
            return false;
        }
    }
}
