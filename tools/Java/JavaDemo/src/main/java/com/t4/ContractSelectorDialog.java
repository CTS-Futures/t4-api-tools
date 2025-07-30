/* package com.t4;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;

public class ContractSelectorDialog {
    private final T4APIClientTest client;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();
    private  Consumer<ContractData> onSelect;
    private TextField searchField;
    private boolean isSearchMode = false;

    public ContractSelectorDialog(T4APIClientTest client) {
        this.client = client;
    }



    public void show(Consumer<ContractData> onSelect) {
    SwingUtilities.invokeLater(() -> {
        JDialog dialog = new JDialog((Frame) null, "Select Market", true);
        dialog.setSize(500, 400);
        dialog.setLayout(new BorderLayout());

        DefaultComboBoxModel<String> exchangeModel = new DefaultComboBoxModel<>();
        JComboBox<String> exchangeComboBox = new JComboBox<>(exchangeModel);

        DefaultListModel<ContractData> listModel = new DefaultListModel<>();
        JList<ContractData> contractList = new JList<>(listModel);
        JScrollPane scrollPane = new JScrollPane(contractList);

        JButton selectButton = new JButton("Subscribe");
        selectButton.addActionListener(e -> {
            ContractData selected = contractList.getSelectedValue();
            if (selected != null) {
                onSelect.accept(selected);
                dialog.dispose();
            }
        });

        exchangeComboBox.addActionListener(e -> {
            String selectedExchange = (String) exchangeComboBox.getSelectedItem();
            if (selectedExchange != null) {
                new Thread(() -> {
                    try {
                        List<ContractData> contracts = fetchContracts(selectedExchange);
                        SwingUtilities.invokeLater(() -> {
                            listModel.clear();
                            contracts.forEach(listModel::addElement);
                        });
                    } catch (Exception ex) {
                        ex.printStackTrace();
                    }
                }).start();
            }
        });

        JPanel topPanel = new JPanel(new BorderLayout());
        topPanel.add(new JLabel("Exchange:"), BorderLayout.WEST);
        topPanel.add(exchangeComboBox, BorderLayout.CENTER);

        dialog.add(topPanel, BorderLayout.NORTH);
        dialog.add(scrollPane, BorderLayout.CENTER);
        dialog.add(selectButton, BorderLayout.SOUTH);

        new Thread(() -> {
            try {
                List<String> exchanges = fetchExchangeIds();
                SwingUtilities.invokeLater(() -> {
                    exchanges.forEach(exchangeModel::addElement);
                    if (!exchanges.isEmpty()) {
                        exchangeComboBox.setSelectedIndex(0); // Trigger first load
                    }
                });
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }).start();

        dialog.setLocationRelativeTo(null);
        dialog.setVisible(true);
    });
}



    public List<String> fetchExchangeIds() throws Exception {
        String endpoint = "https://api-sim.t4login.com/markets/exchanges";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        if (conn.getResponseCode() != 200) {
            throw new IOException("Failed to fetch exchanges. HTTP status: " + conn.getResponseCode());
        }

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            String json = reader.lines().collect(Collectors.joining());
            JSONArray array = new JSONArray(json);
            List<String> exchangeIds = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                exchangeIds.add(array.getJSONObject(i).getString("exchangeId"));
            }
            return exchangeIds;
        }
    }

    public List<ContractData> fetchContracts(String exchangeId) throws Exception {
        if (contractsCache.containsKey(exchangeId)) {
            return contractsCache.get(exchangeId);
        }

        String endpoint = String.format("https://api-sim.t4login.com/markets/contracts?exchangeid=%s", exchangeId);
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        if (conn.getResponseCode() != 200) {
            throw new IOException("Failed to fetch contracts. HTTP status: " + conn.getResponseCode());
        }

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            String json = reader.lines().collect(Collectors.joining());
            JSONArray array = new JSONArray(json);
            List<ContractData> contracts = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                contracts.add(new ContractData(
                        obj.getString("exchangeID"),
                        obj.getString("contractID"),
                        obj.getString("contractType")));
            }
            contractsCache.put(exchangeId, contracts);
            return contracts;
        }
    }



    public static class ContractData {
        public final String exchangeId;
        public final String contractId;
        public final String contractType;

        public ContractData(String exchangeId, String contractId, String contractType) {
            this.exchangeId = exchangeId;
            this.contractId = contractId;
            this.contractType = contractType;
        }

        @Override
        public String toString() {
            return exchangeId + " " + contractId + " (" + contractType + ")";
        }
    }
} */


package com.t4;

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.json.*;

public class ContractSelectorDialog {
    private final T4APIClientTest client;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();
    private final Map<String, JPanel> exchangePanels = new HashMap<>();
    private ContractData selectedContract = null;

    public ContractSelectorDialog(T4APIClientTest client) {
        this.client = client;
    }

    public void show(Consumer<ContractData> onSelect) {
        SwingUtilities.invokeLater(() -> {
            JDialog dialog = new JDialog((Frame) null, "Select a Contract", true);
            dialog.setSize(600, 500);
            dialog.setLayout(new BorderLayout());

            JTextField searchField = new JTextField();
            JPanel exchangeListPanel = new JPanel();
            exchangeListPanel.setLayout(new BoxLayout(exchangeListPanel, BoxLayout.Y_AXIS));
            JScrollPane scrollPane = new JScrollPane(exchangeListPanel);

            JButton selectButton = new JButton("Select");
            selectButton.setEnabled(false);
            selectButton.addActionListener(e -> {
                if (selectedContract != null) {
                    onSelect.accept(selectedContract);
                    dialog.dispose();
                }
            });

            JButton cancelButton = new JButton("Cancel");
            cancelButton.addActionListener(e -> dialog.dispose());

            JPanel footer = new JPanel(new FlowLayout(FlowLayout.RIGHT));
            footer.add(cancelButton);
            footer.add(selectButton);

            dialog.add(searchField, BorderLayout.NORTH);
            dialog.add(scrollPane, BorderLayout.CENTER);
            dialog.add(footer, BorderLayout.SOUTH);

            searchField.addKeyListener(new KeyAdapter() {
                @Override
                public void keyReleased(KeyEvent e) {
                    String term = searchField.getText().trim().toLowerCase();
                    updateSearchView(term, exchangeListPanel, selectButton);
                    dialog.revalidate();
                }
            });

            new Thread(() -> {
                try {
                    List<String> exchanges = fetchExchangeIds();
                    for (String exchangeId : exchanges) {
                        List<ContractData> contracts = fetchContracts(exchangeId);
                        contracts.sort(Comparator.comparing(c -> c.contractId));
                        contractsCache.put(exchangeId, contracts);
                    }

                    SwingUtilities.invokeLater(() -> {
                        renderExchanges(exchangeListPanel, selectButton);
                        dialog.setLocationRelativeTo(null);
                        dialog.setVisible(true);
                    });

                } catch (Exception ex) {
                    ex.printStackTrace();
                    JOptionPane.showMessageDialog(dialog, "Error loading contracts", "Error", JOptionPane.ERROR_MESSAGE);
                }
            }).start();
        });
    }

    private void renderExchanges(JPanel container, JButton selectButton) {
        container.removeAll();
        exchangePanels.clear();

        for (String exchangeId : contractsCache.keySet()) {
            JPanel panel = new JPanel();
            panel.setLayout(new BorderLayout());
            JButton toggle = new JButton("▶ " + exchangeId);
            JPanel contractsPanel = new JPanel();
            contractsPanel.setLayout(new BoxLayout(contractsPanel, BoxLayout.Y_AXIS));
            contractsPanel.setVisible(false);

            toggle.addActionListener(e -> {
                boolean visible = !contractsPanel.isVisible();
                contractsPanel.setVisible(visible);
                toggle.setText((visible ? "▼ " : "▶ ") + exchangeId);
            });

            for (ContractData data : contractsCache.get(exchangeId)) {
                JLabel label = new JLabel(data.toString());
                label.setBorder(BorderFactory.createEmptyBorder(2, 10, 2, 10));
                label.addMouseListener(new MouseAdapter() {
                    public void mouseClicked(MouseEvent e) {
                        selectedContract = data;
                        selectButton.setEnabled(true);
                        if (e.getClickCount() == 2) {
                            selectButton.doClick();
                        }
                    }
                });
                contractsPanel.add(label);
            }

            panel.add(toggle, BorderLayout.NORTH);
            panel.add(contractsPanel, BorderLayout.CENTER);
            container.add(panel);
            exchangePanels.put(exchangeId, panel);
        }

        container.revalidate();
        container.repaint();
    }

    private void updateSearchView(String term, JPanel container, JButton selectButton) {
        container.removeAll();
        for (Map.Entry<String, List<ContractData>> entry : contractsCache.entrySet()) {
            List<ContractData> matches = entry.getValue().stream()
                    .filter(c -> c.contractId.toLowerCase().contains(term) || c.toString().toLowerCase().contains(term))
                    .collect(Collectors.toList());

            if (!matches.isEmpty()) {
                JPanel groupPanel = new JPanel();
                groupPanel.setLayout(new BorderLayout());
                JLabel title = new JLabel("▶ " + entry.getKey());
                JPanel matchesPanel = new JPanel();
                matchesPanel.setLayout(new BoxLayout(matchesPanel, BoxLayout.Y_AXIS));

                for (ContractData data : matches) {
                    JLabel label = new JLabel(data.toString());
                    label.setBorder(BorderFactory.createEmptyBorder(2, 10, 2, 10));
                    label.addMouseListener(new MouseAdapter() {
                        public void mouseClicked(MouseEvent e) {
                            selectedContract = data;
                            selectButton.setEnabled(true);
                            if (e.getClickCount() == 2) {
                                selectButton.doClick();
                            }
                        }
                    });
                    matchesPanel.add(label);
                }

                groupPanel.add(title, BorderLayout.NORTH);
                groupPanel.add(matchesPanel, BorderLayout.CENTER);
                container.add(groupPanel);
            }
        }

        container.revalidate();
        container.repaint();
    }

   /*  public List<String> fetchExchangeIds() throws Exception {
        String endpoint = "https://api-sim.t4login.com/markets/exchanges";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        if (conn.getResponseCode() != 200)
            throw new IOException("HTTP " + conn.getResponseCode());

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            JSONArray array = new JSONArray(reader.lines().collect(Collectors.joining()));
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < array.length(); i++)
                ids.add(array.getJSONObject(i).getString("exchangeId"));
            return ids;
        }
    } */
   public List<String> fetchExchangeIds() throws Exception {
    int retries = 0;
    while ((client.getAuthToken() == null || client.getAuthToken().isEmpty()) && retries++ < 20) {
        System.out.println("Waiting for JWT token in fetchExchangeIds...");
        Thread.sleep(250);
    }
    if (client.getAuthToken() == null || client.getAuthToken().isEmpty()) {
        throw new IOException("JWT token not available. Cannot fetch exchanges.");
    }

    String endpoint = "https://api-sim.t4login.com/markets/exchanges";
    HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
    conn.setRequestMethod("GET");
    conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

    if (conn.getResponseCode() != 200)
        throw new IOException("Failed to fetch exchanges. HTTP " + conn.getResponseCode());

    try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
        JSONArray array = new JSONArray(reader.lines().collect(Collectors.joining()));
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            ids.add(array.getJSONObject(i).getString("exchangeId"));
        }
        return ids;
    }
}




    /* public List<ContractData> fetchContracts(String exchangeId) throws Exception {
        String endpoint = String.format("https://api-sim.t4login.com/markets/contracts?exchangeid=%s", exchangeId);
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        if (conn.getResponseCode() != 200)
            throw new IOException("HTTP " + conn.getResponseCode());

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            JSONArray array = new JSONArray(reader.lines().collect(Collectors.joining()));
            List<ContractData> result = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                result.add(new ContractData(obj.getString("exchangeID"), obj.getString("contractID"), obj.getString("contractType")));
            }
            return result;
        }
    } */

    public List<ContractData> fetchContracts(String exchangeId) throws Exception {
    int retries = 0;
    while ((client.getAuthToken() == null || client.getAuthToken().isEmpty()) && retries++ < 20) {
        System.out.println("Waiting for JWT token in fetchContracts...");
        Thread.sleep(250);
    }
    if (client.getAuthToken() == null || client.getAuthToken().isEmpty()) {
        throw new IOException("JWT token not available. Cannot fetch contracts for " + exchangeId);
    }

    String endpoint = String.format("https://api-sim.t4login.com/markets/contracts?exchangeid=%s", exchangeId);
    HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
    conn.setRequestMethod("GET");
    conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

    if (conn.getResponseCode() != 200)
        throw new IOException("Failed to fetch contracts for " + exchangeId + ". HTTP " + conn.getResponseCode());

    try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
        JSONArray array = new JSONArray(reader.lines().collect(Collectors.joining()));
        List<ContractData> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject obj = array.getJSONObject(i);
            result.add(new ContractData(
                    obj.getString("exchangeID"),
                    obj.getString("contractID"),
                    obj.getString("contractType")
            ));
        }
        return result;
    }
}

    public static class ContractData {
        public final String exchangeId, contractId, contractType;

        public ContractData(String exchangeId, String contractId, String contractType) {
            this.exchangeId = exchangeId;
            this.contractId = contractId;
            this.contractType = contractType;
        }

        public String toString() {
            return exchangeId + " " + contractId + " (" + contractType + ")";
        }
    }
}