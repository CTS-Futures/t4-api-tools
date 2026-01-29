package com.t4;

import com.t4.T4APIClientTest;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;

public class OrderFormPane extends VBox {

    private final ComboBox<String> typeBox = new ComboBox<>();
    private final ComboBox<String> sideBox = new ComboBox<>();
    private final TextField volumeField = new TextField();
    private final TextField priceField = new TextField();
    private final TextField takeProfitField = new TextField();
    private final TextField stopLossField = new TextField();
    private final Button submitButton = new Button("Submit Order");

    public OrderFormPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);
        setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(this, Priority.ALWAYS);

        Label title = new Label("Submit Order");
        title.setFont(Font.font("Arial", 16));
        title.setStyle("-fx-font-weight: bold;");

        GridPane form = new GridPane();
        form.setVgap(10);
        form.setHgap(10);
        form.setAlignment(Pos.TOP_LEFT);

        typeBox.getItems().addAll("Limit", "Market");
        typeBox.setValue("Limit");

        sideBox.getItems().addAll("Buy", "Sell");
        sideBox.setValue("Buy");

        // Layout fields
        form.add(new Label("Type:"), 0, 0);
        form.add(typeBox, 1, 0);

        form.add(new Label("Side:"), 2, 0);
        form.add(sideBox, 3, 0);

        form.add(new Label("Volume:"), 0, 1);
        form.add(volumeField, 1, 1);

        form.add(new Label("Price:"), 2, 1);
        form.add(priceField, 3, 1);

        form.add(new Label("Take Profit ($):"), 0, 2);
        form.add(takeProfitField, 1, 2);

        form.add(new Label("Stop Loss ($):"), 2, 2);
        form.add(stopLossField, 3, 2);

        // Submit button
        submitButton.setMaxWidth(Double.MAX_VALUE);
        submitButton.setStyle("-fx-background-color: #444; -fx-text-fill: white; -fx-font-weight: bold;");
        GridPane.setColumnSpan(submitButton, 4);
        form.add(submitButton, 0, 3);

        getChildren().addAll(title, form);

        submitButton.setOnAction(e -> handleSubmit());
    }

    private void handleSubmit() {
        try {
            String type = typeBox.getValue();
            String side = sideBox.getValue();
            int volume = Integer.parseInt(volumeField.getText());
            double price = type.equalsIgnoreCase("Limit") ? Double.parseDouble(priceField.getText()) : 0;
            String priceType = type.toLowerCase();

            Double takeProfit = takeProfitField.getText().isEmpty() ? null : Double.parseDouble(takeProfitField.getText());
            Double stopLoss = stopLossField.getText().isEmpty() ? null : Double.parseDouble(stopLossField.getText());

            T4APIClientTest.getInstance().submitOrder(side, volume, price, priceType, takeProfit, stopLoss);

            Alert alert = new Alert(Alert.AlertType.INFORMATION, "Order Submitted!", ButtonType.OK);
            alert.showAndWait();
        } catch (NumberFormatException ex) {
            Alert alert = new Alert(Alert.AlertType.ERROR, "Invalid input: " + ex.getMessage(), ButtonType.OK);
            alert.showAndWait();
        } catch (IllegalStateException ex) {
            Alert alert = new Alert(Alert.AlertType.ERROR, "Missing account or market: " + ex.getMessage(), ButtonType.OK);
            alert.showAndWait();
        } catch (Exception ex) {
            ex.printStackTrace();
        }
    }
}