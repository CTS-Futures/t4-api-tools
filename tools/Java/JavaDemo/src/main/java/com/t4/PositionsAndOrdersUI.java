/* package com.t4;

import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.collections.*;
import com.t4.helpers.PositionRow;
import com.t4.helpers.OrderRow;
import javafx.application.Platform;

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
    
    public void updateOrder(OrderRow updated) {
    Platform.runLater(() -> {
        OrderRow existing = findById(updated.uniqueId);
        if (existing != null) {
            existing.copyFrom(updated);
        } else {
            ordersTable.add(updated);
        }
        orderTableView.refresh();
    });
}

    public void addOrder(String market, String side, int volume, String price, String status, String action) {
        orderData.add(new OrderRow(market, side, volume, price, status, action));
    }

    private OrderRow findById(String id) {
    for (OrderRow row : orderData) {
        if (row.getUniqueId().equals(id)) return row;
    }
    return null;
}
} */

/* package com.t4;

import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.collections.*;
import com.t4.helpers.PositionRow;
import com.t4.helpers.OrderRow;
import javafx.application.Platform;
import java.util.List;
import t4proto.v1.account.Account.AccountPosition;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdate;

public class PositionsAndOrdersUI extends VBox {

    //private final TableView<PositionRow> positionsTable = new TableView<>();
    //private final TableView<OrderRow> ordersTable = new TableView<>();
    private final ObservableList<PositionRow> positionData = FXCollections.observableArrayList();
    private final ObservableList<OrderRow> orderData = FXCollections.observableArrayList();
    private ObservableList<PositionRow> positionsList = FXCollections.observableArrayList();
    private ObservableList<OrderRow> ordersList = FXCollections.observableArrayList();


    public PositionsAndOrdersUI() {
        setSpacing(10);
        setPadding(new Insets(10));

        // === POSITIONS TABLE ===
        Label positionsLabel = new Label("Positions");
        positionsTable.setItems(positionData);
        positionsTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Net", "netPos"),
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

   /*  public void updatePosition(String market, int net, double pnl, int working) {
        Platform.runLater(() -> {
            for (PositionRow row : positionData) {
                if (row.getMarket().equals(market)) {
                    row.setNetPos(net);
                    row.setPnl(pnl);
                    row.setWorking(working);
                    positionsTable.refresh();
                    return;
                }
            }
            positionData.add(new PositionRow(market, net, pnl, working));
        });
    } 

    public void updateOrder(OrderRow updated) {
        Platform.runLater(() -> {
            OrderRow existing = findById(updated.getUniqueId());
            if (existing != null) {
                existing.copyFrom(updated);
            } else {
                orderData.add(updated);
            }
            ordersTable.refresh();
        });
    }

    public void updatePositionsAndOrders(List<AccountPosition> positions, List<OrderUpdate> orders) {
    Platform.runLater(() -> {
        positionsList.clear();
        for (AccountPosition pos : positions) {
            int net = pos.getBuys() - pos.getSells();
            double pnl = pos.getRpl(); // Or use unrealized PnL
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
            ordersList.add(new OrderRow(ord.getMarketId(), side, volume, price, status, action));
        }
    });
}

    private OrderRow findById(String id) {
        for (OrderRow row : orderData) {
            if (row.getUniqueId().equals(id)) {
                return row;
            }
        }
        return null;
    }

    /* public void updatePositionsAndOrders(
    List<AccountPosition> positions,
    List<OrderUpdate> orders
) {
    System.out.println("UI received positions: " + positions.size() + ", orders: " + orders.size());
    // You can wire this into your UI tables here
}
 
    public void addOrder(String market, String side, int volume, String price, String status, String action) {
        orderData.add(new OrderRow(market, side, volume, price, status, action));
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

} */


package com.t4;

import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.collections.*;
import com.t4.helpers.PositionRow;
import com.t4.helpers.OrderRow;
import javafx.application.Platform;
import java.util.List;
import t4proto.v1.account.Account.AccountPosition;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdate;

public class PositionsAndOrdersUI extends VBox {

    private final TableView<PositionRow> positionsTable = new TableView<>();
    private final TableView<OrderRow> ordersTable = new TableView<>();
    private final ObservableList<PositionRow> positionsList = FXCollections.observableArrayList();
    private final ObservableList<OrderRow> ordersList = FXCollections.observableArrayList();

    public PositionsAndOrdersUI() {
        setSpacing(10);
        setPadding(new Insets(10));

        // === POSITIONS TABLE ===
        Label positionsLabel = new Label("Positions");
        positionsTable.setItems(positionsList);
        positionsTable.getColumns().addAll(
            createColumn("Market", "market"),
            createColumn("Net", "netPos"),
            createColumn("P&L", "pnl"),
            createColumn("Working", "working")
        );

        // === ORDERS TABLE ===
        Label ordersLabel = new Label("Orders");
        ordersTable.setItems(ordersList);
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
                ordersList.add(new OrderRow(ord.getMarketId(), side, volume, price, status, action));
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
        Platform.runLater(() -> {
            ordersList.add(new OrderRow(market, side, volume, price, status, action));
        });
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
}
