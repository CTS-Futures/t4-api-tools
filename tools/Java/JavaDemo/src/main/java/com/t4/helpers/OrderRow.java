package com.t4.helpers;

import javafx.beans.property.*;

public class OrderRow {
    private final StringProperty orderId = new SimpleStringProperty();
    private final StringProperty accountId = new SimpleStringProperty();
    private final StringProperty market = new SimpleStringProperty();
    private final IntegerProperty volume = new SimpleIntegerProperty();
    private final StringProperty price = new SimpleStringProperty();
    private final StringProperty side = new SimpleStringProperty();
    private final StringProperty status = new SimpleStringProperty();
    private final StringProperty action = new SimpleStringProperty();

    // Updated constructor with accountId
    public OrderRow(String orderId, String accountId, String market, int volume, String price, String side, String status) {
        this.orderId.set(orderId);
        this.accountId.set(accountId);
        this.market.set(market);
        this.volume.set(volume);
        this.price.set(price);
        this.side.set(side);
        this.status.set(status);
    }

    // Constructor fallback (if no accountId needed)
    public OrderRow(String orderId, String market, int volume, String price, String side, String status) {
        this(orderId, "", market, volume, price, side, status);
    }

    // Getters
    public String getOrderId() { return orderId.get(); }
    public String getAccountId() { return accountId.get(); }
    public String getMarket() { return market.get(); }
    public int getVolume() { return volume.get(); }
    public String getPrice() { return price.get(); }
    public String getSide() { return side.get(); }
    public String getStatus() { return status.get(); }
    public String getAction() { return action.get(); }

    // Properties
    public StringProperty orderIdProperty() { return orderId; }
    public StringProperty accountIdProperty() { return accountId; }
    public StringProperty marketProperty() { return market; }
    public IntegerProperty volumeProperty() { return volume; }
    public StringProperty priceProperty() { return price; }
    public StringProperty sideProperty() { return side; }
    public StringProperty statusProperty() { return status; }
    public StringProperty actionProperty() { return action; }

    // Setters
    public void setAction(String value) { this.action.set(value); }

    // Used for matching updates
    public String getUniqueId() {
        return orderId.get();
    }

    public void copyFrom(OrderRow other) {
        this.volume.set(other.volume.get());
        this.price.set(other.price.get());
        this.status.set(other.status.get());
    }
}