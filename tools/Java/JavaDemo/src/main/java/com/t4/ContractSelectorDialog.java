/* package com.t4;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;

public class ContractSelectorDialog {

    private final T4APIClientTest client;
    private final Consumer<ContractData> onSelect;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();
    private List<String> exchangeIds = new ArrayList<>();
    private ContractSelectionListener listener;

    public ContractSelectorDialog(T4APIClientTest client, Consumer<ContractData> onSelect) {
        this.client = client;
        this.onSelect = onSelect;
    }

    public List<String> fetchExchangeIds() throws Exception {
        String endpoint = "https://api-sim.t4login.com/markets/exchanges";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                exchangeIds.clear();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    exchangeIds.add(obj.getString("exchangeId")); // FIXED: object access
                }
                return exchangeIds;
            }
        } else {
            throw new IOException("Failed to fetch exchanges. HTTP status: " + responseCode);
        }
    }

    public void fetchMarketId(String exchangeId, String contractId, Consumer<Integer> onMarketId) {
    new Thread(() -> {
        try {
            String endpoint = String.format(
                "https://api-sim.t4login.com/markets/picker/firstmarket?exchangeid=%s&contractid=%s",
                exchangeId, contractId
            );

            HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());
            System.out.println("Fetching market ID with:");
            System.out.println("  exchangeId = " + exchangeId);
            System.out.println("  contractId = " + contractId);
            System.out.println("  endpoint   = " + endpoint);

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    String json = reader.lines().collect(Collectors.joining());
                    JSONObject obj = new JSONObject(json);
                    int marketId = obj.getInt("marketID");

                    if (listener != null) {
                        listener.onContractSelected(marketId, contractId); // symbol here is contractId
                    }

                    onMarketId.accept(marketId);
                }
            } else {
                throw new IOException("Failed to fetch marketId. HTTP status: " + responseCode);
            }
        } catch (Exception e) {
            e.printStackTrace(); // or route to a logger
        }
    }).start();
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

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                List<ContractData> contracts = new ArrayList<>();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    contracts.add(new ContractData(
                        obj.getString("exchangeID"),
                        obj.getString("contractID"),
                        obj.getString("contractType")
                    ));
                }
                contractsCache.put(exchangeId, contracts);
                return contracts;
            }
        } else {
            throw new IOException("Failed to fetch contracts. HTTP status: " + responseCode);
        }
    }

    public void selectContract(ContractData contract) {
        onSelect.accept(contract);
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

    public interface ContractSelectionListener {
        void onContractSelected(int marketId, String symbol);
    }

    public void setContractSelectionListener(ContractSelectionListener listener) {
        this.listener = listener;
    }
}
 */



 /* package com.t4;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;

public class ContractSelectorDialog {

    private final T4APIClientTest client;
    private final Consumer<ContractData> onSelect;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();
    private List<String> exchangeIds = new ArrayList<>();
    private ContractSelectionListener listener;

    public ContractSelectorDialog(T4APIClientTest client, Consumer<ContractData> onSelect) {
        this.client = client;
        this.onSelect = onSelect;
    }

    public List<String> fetchExchangeIds() throws Exception {
        String endpoint = "https://api-sim.t4login.com/markets/exchanges";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                exchangeIds.clear();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    exchangeIds.add(obj.getString("exchangeId"));
                }
                return exchangeIds;
            }
        } else {
            throw new IOException("Failed to fetch exchanges. HTTP status: " + responseCode);
        }
    }

    public String fetchMarketId(String exchangeId, String contractId) throws Exception {
        String endpoint = String.format(
            "https://api-sim.t4login.com/markets/picker/firstmarket?exchangeid=%s&contractid=%s",
            exchangeId, contractId
        );

        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        System.out.println("Fetching market ID with:");
        System.out.println("  exchangeId = " + exchangeId);
        System.out.println("  contractId = " + contractId);
        System.out.println("  endpoint   = " + endpoint);

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONObject obj = new JSONObject(json);
                return obj.getString("marketID");
            }
        } else {
            throw new IOException("Failed to fetch marketId. HTTP status: " + responseCode);
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

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                List<ContractData> contracts = new ArrayList<>();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    contracts.add(new ContractData(
                        obj.getString("exchangeID"),
                        obj.getString("contractID"),
                        obj.getString("contractType")
                    ));
                }
                contractsCache.put(exchangeId, contracts);
                return contracts;
            }
        } else {
            throw new IOException("Failed to fetch contracts. HTTP status: " + responseCode);
        }
    }

    public void selectContract(ContractData contract) {
        if (listener != null) {
            listener.onContractSelected(contract);
        }
        onSelect.accept(contract); // Optional
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

    public interface ContractSelectionListener {
        void onContractSelected(ContractData contract);
    }

    public void setContractSelectionListener(ContractSelectionListener listener) {
        this.listener = listener;
    }
} */
/* 
package com.t4;

import javafx.scene.Scene;
import javafx.scene.control.ListView;
import javafx.scene.control.SelectionMode;
import javafx.scene.layout.VBox;
import javafx.stage.Modality;
import javafx.stage.Stage;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;

public class ContractSelectorDialog {

    private final T4APIClientTest client;
    private final Consumer<ContractData> onSelect;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();

    public ContractSelectorDialog(T4APIClientTest client, Consumer<ContractData> onSelect) {
        this.client = client;
        this.onSelect = onSelect;
    }

    public void show() {
        Stage dialogStage = new Stage();
        dialogStage.initModality(Modality.APPLICATION_MODAL);
        dialogStage.setTitle("Select Market");

        ListView<String> listView = new ListView<>();
        listView.getSelectionModel().setSelectionMode(SelectionMode.SINGLE);

        VBox root = new VBox(listView);
        Scene scene = new Scene(root, 400, 500);
        dialogStage.setScene(scene);

        // Populate market list in background
        new Thread(() -> {
            try {
                List<String> exchanges = fetchExchangeIds();
                Map<String, ContractData> labelToContract = new LinkedHashMap<>();

                for (String exchange : exchanges) {
                    List<ContractData> contracts = fetchContracts(exchange);
                    for (ContractData contract : contracts) {
                        String label = contract.toString();
                        labelToContract.put(label, contract);
                    }
                }

                javafx.application.Platform.runLater(() -> {
                    listView.getItems().addAll(labelToContract.keySet());
                });

                // Set selection listener
                listView.setOnMouseClicked(event -> {
                    String selectedLabel = listView.getSelectionModel().getSelectedItem();
                    if (selectedLabel != null) {
                        ContractData selected = labelToContract.get(selectedLabel);

                        new Thread(() -> {
                            try {
                                String marketId = fetchMarketId(selected.exchangeId, selected.contractId);
                                if (marketId != null && !marketId.isEmpty()) {
                                    onSelect.accept(selected);
                                    javafx.application.Platform.runLater(dialogStage::close);
                                } else {
                                    System.err.println("⚠️ Market ID not found.");
                                }
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }).start();
                    }
                });

            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();

        dialogStage.showAndWait();
    }

    public List<String> fetchExchangeIds() throws Exception {
        String endpoint = "https://api-sim.t4login.com/markets/exchanges";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                List<String> exchangeIds = new ArrayList<>();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    exchangeIds.add(obj.getString("exchangeId"));
                }
                return exchangeIds;
            }
        } else {
            throw new IOException("Failed to fetch exchanges. HTTP status: " + responseCode);
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

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONArray array = new JSONArray(json);
                List<ContractData> contracts = new ArrayList<>();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    contracts.add(new ContractData(
                        obj.getString("exchangeID"),
                        obj.getString("contractID"),
                        obj.getString("contractType")
                    ));
                }
                contractsCache.put(exchangeId, contracts);
                return contracts;
            }
        } else {
            throw new IOException("Failed to fetch contracts. HTTP status: " + responseCode);
        }
    }

    public String fetchMarketId(String exchangeId, String contractId) throws Exception {
        String endpoint = String.format(
            "https://api-sim.t4login.com/markets/picker/firstmarket?exchangeid=%s&contractid=%s",
            exchangeId, contractId
        );

        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + client.getAuthToken());

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONObject obj = new JSONObject(json);
                return obj.getString("marketID");
            }
        } else {
            throw new IOException("Failed to fetch marketId. HTTP status: " + responseCode);
        }
    }

    public void showMarketPicker(List<ContractData> contracts) {
    javafx.application.Platform.runLater(() -> {
        Stage popup = new Stage();
        popup.setTitle("Select a Market");

        ComboBox<ContractData> comboBox = new ComboBox<>();
        comboBox.getItems().addAll(contracts);

        Button selectButton = new Button("Subscribe");
        selectButton.setOnAction(e -> {
            ContractData selected = comboBox.getValue();
            if (selected != null) {
                fetchMarketId(selected.exchangeId, selected.contractId, marketId -> {
                    if (listener != null) {
                        listener.onContractSelected(marketId, selected.contractId);
                    }
                    popup.close(); // close after selection
                });
            }
        });

        VBox vbox = new VBox(10, comboBox, selectButton);
        vbox.setPadding(new Insets(10));
        popup.setScene(new Scene(vbox, 300, 120));
        popup.show();
    });
}

    // === Contract DTO ===
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



/* package com.t4;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.stream.Collectors;
import org.json.JSONArray;
import org.json.JSONObject;

public class ContractSelectorDialog {
    private final T4APIClientTest client;
    private final Map<String, List<ContractData>> contractsCache = new HashMap<>();

    public ContractSelectorDialog(T4APIClientTest client) {
        this.client = client;
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
 */


 package com.t4;

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
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
            dialog.setSize(400, 300);
            dialog.setLayout(new BorderLayout());

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

            dialog.add(scrollPane, BorderLayout.CENTER);
            dialog.add(selectButton, BorderLayout.SOUTH);

            new Thread(() -> {
                try {
                    List<String> exchanges = fetchExchangeIds();
                    for (String exchange : exchanges) {
                        List<ContractData> contracts = fetchContracts(exchange);
                        for (ContractData contract : contracts) {
                            listModel.addElement(contract);
                        }
                    }
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

    public void selectContract(ContractData contract) {
        onSelect.accept(contract);
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