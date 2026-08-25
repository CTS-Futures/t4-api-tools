package com.cts.javademo.ui;

import com.cts.javademo.net.RestClient;
import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTree;
import javax.swing.SwingWorker;
import javax.swing.event.TreeExpansionEvent;
import javax.swing.event.TreeWillExpandListener;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeModel;
import javax.swing.tree.ExpandVetoException;
import javax.swing.tree.TreePath;
import javax.swing.tree.TreeSelectionModel;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Window;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Modal expiry picker for the currently active contract: a strategy → expiry-group
 * tree whose markets lazily load on expand. Selecting a market switches directly to
 * that exact market id (via {@link T4Client#selectMarketById}), bypassing the
 * {@code firstmarket} default-market resolution.
 */
public final class ExpiryPickerDialog {

    private static final String PLACEHOLDER = "Loading…";

    private ExpiryPickerDialog() {
    }

    public static void show(Component parent, AppState state, T4Client client) {
        String exchangeId = state.read(s -> s.exchangeId);
        String contractId = state.read(s -> s.contractId);
        String token = state.read(s -> s.authToken);
        if (token == null || exchangeId == null || contractId == null) {
            JOptionPane.showMessageDialog(parent, "Select a contract first.");
            return;
        }

        Window owner = parent == null ? null : javax.swing.SwingUtilities.getWindowAncestor(parent);
        JDialog dialog = new JDialog(owner, "Select Expiry — " + exchangeId + "/" + contractId,
                JDialog.ModalityType.APPLICATION_MODAL);
        dialog.setLayout(new BorderLayout(6, 6));

        DefaultMutableTreeNode root = new DefaultMutableTreeNode("root");
        DefaultTreeModel model = new DefaultTreeModel(root);
        JTree tree = new JTree(model);
        tree.setRootVisible(false);
        tree.setShowsRootHandles(true);
        tree.getSelectionModel().setSelectionMode(TreeSelectionModel.SINGLE_TREE_SELECTION);
        tree.setCellRenderer(new ExpiryCellRenderer());

        JButton ok = new JButton("Select");
        JButton cancel = new JButton("Cancel");
        JPanel bottom = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        bottom.add(ok);
        bottom.add(cancel);

        dialog.add(new JScrollPane(tree), BorderLayout.CENTER);
        dialog.add(bottom, BorderLayout.SOUTH);
        dialog.setPreferredSize(new Dimension(460, 400));

        // Lazy-load markets when an expiry-group node is first expanded.
        tree.addTreeWillExpandListener(new TreeWillExpandListener() {
            @Override
            public void treeWillExpand(TreeExpansionEvent event) throws ExpandVetoException {
                DefaultMutableTreeNode node =
                        (DefaultMutableTreeNode) event.getPath().getLastPathComponent();
                if (!(node.getUserObject() instanceof RestClient.ExpiryGroup group) || !isPlaceholder(node)) {
                    return;
                }
                new SwingWorker<List<RestClient.ExpiryMarket>, Void>() {
                    @Override
                    protected List<RestClient.ExpiryMarket> doInBackground() throws Exception {
                        return client.rest().loadExpiryMarkets(token, exchangeId, contractId,
                                group.strategyType(), group.expiryDate());
                    }

                    @Override
                    protected void done() {
                        node.removeAllChildren();
                        try {
                            for (RestClient.ExpiryMarket m : get()) {
                                node.add(new DefaultMutableTreeNode(m));
                            }
                            if (node.getChildCount() == 0) {
                                node.add(new DefaultMutableTreeNode("(no markets)"));
                            }
                        } catch (Exception e) {
                            node.add(new DefaultMutableTreeNode("(load failed)"));
                        }
                        model.nodeStructureChanged(node);
                    }
                }.execute();
            }

            @Override
            public void treeWillCollapse(TreeExpansionEvent event) {
            }
        });

        // Load expiry groups, nested under their strategy type.
        new SwingWorker<List<RestClient.ExpiryGroup>, Void>() {
            @Override
            protected List<RestClient.ExpiryGroup> doInBackground() throws Exception {
                return client.rest().loadExpiryGroups(token, exchangeId, contractId);
            }

            @Override
            protected void done() {
                root.removeAllChildren();
                try {
                    Map<String, DefaultMutableTreeNode> strategies = new LinkedHashMap<>();
                    for (RestClient.ExpiryGroup g : get()) {
                        DefaultMutableTreeNode strat = strategies.computeIfAbsent(g.strategyType(), st -> {
                            DefaultMutableTreeNode n = new DefaultMutableTreeNode(st);
                            root.add(n);
                            return n;
                        });
                        DefaultMutableTreeNode groupNode = new DefaultMutableTreeNode(g);
                        groupNode.add(new DefaultMutableTreeNode(PLACEHOLDER));
                        strat.add(groupNode);
                    }
                    if (root.getChildCount() == 0) {
                        root.add(new DefaultMutableTreeNode("(no expiries)"));
                    }
                    model.reload();
                    for (int i = 0; i < tree.getRowCount(); i++) {
                        tree.expandRow(i);
                    }
                } catch (Exception e) {
                    JOptionPane.showMessageDialog(dialog, "Failed to load expiries: " + e.getMessage());
                }
            }
        }.execute();

        Runnable doSelect = () -> {
            DefaultMutableTreeNode node = (DefaultMutableTreeNode) tree.getLastSelectedPathComponent();
            if (node == null || !(node.getUserObject() instanceof RestClient.ExpiryMarket m)) {
                return;
            }
            client.selectMarketById(exchangeId, contractId, m.marketId());
            dialog.dispose();
        };

        ok.addActionListener(e -> doSelect.run());
        cancel.addActionListener(e -> dialog.dispose());
        tree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) {
                    TreePath path = tree.getPathForLocation(e.getX(), e.getY());
                    if (path != null && path.getLastPathComponent() instanceof DefaultMutableTreeNode n
                            && n.getUserObject() instanceof RestClient.ExpiryMarket) {
                        doSelect.run();
                    }
                }
            }
        });

        dialog.pack();
        dialog.setLocationRelativeTo(owner);
        dialog.setVisible(true);
    }

    private static boolean isPlaceholder(DefaultMutableTreeNode node) {
        return node.getChildCount() == 1
                && PLACEHOLDER.equals(((DefaultMutableTreeNode) node.getChildAt(0)).getUserObject());
    }

    /** Renders expiry-group and market rows with friendly labels. */
    private static final class ExpiryCellRenderer extends javax.swing.tree.DefaultTreeCellRenderer {
        @Override
        public Component getTreeCellRendererComponent(JTree tree, Object value, boolean sel,
                                                      boolean expanded, boolean leaf, int row, boolean focus) {
            super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, focus);
            Object user = ((DefaultMutableTreeNode) value).getUserObject();
            if (user instanceof RestClient.ExpiryGroup g) {
                String label = g.expiryDate().isEmpty() ? g.strategyType() : g.expiryDate();
                setText(label + "  (" + g.marketCount() + ")");
            } else if (user instanceof RestClient.ExpiryMarket m) {
                String desc = m.description().isEmpty() ? m.marketId() : m.description();
                setText(desc + "  —  " + m.marketId());
            }
            return this;
        }
    }
}
