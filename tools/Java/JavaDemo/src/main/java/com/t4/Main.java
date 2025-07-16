/* package com.t4;

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
                    javafx.application.Platform.runLater(() -> {
                        connectionPane.setStatus(true);  // ✅ Turn green & update label
                        marketPane.enableSelectMarket(true);
            });
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        marketPane.setOnSelectMarket(() -> {
    ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
        // Optional consumer — not used here
    });

    dialog.setContractSelectionListener((marketId, symbol) -> {
        client.selectMarket(String.valueOf(marketId));  // Send MarketSubscription
        javafx.application.Platform.runLater(() -> marketPane.updateSymbol(symbol));
    });

    // Load dialog content & simulate showing a modal (you can integrate with JavaFX UI or simulate selection)
    new Thread(() -> {
        try {
            List<String> exchanges = dialog.fetchExchangeIds();
            if (exchanges.isEmpty()) {
                System.err.println("No exchanges found.");
                return;
            }

            // For now, just simulate picking the first contract from the first exchange
            String exchange = exchanges.get(0);
            List<ContractSelectorDialog.ContractData> contracts = dialog.fetchContracts(exchange);
            if (!contracts.isEmpty()) {
                dialog.selectContract(contracts.get(0));  // simulate click/select
            } else {
                System.err.println("No contracts for exchange: " + exchange);
            }

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
} */





/* package com.t4;

import com.t4.ConnectionUI;
import com.t4.ContractSelectorDialog;
import com.t4.MarketDataPane;
import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import java.io.IOException;

import java.util.List;

public class Main extends Application {
    @Override
    public void start(Stage primaryStage){
        T4APIClientTest client = T4APIClientTest.getInstance();

        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();
        client.setMarketDataP(marketPane);

        // When user clicks "Connect"
        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    javafx.application.Platform.runLater(() -> {
                        connectionPane.setStatus(true);  // Turn green
                        marketPane.enableSelectMarket(true);
                    });
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // When user clicks "Select Market"
        marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
                // Will be called below manually
            });

            /* dialog.setContractSelectionListener((ContractData contract) -> {
                new Thread(() -> {
                    try {
                        String marketId = dialog.fetchMarketId(contract.exchangeId, contract.contractId);
                        if (marketId != null && !marketId.isEmpty()) {
                            client.selectMarket(marketId);
                            javafx.application.Platform.runLater(() -> marketPane.updateSymbol(marketId));
                        } else {
                            System.err.println("Market ID was empty.");
                        }
                    } catch (Exception e) {
                        System.err.println("Failed to fetch or subscribe to market:");
                        e.printStackTrace();
                    }
                }).start();
            }); 

            dialog.setContractSelectionListener(contract -> {
    new Thread(() -> {
        try {
            String marketId = dialog.fetchMarketId(contract.exchangeId, contract.contractId);
            client.selectMarket(marketId);
            javafx.application.Platform.runLater(() -> marketPane.updateSymbol(contract.contractId));
        } catch (Exception e) {
            System.err.println("Failed to fetch or subscribe to market:");
            e.printStackTrace();
            javafx.application.Platform.runLater(() -> marketPane.updateSymbol("⚠️ No market found"));
        }
    }).start();
});

            // Simulate fetching and selecting a contract
            /* new Thread(() -> {
                try {
                    List<String> exchanges = dialog.fetchExchangeIds();
                    if (exchanges.isEmpty()) {
                        System.err.println("No exchanges found.");
                        return;
                    }

                    String exchange = exchanges.get(0);
                    List<ContractData> contracts = dialog.fetchContracts(exchange);
                    if (!contracts.isEmpty()) {
                        dialog.selectContract(contracts.get(0)); // Simulate user click
                    } else {
                        System.err.println("No contracts for exchange: " + exchange);
                    }
                } catch (Exception ex) {
                    ex.printStackTrace();
                }
            }).start();
        });
 

        new Thread(() -> {
        try {
            List<String> exchanges = dialog.fetchExchangeIds();
            if (exchanges.isEmpty()) {
                System.err.println("No exchanges found.");
                return;
            }

            for (String exchange : exchanges) {
                List<ContractData> contracts = dialog.fetchContracts(exchange);
                for (ContractData contract : contracts) {
                    try {
                        String marketId = dialog.fetchMarketId(contract.exchangeId, contract.contractId);
                        System.out.println("✅ Found market: " + marketId + " for contract " + contract);
                        dialog.selectContract(contract); // triggers listener
                        return;
                    } catch (Exception ignored) {
                        // Try next
                    }
                }
            }

            System.err.println("❌ No valid market found for any contract");

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
        launch(args);
    }
} */


/* package com.t4;

import com.t4.ConnectionUI;
import com.t4.ContractSelectorDialog;
import com.t4.MarketDataPane;
import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.control.ChoiceDialog;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class Main extends Application {

    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();

        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();
        client.setMarketDataP(marketPane);

        // 🔌 Handle Connect
        connectionPane.setOnConnect(() -> {
            try {
                client.connect(() -> {
                    Platform.runLater(() -> {
                        connectionPane.setStatus(true);
                        marketPane.enableSelectMarket(true);
                    });

                    // ✅ Auto-subscribe to XCME_Eq ES (U25)
                    new Thread(() -> {
                        try {
                            String autoMarketId = client.fetchMarketId("CME_Eq", "ES", "U25");
                            client.selectMarket(autoMarketId);
                            Platform.runLater(() -> marketPane.updateSymbol("ESU25"));
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }).start();
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
 */
        // 🧭 Select Market Dropdown
       /*  marketPane.setOnSelectMarket(() -> {
            ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
                // You can optionally act here on contract selection
            });

            new Thread(() -> {
                try {
                    List<String> exchanges = dialog.fetchExchangeIds();
                    if (exchanges.isEmpty()) {
                        System.err.println("No exchanges found.");
                        return;
                    }

                    List<ContractData> allContracts = new ArrayList<>();
                    for (String exchange : exchanges) {
                        allContracts.addAll(dialog.fetchContracts(exchange));
                    }

                    // Prepare dropdown UI
                    List<String> displayLabels = new ArrayList<>();
                    for (ContractData contract : allContracts) {
                        displayLabels.add(contract.toString());  // e.g., "CME_Eq ES (Future)"
                    }

                    Platform.runLater(() -> {
                        ChoiceDialog<String> choiceDialog = new ChoiceDialog<>(displayLabels.get(0), displayLabels);
                        choiceDialog.setTitle("Select Market");
                        choiceDialog.setHeaderText("Choose a contract to subscribe to");

                        Optional<String> result = choiceDialog.showAndWait();
                        result.ifPresent(label -> {
                            for (ContractData contract : allContracts) {
                                if (contract.toString().equals(label)) {
                                    // Fetch & subscribe to selected
                                    new Thread(() -> {
                                        try {
                                            String marketId = client.fetchMarketId(contract.exchangeId, contract.contractId, contract.contractType);
                                            client.selectMarket(marketId);
                                            Platform.runLater(() -> marketPane.updateSymbol(contract.contractId));
                                        } catch (IOException e) {
                                            e.printStackTrace();
                                            Platform.runLater(() -> marketPane.updateSymbol("⚠️ Not Found"));
                                        }
                                    }).start();
                                    break;
                                }
                            }
                        });
                    });

                } catch (Exception ex) {
                    ex.printStackTrace();
                }
            }).start();
        }); */
/* 
        marketPane.setOnSelectMarket(() -> {
    ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {});
    dialog.setContractSelectionListener((marketId, symbol) -> {
        client.selectMarket(marketId);
        javafx.application.Platform.runLater(() -> marketPane.updateSymbol(symbol));
    });

    new Thread(() -> {
        try {
            List<String> exchanges = dialog.fetchExchangeIds();
            List<ContractSelectorDialog.ContractData> allContracts = new ArrayList<>();

            for (String exchange : exchanges) {
                allContracts.addAll(dialog.fetchContracts(exchange));
            }

            dialog.showMarketPicker(allContracts);  // 👈 This shows the dropdown

        } catch (Exception ex) {
            ex.printStackTrace();
        }
    }).start();
});

        // 📦 Scene Layout
        connectionPane.setPrefHeight(100);
        marketPane.setPrefHeight(300);
        VBox root = new VBox(connectionPane, marketPane);
        VBox.setVgrow(marketPane, Priority.ALWAYS);

        primaryStage.setScene(new Scene(root, 600, 400));
        primaryStage.setTitle("T4 API Client");
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
} */

/* package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.control.ChoiceDialog;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

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
                    Platform.runLater(() -> {
                        connectionPane.setStatus(true);  // Turn green
                        marketPane.enableSelectMarket(true);
                    });
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // When user clicks "Select Market"
        marketPane.setOnSelectMarket(() -> {
            Map<String, String> labelToId = client.getMarketLabelToIdMap();
            if (labelToId.isEmpty()) {
                System.err.println("No market data available");
                return;
            }

            Platform.runLater(() -> {
                List<String> labels = labelToId.keySet().stream().sorted().toList();
                ChoiceDialog<String> dialog = new ChoiceDialog<>(labels.get(0), labels);
                dialog.setTitle("Select Market");
                dialog.setHeaderText("Choose a market to subscribe");

                dialog.showAndWait().ifPresent(label -> {
                    String marketId = labelToId.get(label);
                    client.selectMarket(marketId);
                    marketPane.updateSymbol(label);
                });
            });
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
 */


package com.t4;

import com.t4.ContractSelectorDialog.ContractData;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

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
                client.connect(() -> Platform.runLater(() -> {
                    connectionPane.setStatus(true);  // Turn green
                    marketPane.enableSelectMarket(true);

                    // Automatically subscribe to default market
                    new Thread(() -> {
                        try {
                            String marketId = client.fetchMarketIdFromApi("CME_Eq", "ES");
                            client.selectMarket(marketId);
                            Platform.runLater(() ->
                                marketPane.updateSymbol("CME_Eq ES (" + marketId + ")")
                            );
                        } catch (Exception e) {
                            System.err.println("Failed to auto-subscribe to default market:");
                            e.printStackTrace();
                        }
                    }).start();
                }));
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // When user clicks "Select Market"
        marketPane.setOnSelectMarket(() -> {
            new Thread(() -> {
                try {
                    ContractSelectorDialog dialog = new ContractSelectorDialog(client, contract -> {
                        try {
                            String marketId = client.fetchMarketIdFromApi(contract.exchangeId, contract.contractId);
                            client.selectMarket(marketId);
                            Platform.runLater(() -> marketPane.updateSymbol(contract.toString()));
                        } catch (Exception ex) {
                            ex.printStackTrace();
                        }
                    });

                    Platform.runLater(() -> {
                        ContractPicker.show(dialog, contract -> {
                            dialog.selectContract(contract);
                        });
                    });

                } catch (Exception e) {
                    e.printStackTrace();
                }
            }).start();
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