package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;
import java.util.Map;

public class MarketDataPane extends VBox {
    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");
    private final ComboBox<String> marketDropdown = new ComboBox<>();

    private final Button selectMarketButton = new Button("Select Market");
    private Runnable onSelectMarket = null;

    public MarketDataPane() {
        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(new Font("Arial", 18));

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run(); // delegate to Main.java
            }
            marketDropdown.show(); // still useful to show after population
        });


        GridPane grid = new GridPane();
        grid.setVgap(10);
        grid.setHgap(20);
        grid.setPadding(new Insets(10));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        this.setSpacing(10);
        this.setPadding(new Insets(15));
        this.getChildren().addAll(titleLabel, selectMarketButton, marketDropdown, grid);
        this.setStyle("-fx-border-color: lightgray; -fx-border-radius: 5; -fx-background-color: #fdfdfd;");
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("Symbol: " + symbol));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Bid: " + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Ask: " + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last: " + last));
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    // Called by controller/client to populate the market list
public void populateMarkets(Map<String, String> labelToMarketId, MarketSelectionHandler handler) {
    Platform.runLater(() -> {
        marketDropdown.getItems().clear();
        marketDropdown.getItems().addAll(labelToMarketId.keySet());

        marketDropdown.setOnAction(e -> {
            String label = marketDropdown.getValue();
            if (label != null && labelToMarketId.containsKey(label)) {
                String marketId = labelToMarketId.get(label);
                handler.onMarketSelected(marketId);
            }
        });
    });
}

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }

// Allow T4APIClientTest to react to market selection
    public interface MarketSelectionHandler {
        void onMarketSelected(String marketId);
}


}