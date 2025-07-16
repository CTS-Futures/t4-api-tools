
package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Platform;
import javafx.scene.control.ChoiceDialog;

import java.util.Comparator;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;


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

                // UI prompt for exchange selection
                Platform.runLater(() -> {
                    ChoiceDialog<String> exchangeDialog = new ChoiceDialog<>(exchanges.get(0), exchanges);
                    exchangeDialog.setTitle("Select Exchange");
                    exchangeDialog.setHeaderText("Choose an exchange");
                    exchangeDialog.showAndWait().ifPresent(exchangeId -> {

                        // Step 2: Fetch contracts for selected exchange
                        new Thread(() -> {
                            try {
                                List<ContractData> contracts = dialog.fetchContracts(exchangeId);
                                if (contracts.isEmpty()) {
                                    System.err.println("No contracts found for exchange: " + exchangeId);
                                    return;
                                }

                                // Sort for clean presentation
                                List<ContractData> sortedContracts = contracts.stream()
                                    .sorted(Comparator.comparing(c -> c.contractId))
                                    .collect(Collectors.toList());

                                // UI prompt for contract selection
                                Platform.runLater(() -> {
                                    ChoiceDialog<ContractData> contractDialog = new ChoiceDialog<>(sortedContracts.get(0), sortedContracts);
                                    contractDialog.setTitle("Select Contract");
                                    contractDialog.setHeaderText("Choose a contract");
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
