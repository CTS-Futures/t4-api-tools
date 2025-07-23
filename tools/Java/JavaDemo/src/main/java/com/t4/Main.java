/* // Main.java
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

        // Connect button logic
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
                            e.printStackTrace();
                        }
                    }).start();
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // Select Market logic
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

        // === MarketData + OrderForm side by side ===
        HBox marketOrderBox = new HBox(15);
        marketOrderBox.getChildren().addAll(marketPane, orderForm);
        HBox.setHgrow(marketPane, Priority.ALWAYS);
        HBox.setHgrow(orderForm, Priority.ALWAYS);
        marketPane.setPrefWidth(0);
        orderForm.setPrefWidth(0);

        // === Positions + Orders side by side ===
        HBox posOrdBox = new HBox(15);
        posOrdBox.getChildren().addAll(posOrdersUI.getPositionsBox(), posOrdersUI.getOrdersBox());
        HBox.setHgrow(posOrdersUI.getPositionsBox(), Priority.ALWAYS);
        HBox.setHgrow(posOrdersUI.getOrdersBox(), Priority.ALWAYS);
        posOrdersUI.getPositionsBox().setPrefWidth(0);
        posOrdersUI.getOrdersBox().setPrefWidth(0);

        VBox root = new VBox(15);
        root.setPadding(new Insets(10));
        root.getChildren().addAll(connectionPane, marketOrderBox, posOrdBox);

        VBox.setVgrow(marketOrderBox, Priority.NEVER);
        VBox.setVgrow(posOrdBox, Priority.ALWAYS);

        Scene scene = new Scene(root, 1100, 750);
        primaryStage.setScene(scene);
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
 */



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

        // Inject UI dependencies into client
        client.setMarketDataP(marketPane);
        client.setPositionsAndOrdersUI(posOrdersUI);

        // Connect button logic
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
                            e.printStackTrace();
                        }
                    }).start();
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // Handle market selection
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
                            Platform.runLater(() -> marketPane.updateSymbol("Failed to subscribe"));
                        }
                    }
                }).start();
            });
            dialog.show();
        });

        // === MarketData + SubmitOrder (GridPane to lock alignment) ===
        GridPane topGrid = new GridPane();
        topGrid.setHgap(15);
        topGrid.setPadding(new Insets(10));

        ColumnConstraints col1 = new ColumnConstraints();
        col1.setPercentWidth(50);
        col1.setHgrow(Priority.ALWAYS);
        ColumnConstraints col2 = new ColumnConstraints();
        col2.setPercentWidth(50);
        col2.setHgrow(Priority.ALWAYS);
        topGrid.getColumnConstraints().addAll(col1, col2);

        topGrid.add(marketPane, 0, 0);
        topGrid.add(orderForm, 1, 0);

        // === Positions + Orders (HBox already correct) ===
        HBox bottomBox = new HBox(15, posOrdersUI.getPositionsBox(), posOrdersUI.getOrdersBox());
        bottomBox.setPadding(new Insets(10));
        HBox.setHgrow(posOrdersUI.getPositionsBox(), Priority.ALWAYS);
        HBox.setHgrow(posOrdersUI.getOrdersBox(), Priority.ALWAYS);
        posOrdersUI.getPositionsBox().setPrefWidth(0);
        posOrdersUI.getOrdersBox().setPrefWidth(0);

        // === Root layout ===
        VBox root = new VBox(15);
        root.setPadding(new Insets(10));
        root.getChildren().addAll(connectionPane, topGrid, bottomBox);
        VBox.setVgrow(bottomBox, Priority.ALWAYS);

        // === Scene ===
        Scene scene = new Scene(root, 1100, 750);
        primaryStage.setScene(scene);
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}