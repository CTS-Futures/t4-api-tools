
package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.HPos;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
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

        marketPane.enableSelectMarket(false);

        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    Platform.runLater(() -> connectionPane.setStatus(true));

                    client.waitForAuthToken(() -> {
                        Platform.runLater(() -> marketPane.enableSelectMarket(true));
                    });

                    new Thread(() -> {
                        try {
                            String marketId = client.fetchMarketIdFromApi("CME_Eq", "ES");
                            client.selectMarket(marketId);
                            defaultSubscribed = true;
                            Platform.runLater(() -> marketPane.setMarketName("ES", 202509));
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }).start();
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client);
            dialog.show(contract -> {
                new Thread(() -> {
                    try {
                        String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                        client.selectMarket(marketId);
                        Platform.runLater(() -> marketPane.setMarketName(contract.contractId, contract.getExpiryDate()));
                    } catch (IOException e) {
                        e.printStackTrace();
                        Platform.runLater(() -> marketPane.setMarketName("❌", 0));
                    }
                }).start();
            });
        });

        marketPane.setOnOpenExpiryPicker(() -> {
            try {
                ExpiryPicker.Config config = new ExpiryPicker.Config(
                        "https://api-sim.t4login.com",
                        T4Config.API_KEY,
                        client.getAuthToken()
                );

                String exchangeId = "CME_Eq";
                String contractId = "ES";

                ExpiryPicker picker = new ExpiryPicker(config, exchangeId, contractId);
                picker.show(expiry -> {
                    if (expiry != null) {
                        String marketId = expiry.optString("marketId");
                        int expiryDate = expiry.optInt("expiryDate", 0);
                        new Thread(() -> {
                            try {
                                client.selectMarket(marketId);
                                Platform.runLater(() ->
                                        marketPane.setMarketName(contractId, expiryDate)
                                );
                            } catch (Exception e) {
                                e.printStackTrace();
                                Platform.runLater(() -> marketPane.setMarketName("❌", 0));
                            }
                        }).start();
                    }
                });
            } catch (Exception e) {
                e.printStackTrace();
                Platform.runLater(() -> marketPane.setMarketName("❌", 0));
            }
        });

        // === Unified Grid Layout (Top + Bottom Aligned) ===
        GridPane grid = new GridPane();
        grid.setHgap(15);
        grid.setVgap(15);
        grid.setPadding(new Insets(10));

        ColumnConstraints col1 = new ColumnConstraints();
        col1.setHgrow(Priority.ALWAYS);
        col1.setPercentWidth(50);

        ColumnConstraints col2 = new ColumnConstraints();
        col2.setHgrow(Priority.ALWAYS);
        col2.setPercentWidth(50);

        grid.getColumnConstraints().addAll(col1, col2);

        // Row 0: Market Data + Submit Order
        grid.add(marketPane, 0, 0);
        grid.add(orderForm, 1, 0);

        // Row 1: Positions + Orders
        grid.add(posOrdersUI.getPositionsBox(), 0, 1);
        grid.add(posOrdersUI.getOrdersBox(), 1, 1);

        // === Root Layout ===
        VBox root = new VBox(15);
        root.setPadding(new Insets(10));
        root.getChildren().addAll(connectionPane, grid);
        VBox.setVgrow(grid, Priority.ALWAYS);

        Scene scene = new Scene(root, 1100, 750);
        primaryStage.setScene(scene);
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}