package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.scene.control.Label;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.VBox;
import javafx.scene.text.Font;


public class MarketDataPane extends VBox{
    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");

    public MarketDataPane(){
        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(new Font("Arial", 18));

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
        this.getChildren().addAll(titleLabel, grid);
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
    
}
