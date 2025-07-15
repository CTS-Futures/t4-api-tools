package com.t4;

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

    public ContractSelectorDialog(T4APIClientTest client, Consumer<ContractData> onSelect) {
        this.client = client;
        this.onSelect = onSelect;
    }

    public List<String> fetchExchangeIds() throws IOException {
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
                    exchangeIds.add(array.getString(i));
                }
                return exchangeIds;
            }
        } else {
            throw new IOException("Failed to fetch exchanges. HTTP status: " + responseCode);
        }
    }

    public List<ContractData> fetchContracts(String exchangeId) throws IOException {
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
                        obj.getString("exchangeId"),
                        obj.getString("contractId"),
                        obj.getString("marketId")
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
        public final String marketId;

        public ContractData(String exchangeId, String contractId, String marketId) {
            this.exchangeId = exchangeId;
            this.contractId = contractId;
            this.marketId = marketId;
        }

        @Override
        public String toString() {
            return exchangeId + " " + contractId + " (" + marketId + ")";
        }
    }
}
