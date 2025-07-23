/* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
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
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
            marketDropdown.show();
        });

        marketDropdown.setMaxWidth(Double.MAX_VALUE);

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleLabel, selectMarketButton, marketDropdown, grid);
        VBox.setVgrow(this, Priority.ALWAYS);
        setMaxWidth(Double.MAX_VALUE);
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
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

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }

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

    public interface MarketSelectionHandler {
        void onMarketSelected(String marketId);
    }
} */

/* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
        });

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleLabel, selectMarketButton, grid);
        VBox.setVgrow(this, Priority.ALWAYS);
        setMaxWidth(Double.MAX_VALUE);
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
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

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
 */

 package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
        });

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleLabel, selectMarketButton, grid);

        setMaxWidth(Double.MAX_VALUE);
        setPrefWidth(Region.USE_COMPUTED_SIZE);
        HBox.setHgrow(this, Priority.ALWAYS);
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
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

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
