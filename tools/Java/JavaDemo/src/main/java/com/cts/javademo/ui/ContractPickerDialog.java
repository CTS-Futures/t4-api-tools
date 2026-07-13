package com.cts.javademo.ui;

import com.cts.javademo.net.RestClient;
import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.JTree;
import javax.swing.SwingWorker;
import javax.swing.Timer;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
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
 * Modal contract picker with two modes (mirrors the other demos): free-text
 * search (≥2 chars, results grouped by exchange) and browse-by-exchange, where
 * each exchange lazily loads its contracts on expand. Selecting a contract
 * switches the active market (resolved to a market id via {@code firstmarket}).
 */
public final class ContractPickerDialog {

    /** Marker child so an unexpanded exchange node shows a toggle handle. */
    private static final String PLACEHOLDER = "Loading…";

    private ContractPickerDialog() {
    }

    public static void show(Component parent, AppState state, T4Client client) {
        Window owner = parent == null ? null : javax.swing.SwingUtilities.getWindowAncestor(parent);
        JDialog dialog = new JDialog(owner, "Change Contract", JDialog.ModalityType.APPLICATION_MODAL);
        dialog.setLayout(new BorderLayout(6, 6));

        JTextField searchField = new JTextField(20);
        JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT));
        top.add(new JLabel("Search:"));
        top.add(searchField);

        DefaultMutableTreeNode root = new DefaultMutableTreeNode("root");
        DefaultTreeModel model = new DefaultTreeModel(root);
        JTree tree = new JTree(model);
        tree.setRootVisible(false);
        tree.setShowsRootHandles(true);
        tree.getSelectionModel().setSelectionMode(TreeSelectionModel.SINGLE_TREE_SELECTION);
        tree.setCellRenderer(new ContractCellRenderer());

        JButton ok = new JButton("Select");
        JButton cancel = new JButton("Cancel");
        JPanel bottom = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        bottom.add(ok);
        bottom.add(cancel);

        dialog.add(top, BorderLayout.NORTH);
        dialog.add(new JScrollPane(tree), BorderLayout.CENTER);
        dialog.add(bottom, BorderLayout.SOUTH);
        dialog.setPreferredSize(new Dimension(460, 400));

        // Lazy-load contracts when an exchange node is first expanded.
        tree.addTreeWillExpandListener(new TreeWillExpandListener() {
            @Override
            public void treeWillExpand(TreeExpansionEvent event) throws ExpandVetoException {
                DefaultMutableTreeNode node =
                        (DefaultMutableTreeNode) event.getPath().getLastPathComponent();
                if (!(node.getUserObject() instanceof RestClient.ExchangeInfo ex) || !isPlaceholder(node)) {
                    return;
                }
                String token = state.read(s -> s.authToken);
                if (token == null) {
                    return;
                }
                new SwingWorker<List<RestClient.ContractHit>, Void>() {
                    @Override
                    protected List<RestClient.ContractHit> doInBackground() throws Exception {
                        return client.rest().loadContracts(token, ex.exchangeId());
                    }

                    @Override
                    protected void done() {
                        node.removeAllChildren();
                        try {
                            for (RestClient.ContractHit hit : get()) {
                                node.add(new DefaultMutableTreeNode(hit));
                            }
                            if (node.getChildCount() == 0) {
                                node.add(new DefaultMutableTreeNode("(no contracts)"));
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

        // Browse mode: list all exchanges (each with a placeholder child).
        Runnable loadExchanges = () -> {
            String token = state.read(s -> s.authToken);
            if (token == null) {
                return;
            }
            new SwingWorker<List<RestClient.ExchangeInfo>, Void>() {
                @Override
                protected List<RestClient.ExchangeInfo> doInBackground() throws Exception {
                    return client.rest().loadExchanges(token);
                }

                @Override
                protected void done() {
                    root.removeAllChildren();
                    try {
                        for (RestClient.ExchangeInfo ex : get()) {
                            DefaultMutableTreeNode n = new DefaultMutableTreeNode(ex);
                            n.add(new DefaultMutableTreeNode(PLACEHOLDER));
                            root.add(n);
                        }
                    } catch (Exception e) {
                        JOptionPane.showMessageDialog(dialog, "Failed to load exchanges: " + e.getMessage());
                    }
                    model.reload();
                }
            }.execute();
        };

        // Search mode: results grouped by exchange, expanded.
        Runnable doSearch = () -> {
            String token = state.read(s -> s.authToken);
            String term = searchField.getText().trim();
            if (token == null) {
                return;
            }
            if (term.length() < 2) {
                loadExchanges.run();
                return;
            }
            new SwingWorker<List<RestClient.ContractHit>, Void>() {
                @Override
                protected List<RestClient.ContractHit> doInBackground() throws Exception {
                    return client.rest().searchContracts(token, term);
                }

                @Override
                protected void done() {
                    root.removeAllChildren();
                    try {
                        Map<String, DefaultMutableTreeNode> groups = new LinkedHashMap<>();
                        for (RestClient.ContractHit hit : get()) {
                            DefaultMutableTreeNode group = groups.computeIfAbsent(hit.exchangeId(), ex -> {
                                DefaultMutableTreeNode g = new DefaultMutableTreeNode(
                                        new RestClient.ExchangeInfo(ex, ex));
                                root.add(g);
                                return g;
                            });
                            group.add(new DefaultMutableTreeNode(hit));
                        }
                        if (root.getChildCount() == 0) {
                            root.add(new DefaultMutableTreeNode("(no results)"));
                        }
                        model.reload();
                        for (int i = 0; i < tree.getRowCount(); i++) {
                            tree.expandRow(i);
                        }
                    } catch (Exception e) {
                        JOptionPane.showMessageDialog(dialog, "Search failed: " + e.getMessage());
                    }
                }
            }.execute();
        };

        // Debounce typing so we don't fire a request per keystroke.
        Timer debounce = new Timer(250, e -> doSearch.run());
        debounce.setRepeats(false);
        searchField.getDocument().addDocumentListener(new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent e) { debounce.restart(); }
            @Override public void removeUpdate(DocumentEvent e) { debounce.restart(); }
            @Override public void changedUpdate(DocumentEvent e) { debounce.restart(); }
        });
        searchField.addActionListener(e -> doSearch.run());

        Runnable doSelect = () -> {
            DefaultMutableTreeNode node = (DefaultMutableTreeNode) tree.getLastSelectedPathComponent();
            if (node == null || !(node.getUserObject() instanceof RestClient.ContractHit hit)) {
                return;
            }
            client.selectMarket(hit.exchangeId(), hit.contractId());
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
                            && n.getUserObject() instanceof RestClient.ContractHit) {
                        doSelect.run();
                    }
                }
            }
        });

        loadExchanges.run();
        dialog.pack();
        dialog.setLocationRelativeTo(owner);
        dialog.setVisible(true);
    }

    private static boolean isPlaceholder(DefaultMutableTreeNode node) {
        return node.getChildCount() == 1
                && PLACEHOLDER.equals(((DefaultMutableTreeNode) node.getChildAt(0)).getUserObject());
    }

    /** Renders exchange group rows and contract leaves distinctly. */
    private static final class ContractCellRenderer extends javax.swing.tree.DefaultTreeCellRenderer {
        @Override
        public Component getTreeCellRendererComponent(JTree tree, Object value, boolean sel,
                                                      boolean expanded, boolean leaf, int row, boolean focus) {
            super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, focus);
            Object user = ((DefaultMutableTreeNode) value).getUserObject();
            if (user instanceof RestClient.ContractHit hit) {
                setText(hit.contractId() + (hit.description().isEmpty() ? "" : "  —  " + hit.description()));
            } else if (user instanceof RestClient.ExchangeInfo ex) {
                setText(ex.description().isEmpty() ? ex.exchangeId() : ex.exchangeId() + "  —  " + ex.description());
            }
            return this;
        }
    }
}
