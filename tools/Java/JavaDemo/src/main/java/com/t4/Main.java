package com.t4;

import com.t4.ConnectionUI;
import com.t4.ContractSelectorDialog;
import com.t4.MarketDataPane;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import t4proto.v1.market.Market.MarketDetails;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Main extends Application {
    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();

        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();
        client.setMarketDataP(marketPane);

        // When user clicks "Connect"
        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    // After connection succeeds, enable market selection
                    marketPane.enableSelectMarket(true);
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // When "Select Market" is clicked
        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client, selected -> {
                if (selected != null) {
                    client.selectMarket(selected.marketId); // subscribe
                    MarketDetails md = client.getMarketDetails(selected.marketId);
                    if (md != null) {
                        String formatted = md.getExchangeId() + " " + md.getContractId() + " (" + md.getMarketId() + ")";
                        marketPane.updateSymbol(formatted);
                    }
                }
            });

            // Load exchanges/contracts in a background thread
            new Thread(() -> {
                try {
                    List<String> exchanges = dialog.fetchExchangeIds();
                    if (exchanges.isEmpty()) {
                        System.err.println("No exchanges available.");
                        return;
                    }

                    String firstExchange = exchanges.get(0);
                    List<ContractSelectorDialog.ContractData> contracts = dialog.fetchContracts(firstExchange);

                    Map<String, String> labelToMarketId = new HashMap<>();
                    for (ContractSelectorDialog.ContractData c : contracts) {
                        labelToMarketId.put(c.toString(), c.marketId);
                    }

                    marketPane.populateMarkets(labelToMarketId, marketId -> {
                        client.selectMarket(marketId);
                        MarketDetails md = client.getMarketDetails(marketId);
                        if (md != null) {
                            marketPane.updateSymbol(md.getContractId());
                        }
                    });

                } catch (Exception ex) {
                    ex.printStackTrace();
                }
            }).start();
        });

        // Set up and show the stage
        connectionPane.setPrefHeight(100);
        marketPane.setPrefHeight(300);
        VBox root = new VBox(connectionPane, marketPane);
        VBox.setVgrow(marketPane, Priority.ALWAYS);

        primaryStage.setScene(new Scene(root, 600, 400));
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);  // this must be in a top-level class
    }
}