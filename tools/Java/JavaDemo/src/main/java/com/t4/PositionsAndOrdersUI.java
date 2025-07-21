package com.t4;

import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.collections.*;
import com.t4.helpers.PositionRow;
import com.t4.helpers.OrderRow;

public class PositionsAndOrdersUI extends VBox {

    private final TableView<PositionRow> positionsTable = new TableView<>();
    private final TableView<OrderRow> ordersTable = new TableView<>();
    private final ObservableList<PositionRow> positionData = FXCollections.observableArrayList();
    private final ObservableList<OrderRow> orderData = FXCollections.observableArrayList();

    public PositionsAndOrdersUI() {
        setSpacing(10);
        setPadding(new Insets(10));

        // === POSITIONS TABLE ===
        Label positionsLabel = new Label("Positions");
        positionsTable.setItems(positionData);
        positionsTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Net", "net"),
            createColumn("P&L", "pnl"),
            createColumn("Working", "working")
        );

        // === ORDERS TABLE ===
        Label ordersLabel = new Label("Orders");
        ordersTable.setItems(orderData);
        ordersTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Side", "side"),
            createColumn("Volume", "volume"),
            createColumn("Price", "price"),
            createColumn("Status", "status"),
            createColumn("Action", "action")
        );

        getChildren().addAll(positionsLabel, positionsTable, ordersLabel, ordersTable);
        VBox.setVgrow(positionsTable, Priority.ALWAYS);
        VBox.setVgrow(ordersTable, Priority.ALWAYS);
    }

    private <T> TableColumn<T, String> createColumn(String title, String property) {
        TableColumn<T, String> col = new TableColumn<>(title);
        col.setCellValueFactory(new javafx.scene.control.cell.PropertyValueFactory<>(property));
        col.setPrefWidth(100);
        return col;
    }

    // === Public methods to update UI ===
    public void updatePosition(String market, int net, double pnl, int working) {
        for (PositionRow row : positionData) {
            if (row.getMarket().equals(market)) {
                row.setNet(net);
                row.setPnl(pnl);
                row.setWorking(working);
                positionsTable.refresh();
                return;
            }
        }
        positionData.add(new PositionRow(market, net, pnl, working));
    }

    public void addOrder(String market, String side, int volume, String price, String status, String action) {
        orderData.add(new OrderRow(market, side, volume, price, status, action));
    }
}