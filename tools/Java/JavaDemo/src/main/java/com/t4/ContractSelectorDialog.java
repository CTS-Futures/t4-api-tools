package com.t4;

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
    private final Consumer<ContractData> onSelect;

    public ContractSelectorDialog(T4APIClientTest client, Consumer<ContractData> onSelect) {
        this.client = client;
        this.onSelect = onSelect;
    }

    public void show() {
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
}
