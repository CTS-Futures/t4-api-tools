package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.layout.*;
import javafx.stage.Stage;

import java.io.IOException;

public class Main extends Application {
    private volatile boolean defaultSubscribed = false;

    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();
        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();
        OrderFormPane orderForm = new OrderFormPane();
        PositionsAndOrdersUI posOrdersUI = new PositionsAndOrdersUI();

        client.setMarketDataP(marketPane);
        client.setPositionsAndOrdersUI(posOrdersUI);

        // Connect logic
        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    Platform.runLater(() -> {
                        connectionPane.setStatus(true);
                        marketPane.enableSelectMarket(true);
                    });

                    new Thread(() -> {
                        try {
                            String marketId = client.fetchMarketIdFromApi("CME_Eq", "ES");
                            client.selectMarket(marketId);
                            defaultSubscribed = true;
                            Platform.runLater(() ->
                                marketPane.updateSymbol("CME_Eq ES (" + marketId + ")")
                            );
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

        // Market selection
        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
                new Thread(() -> {
                    try {
                        String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                        client.selectMarket(marketId);
                        defaultSubscribed = true;
                        Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
                    } catch (IOException ex) {
                        if (ex.getMessage().contains("404")) {
                            client.unsubscribeFromCurrentMarket();
                            Platform.runLater(() -> {
                                marketPane.updateSymbol(contract.toString());
                                marketPane.updateBid("—");
                                marketPane.updateAsk("—");
                                marketPane.updateLast("0 @ 00");
                            });
                        } else {
                            ex.printStackTrace();
                        }
                    }
                }).start();
            });
            dialog.show();
        });

        // Top: Market + Order panes side-by-side
        HBox marketOrderBox = new HBox(20, marketPane, orderForm);
        marketOrderBox.setPadding(new Insets(10));
        marketOrderBox.setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(marketPane, Priority.ALWAYS);
        HBox.setHgrow(orderForm, Priority.ALWAYS);
        marketPane.setMaxWidth(Double.MAX_VALUE);
        orderForm.setMaxWidth(Double.MAX_VALUE);

        // Bottom: Positions + Orders side-by-side
        Node positionsPane = posOrdersUI.getPositionsPane();
        Node ordersPane = posOrdersUI.getOrdersPane();

        HBox posOrdersBox = new HBox(20, positionsPane, ordersPane);
        posOrdersBox.setPadding(new Insets(10));
        posOrdersBox.setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(positionsPane, Priority.ALWAYS);
        HBox.setHgrow(ordersPane, Priority.ALWAYS);

        // Root layout
        VBox root = new VBox(10, connectionPane, marketOrderBox, posOrdersBox);
        root.setPadding(new Insets(10));
        VBox.setVgrow(posOrdersBox, Priority.ALWAYS);

        Scene scene = new Scene(root, 1200, 800);
        primaryStage.setScene(scene);
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}