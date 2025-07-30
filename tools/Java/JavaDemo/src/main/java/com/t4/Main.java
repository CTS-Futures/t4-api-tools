/* package com.t4;

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
 */
    /* @Override
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
                        marketPane.enableSelectMarket(false);
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
        }); */

 /*        @Override
public void start(Stage primaryStage) {
    T4APIClientTest client = T4APIClientTest.getInstance();
    ConnectionUI connectionPane = new ConnectionUI(client);
    MarketDataPane marketPane = new MarketDataPane();
    OrderFormPane orderForm = new OrderFormPane();
    PositionsAndOrdersUI posOrdersUI = new PositionsAndOrdersUI();

    client.setMarketDataP(marketPane);
    client.setPositionsAndOrdersUI(posOrdersUI);

    // Disable Select Market button at start
    marketPane.enableSelectMarket(false); // <-- NEW

    // Connect button logic
    connectionPane.setOnConnect(() -> {
        try {
            client.connect(() -> {
                Platform.runLater(() -> connectionPane.setStatus(true));

                // Enable button only after token is ready
                client.waitForAuthToken(() -> { // <-- NEW
                    Platform.runLater(() -> marketPane.enableSelectMarket(true)); // <-- NEW
                }); // <-- NEW

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

    // Market selection logic (unchanged)
    marketPane.setOnSelectMarket(() -> {
        ContractSelectorDialog dialog = new ContractSelectorDialog(client);
        dialog.show(contract -> {
            new Thread(() -> {
                try {
                    String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                    client.selectMarket(marketId);
                    Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
                } catch (IOException e) {
                    e.printStackTrace();
                    Platform.runLater(() -> marketPane.updateSymbol("❌ Error selecting market"));
                 }
            }).start();
        });
    }); */

        // Handle market selection
       /*  marketPane.setOnSelectMarket(() -> {
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
        }); */


    /* marketPane.setOnSelectMarket(() -> {
    ContractSelectorDialog dialog = new ContractSelectorDialog(client);
    ContractPicker.show(dialog, contract -> {
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
}); */


/* marketPane.setOnSelectMarket(() -> {
    ContractSelectorDialog dialog = new ContractSelectorDialog(client);
    dialog.show(contract -> {
        new Thread(() -> {
            try {
                String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                client.selectMarket(marketId);
                Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
            } catch (IOException e) {
                e.printStackTrace();
                Platform.runLater(() -> marketPane.updateSymbol("❌ Error selecting market"));
            }
        }).start();
    });
});

        marketPane.setOnOpenExpiryPicker(() -> {
        try {
            ExpiryPicker.Config config = new ExpiryPicker.Config(
                "https://api-sim.t4login.com",
                T4Config.API_KEY,
                T4APIClientTest.getInstance().getAuthToken()
            );

        // You can hardcode these or pull from current state later
            String exchangeId = "CME_Eq";
            String contractId = "ES";

            ExpiryPicker picker = new ExpiryPicker(config, exchangeId, contractId);
            picker.show(expiry -> {
                if (expiry != null) {
                    String marketId = expiry.optString("marketId");
                    System.out.println("Selected market from expiry picker: " + marketId);

                    new Thread(() -> {
                        try {
                            client.selectMarket(marketId);
                            Platform.runLater(() -> marketPane.updateSymbol(expiry.optString("description", marketId)));
                        } catch (Exception e) {
                            e.printStackTrace();
                            Platform.runLater(() -> marketPane.updateSymbol("❌ Error selecting market"));
                        }
                    }).start();
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
            Platform.runLater(() -> marketPane.updateSymbol("❌ Token error"));
        }
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
} */

package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.layout.*;
import javafx.stage.Stage;
import javafx.geometry.HPos;

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

        // Start with "Select Market" disabled
        marketPane.enableSelectMarket(false);

        // Set up Connect button logic
        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    Platform.runLater(() -> connectionPane.setStatus(true));

                    // Enable Select Market only after token is available
                    client.waitForAuthToken(() -> {
                        Platform.runLater(() -> marketPane.enableSelectMarket(true));
                    });

                    // Subscribe to default market
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

        // Select Market button logic
        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client);
            dialog.show(contract -> {
                new Thread(() -> {
                    try {
                        String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                        client.selectMarket(marketId);
                        Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
                    } catch (IOException e) {
                        e.printStackTrace();
                        Platform.runLater(() -> marketPane.updateSymbol("❌ Error selecting market"));
                    }
                }).start();
            });
        });

        // Expiry Picker logic
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
                        new Thread(() -> {
                            try {
                                client.selectMarket(marketId);
                                Platform.runLater(() -> 
                                    marketPane.updateSymbol(expiry.optString("description", marketId))
                                );
                            } catch (Exception e) {
                                e.printStackTrace();
                                Platform.runLater(() -> marketPane.updateSymbol("❌ Error selecting market"));
                            }
                        }).start();
                    }
                });
            } catch (Exception e) {
                e.printStackTrace();
                Platform.runLater(() -> marketPane.updateSymbol("❌ Token error"));
            }
        });

        // === Layout Setup ===
        GridPane topGrid = new GridPane();
        topGrid.setHgap(15);
        topGrid.setPadding(new Insets(10));
        topGrid.getColumnConstraints().addAll(
            new ColumnConstraints(50, 50, Double.MAX_VALUE, Priority.ALWAYS, HPos.LEFT, true),
            new ColumnConstraints(50, 50, Double.MAX_VALUE, Priority.ALWAYS, HPos.LEFT, true)
        );
        topGrid.add(marketPane, 0, 0);
        topGrid.add(orderForm, 1, 0);

        HBox bottomBox = new HBox(15, posOrdersUI.getPositionsBox(), posOrdersUI.getOrdersBox());
        bottomBox.setPadding(new Insets(10));
        HBox.setHgrow(posOrdersUI.getPositionsBox(), Priority.ALWAYS);
        HBox.setHgrow(posOrdersUI.getOrdersBox(), Priority.ALWAYS);

        VBox root = new VBox(15);
        root.setPadding(new Insets(10));
        root.getChildren().addAll(connectionPane, topGrid, bottomBox);
        VBox.setVgrow(bottomBox, Priority.ALWAYS);

        Scene scene = new Scene(root, 1100, 750);
        primaryStage.setScene(scene);
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}