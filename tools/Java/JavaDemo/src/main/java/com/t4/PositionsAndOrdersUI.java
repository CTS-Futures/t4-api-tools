

package com.t4;

import javafx.application.Platform;
import javafx.collections.*;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.control.cell.PropertyValueFactory;
import javafx.scene.layout.*;
import javafx.stage.Stage;
import com.t4.helpers.PositionRow;
import com.t4.helpers.OrderRow;
import t4proto.v1.account.Account.AccountPosition;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdate;

import java.util.List;

public class PositionsAndOrdersUI {

    private final TableView<PositionRow> positionsTable = new TableView<>();
    private final TableView<OrderRow> ordersTable = new TableView<>();
    private final ObservableList<PositionRow> positionsList = FXCollections.observableArrayList();
    private final ObservableList<OrderRow> ordersList = FXCollections.observableArrayList();
    private final VBox positionsBox = new VBox(5);
    private final VBox ordersBox = new VBox(5);

    public PositionsAndOrdersUI() {
        positionsTable.setItems(positionsList);
        positionsTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Net", "netPos"),
            createColumn("P&L", "pnl"),
            createColumn("Working", "working")
        );

        ordersTable.setItems(ordersList);
        ordersTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Side", "side"),
            createColumn("Volume", "volume"),
            createColumn("Price", "price"),
            createColumn("Status", "status")
        );

        // Add Action column with ✎ icon
        TableColumn<OrderRow, Void> actionCol = new TableColumn<>("Action");
        actionCol.setPrefWidth(100);
        actionCol.setCellFactory(col -> new TableCell<>() {
            private final Button btn = new Button("✎");
            {
                btn.setStyle("-fx-background-color: #4285f4; -fx-text-fill: white; -fx-font-weight: bold;");
                btn.setOnAction(event -> {
                    OrderRow order = getTableView().getItems().get(getIndex());
                    showModifyOrderDialog(order);
                });
            }

            @Override
            protected void updateItem(Void item, boolean empty) {
                super.updateItem(item, empty);
                if (empty) {
                    setGraphic(null);
                } else {
                    setGraphic(btn);
                }
            }
        });

        ordersTable.getColumns().add(actionCol);

        Label posLabel = new Label("Positions");
        posLabel.setStyle("-fx-font-weight: bold;");
        positionsBox.getChildren().addAll(posLabel, positionsTable);
        positionsBox.setPadding(new Insets(10));
        positionsBox.setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        VBox.setVgrow(positionsTable, Priority.ALWAYS);

        Label ordLabel = new Label("Orders");
        ordLabel.setStyle("-fx-font-weight: bold;");
        ordersBox.getChildren().addAll(ordLabel, ordersTable);
        ordersBox.setPadding(new Insets(10));
        ordersBox.setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        VBox.setVgrow(ordersTable, Priority.ALWAYS);
    }

    private <T> TableColumn<T, String> createColumn(String title, String property) {
        TableColumn<T, String> col = new TableColumn<>(title);
        col.setCellValueFactory(new PropertyValueFactory<>(property));
        col.setPrefWidth(100);
        return col;
    }

    public VBox getPositionsBox() {
        return positionsBox;
    }

    public VBox getOrdersBox() {
        return ordersBox;
    }

    public void updatePositionsAndOrders(List<AccountPosition> positions, List<OrderUpdate> orders) {
        Platform.runLater(() -> {
            positionsList.clear();
            for (AccountPosition pos : positions) {
                int net = pos.getBuys() - pos.getSells();
                double pnl = pos.getRpl();
                int working = pos.getWorkingBuys() + pos.getWorkingSells();
                positionsList.add(new PositionRow(pos.getMarketId(), net, pnl, working));
            }

            ordersList.clear();
            for (OrderUpdate ord : orders) {
                String side = ord.getBuySell().name();
                int volume = ord.getWorkingVolume();
                String price = ord.hasCurrentLimitPrice() ? String.valueOf(ord.getCurrentLimitPrice().getValue()) : "--";
                String status = ord.getStatus().name();
                String action = ord.getChange().name();
                ordersList.add(new OrderRow(ord.getUniqueId(), ord.getMarketId(), volume, price, side, status));
            }
        });
    }

    public void updatePosition(String market, int net, double pnl, int working) {
        Platform.runLater(() -> {
            for (int i = 0; i < positionsList.size(); i++) {
                PositionRow row = positionsList.get(i);
                if (row.getMarket().equals(market)) {
                    positionsList.set(i, new PositionRow(market, net, pnl, working));
                    return;
                }
            }
            positionsList.add(new PositionRow(market, net, pnl, working));
        });
    }

    public void addOrder(String market, String side, int volume, String price, String status, String action) {
        Platform.runLater(() -> ordersList.add(new OrderRow("id_" + System.nanoTime(), market, volume, price, side, status)));
    }

    public void updateOrder(OrderRow updated) {
        Platform.runLater(() -> {
            OrderRow existing = findById(updated.getUniqueId());
            if (existing != null) {
                existing.copyFrom(updated);
            } else {
                ordersList.add(updated);
            }
            ordersTable.refresh();
        });
    }

    private OrderRow findById(String id) {
        for (OrderRow row : ordersList) {
            if (row.getUniqueId().equals(id)) {
                return row;
            }
        }
        return null;
    }

    /* private void showModifyOrderDialog(OrderRow order) {
        Dialog<Void> dialog = new Dialog<>();
        dialog.setTitle("Modify Order");

        Label volumeLabel = new Label("Volume:");
        TextField volumeField = new TextField(String.valueOf(order.getVolume()));
        Label priceLabel = new Label("Price:");
        TextField priceField = new TextField(order.getPrice());

        GridPane grid = new GridPane();
        grid.setHgap(10);
        grid.setVgap(10);
        grid.setPadding(new Insets(20));
        grid.add(volumeLabel, 0, 0);
        grid.add(volumeField, 1, 0);
        grid.add(priceLabel, 0, 1);
        grid.add(priceField, 1, 1);

        ButtonType pullButton = new ButtonType("Pull", ButtonBar.ButtonData.LEFT);
        ButtonType reviseButton = new ButtonType("Revise", ButtonBar.ButtonData.OK_DONE);
        ButtonType cancelButton = new ButtonType("Cancel", ButtonBar.ButtonData.CANCEL_CLOSE);

        dialog.getDialogPane().getButtonTypes().addAll(pullButton, reviseButton, cancelButton);
        dialog.getDialogPane().setContent(grid);

        dialog.setResultConverter(dialogButton -> {
            if (dialogButton == reviseButton) {
                int newVol = Integer.parseInt(volumeField.getText());
                String newPrice = priceField.getText();
                // TODO: integrate revise logic
                System.out.println("Revise Order ID: " + order.getOrderId() + " → " + newVol + " @ " + newPrice);
            } else if (dialogButton == pullButton) {
                // TODO: integrate pull logic
                System.out.println("Pull Order ID: " + order.getOrderId());
            }
            return null;
        }); */

    private void showError(String title, String message) {
            Alert alert = new Alert(Alert.AlertType.ERROR);
        alert.setTitle(title);
        alert.setHeaderText(null);
        alert.setContentText(message);
        alert.showAndWait();
    }

        private void showModifyOrderDialog(OrderRow order) {
    Dialog<Void> dialog = new Dialog<>();
    dialog.setTitle("Modify Order");

    Label volumeLabel = new Label("Volume:");
    TextField volumeField = new TextField(String.valueOf(order.getVolume()));
    Label priceLabel = new Label("Price:");
    TextField priceField = new TextField(order.getPrice());

    GridPane grid = new GridPane();
    grid.setHgap(10);
    grid.setVgap(10);
    grid.setPadding(new Insets(20));
    grid.add(volumeLabel, 0, 0);
    grid.add(volumeField, 1, 0);
    grid.add(priceLabel, 0, 1);
    grid.add(priceField, 1, 1);

    ButtonType pullButton = new ButtonType("Pull", ButtonBar.ButtonData.LEFT);
    ButtonType reviseButton = new ButtonType("Revise", ButtonBar.ButtonData.OK_DONE);
    ButtonType cancelButton = new ButtonType("Cancel", ButtonBar.ButtonData.CANCEL_CLOSE);

    dialog.getDialogPane().getButtonTypes().addAll(pullButton, reviseButton, cancelButton);
    dialog.getDialogPane().setContent(grid);

    dialog.setResultConverter(dialogButton -> {
        if (dialogButton == reviseButton) {
            try {
                int newVolume = Integer.parseInt(volumeField.getText());
                double newPrice = Double.parseDouble(priceField.getText());
                T4APIClientTest.getInstance().reviseOrder(
                    order.getOrderId(),
                    newVolume,
                    newPrice,
                    "limit"
                );
            } catch (Exception e) {
                e.printStackTrace();
                showError("Invalid input", "Volume and Price must be valid numbers.");
            }
        } else if (dialogButton == pullButton) {
            T4APIClientTest.getInstance().pullOrder(order.getOrderId());
        }
        return null;
    });

        dialog.showAndWait();
    }
}
