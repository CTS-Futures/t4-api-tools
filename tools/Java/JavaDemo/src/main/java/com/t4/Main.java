package com.t4;
import com.t4.ConnectionUI;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.control.SplitPane;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import com.t4.MarketDataPane;
import java.util.Map;
import t4proto.v1.market.Market.MarketDetails;

public class Main extends Application{
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

    // When "Select Market" button is clicked
    /* marketPane.setOnSelectMarket(() -> {
        List<MarketDetails> allMarkets = client.getAllMarketDetails();  // new method
        ContractSelectorDialog dialog = new ContractSelectorDialog(allMarkets, selected -> {
            client.subscribeToMarket(selected);  // Uses marketId, exchangeId, contractId
            marketPane.updateSymbol(selected.getContractSymbol());
        });
        dialog.show();
    }); */


    marketPane.setOnSelectMarket(() -> {
    ContractSelectorDialog dialog = new ContractSelectorDialog(client, selected -> {
        if (selected != null) {
            client.selectMarket(selected.marketId); // subscribe
            marketPane.updateSymbol(selected.toString()); // update UI
        }
    });

    // Background thread to load exchanges and contracts
    new Thread(() -> {
        try {
            var exchanges = dialog.fetchExchangeIds();
            if (exchanges.isEmpty()) {
                System.err.println("No exchanges available.");
                return;
            }

            String firstExchange = exchanges.get(0); // or let user pick later
            var contracts = dialog.fetchContracts(firstExchange);

            Map<String, String> labelToMarketId = new HashMap<>();
            for (var c : contracts) {
                labelToMarketId.put(c.toString(), c.marketId);
            }

            // Populate dropdown in UI
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

    connectionPane.setPrefHeight(100);
    marketPane.setPrefHeight(300);
    VBox root = new VBox(connectionPane, marketPane);
    VBox.setVgrow(marketPane, Priority.ALWAYS);

    primaryStage.setScene(new Scene(root, 600, 400));
    primaryStage.setTitle("T4 API Client");
    primaryStage.show();
}

    public static void main(String[] args) {
        launch(args);  //this must be in a top-level class
    }
}



/*  package com.t4;

import javafx.application.Application;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;
import javafx.scene.text.Text;
import javafx.stage.Stage;

public class T4APIClientUI extends Application {

    @Override
    public void start(Stage primaryStage) {
        primaryStage.setTitle("T4 API Client");

        // Connection & Account Section
        HBox connectionBox = new HBox(10);
        connectionBox.setAlignment(Pos.CENTER_LEFT);
        connectionBox.setPadding(new Insets(10));

        Circle statusCircle = new Circle(6, Color.RED);
        Text statusText = new Text("Disconnected");
        ComboBox<String> accountComboBox = new ComboBox<>();
        accountComboBox.setPromptText("Select Account...");
        Button connectButton = new Button("Connect");
        Button disconnectButton = new Button("Disconnect");

        connectionBox.getChildren().addAll(statusCircle, statusText, new Label("Account:"), accountComboBox, connectButton, disconnectButton);

        // Market Data Section
        GridPane marketDataPane = new GridPane();
        marketDataPane.setPadding(new Insets(10));
        marketDataPane.setHgap(20);
        marketDataPane.setVgap(10);
        marketDataPane.setStyle("-fx-border-color: lightgray; -fx-border-width: 1; -fx-background-color: white;");

        Label marketLabel = new Label("Market Data - (ESU25)");
        marketLabel.setStyle("-fx-font-weight: bold; -fx-font-size: 14px;");
        marketDataPane.add(marketLabel, 0, 0, 3, 1);

        marketDataPane.add(new Label("Best Bid"), 0, 1);
        Label bidLabel = new Label("--");
        bidLabel.setTextFill(Color.BLUE);
        marketDataPane.add(bidLabel, 0, 2);

        marketDataPane.add(new Label("Best Offer"), 1, 1);
        Label offerLabel = new Label("--");
        offerLabel.setTextFill(Color.RED);
        marketDataPane.add(offerLabel, 1, 2);

        marketDataPane.add(new Label("Last Trade"), 2, 1);
        Label lastLabel = new Label("--");
        lastLabel.setTextFill(Color.GREEN);
        marketDataPane.add(lastLabel, 2, 2);

        // Submit Order Section
        GridPane orderPane = new GridPane();
        orderPane.setPadding(new Insets(10));
        orderPane.setHgap(10);
        orderPane.setVgap(10);
        orderPane.setStyle("-fx-border-color: lightgray; -fx-border-width: 1; -fx-background-color: white;");

        orderPane.add(new Label("Type:"), 0, 0);
        ComboBox<String> typeBox = new ComboBox<>();
        typeBox.getItems().addAll("Limit", "Market");
        orderPane.add(typeBox, 1, 0);

        orderPane.add(new Label("Side:"), 2, 0);
        ComboBox<String> sideBox = new ComboBox<>();
        sideBox.getItems().addAll("Buy", "Sell");
        orderPane.add(sideBox, 3, 0);

        orderPane.add(new Label("Volume:"), 0, 1);
        TextField volumeField = new TextField();
        orderPane.add(volumeField, 1, 1);

        orderPane.add(new Label("Price:"), 2, 1);
        TextField priceField = new TextField();
        orderPane.add(priceField, 3, 1);

        orderPane.add(new Label("Take Profit ($):"), 0, 2);
        TextField tpField = new TextField();
        orderPane.add(tpField, 1, 2);

        orderPane.add(new Label("Stop Loss ($):"), 2, 2);
        TextField slField = new TextField();
        orderPane.add(slField, 3, 2);

        Button submitBtn = new Button("Submit Order");
        submitBtn.setStyle("-fx-background-color: gray; -fx-text-fill: white;");
        orderPane.add(submitBtn, 0, 3, 4, 1);

        // Positions Table Placeholder
        Label positionsLabel = new Label("Positions");
        TableView<String> positionsTable = new TableView<>();
        positionsTable.setPlaceholder(new Label("No positions"));

        // Orders Table Placeholder
        Label ordersLabel = new Label("Orders");
        TableView<String> ordersTable = new TableView<>();
        ordersTable.setPlaceholder(new Label("No orders"));

        // Console Area
        TextArea consoleArea = new TextArea();
        consoleArea.setPrefRowCount(10);
        consoleArea.setEditable(false);
        consoleArea.setStyle("-fx-font-family: monospace; -fx-control-inner-background: black; -fx-text-fill: lime;");

        VBox root = new VBox(10);
        root.setPadding(new Insets(10));

        HBox topSection = new HBox(10, marketDataPane, orderPane);

        root.getChildren().addAll(connectionBox, topSection, positionsLabel, positionsTable, ordersLabel, ordersTable, new Label("Console:"), consoleArea);

        Scene scene = new Scene(root, 1200, 750);
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
 */