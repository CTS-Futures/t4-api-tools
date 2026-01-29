

 package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Platform;

import java.util.Comparator;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import com.t4.helpers.SearchableDialog;

public class ContractPicker {

    public static void show(ContractSelectorDialog dialog, Consumer<ContractData> onSelect) {
        new Thread(() -> {
            try {
                // Step 1: Fetch exchanges
                List<String> exchanges = dialog.fetchExchangeIds();
                if (exchanges.isEmpty()) {
                    System.err.println("No exchanges found.");
                    return;
                }

                Platform.runLater(() -> {
                    // Show searchable exchange picker
                    SearchableDialog<String> exchangeDialog = new SearchableDialog<>(
                        "Select Exchange",
                        "Choose an exchange",
                        exchanges,
                        e -> e
                    );

                    exchangeDialog.showAndWait().ifPresent(exchangeId -> {
                        // Step 2: Fetch contracts for selected exchange
                        new Thread(() -> {
                            try {
                                List<ContractData> contracts = dialog.fetchContracts(exchangeId);
                                if (contracts.isEmpty()) {
                                    System.err.println("No contracts found for: " + exchangeId);
                                    return;
                                }

                                List<ContractData> sorted = contracts.stream()
                                    .sorted(Comparator.comparing(c -> c.contractId))
                                    .collect(Collectors.toList());

                                Platform.runLater(() -> {
                                    SearchableDialog<ContractData> contractDialog = new SearchableDialog<>(
                                        "Select Contract",
                                        "Choose a contract",
                                        sorted,
                                        c -> c.contractId + " — " + c.toString()
                                    );

                                    contractDialog.showAndWait().ifPresent(onSelect);
                                });
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }).start();
                    });
                });

            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
    }
}