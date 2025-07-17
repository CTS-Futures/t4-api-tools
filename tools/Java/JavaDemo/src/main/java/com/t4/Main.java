package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import java.io.IOException;

public class Main extends Application {
    private volatile boolean defaultSubscribed = false;

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
                    Platform.runLater(() -> {
                        connectionPane.setStatus(true);  // ✅ Update UI
                        marketPane.enableSelectMarket(true);
                    });

                    // Optionally auto-subscribe to default market
                    new Thread(() -> {
                        try {
                            String marketId = client.fetchMarketIdFromApi("CME_Eq", "ES");
                            client.selectMarket(marketId);
                            System.out.println("Auto-subscribing to: " + marketId);
                            Platform.runLater(() ->
                                marketPane.updateSymbol("CME_Eq ES (" + marketId + ")")
                            );
                            defaultSubscribed = true;
                        } catch (Exception e) {
                            System.err.println("Failed to auto-subscribe:");
                            e.printStackTrace();
                        }
                    }).start();
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // When user clicks "Select Market"
        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
                new Thread(() -> {
                    try {
                        String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                        client.selectMarket(marketId);
                        System.out.println("User selected: " + marketId);
                        defaultSubscribed = true;
                        Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
                    } catch (IOException ex) {
                        if (ex.getMessage().contains("404")) {
                            System.err.println("Market not found, displaying fallback UI.");

                            client.unsubscribeFromCurrentMarket();

                            Platform.runLater(() -> {
                                marketPane.updateSymbol(contract.toString());
                                marketPane.updateBid("—");
                                marketPane.updateAsk("—");
                                marketPane.updateLast("0 @ 00");
                            });
                        } else {
                            ex.printStackTrace();
                            Platform.runLater(() -> marketPane.updateSymbol("Failed to subscribe"));
                        }
                    }
                }).start();
            });

            dialog.show();
        });

        VBox root = new VBox(connectionPane, marketPane);
        VBox.setVgrow(marketPane, Priority.ALWAYS);

        primaryStage.setScene(new Scene(root, 600, 400));
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}