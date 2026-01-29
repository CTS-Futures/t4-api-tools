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
    private final IntegerProperty workingVolume = new SimpleIntegerProperty();
    private final StringProperty time = new SimpleStringProperty();

    // Updated constructor with accountId
    public OrderRow(String orderId, String accountId, String market, int volume, String price, String side, String status, String time) {
        this.orderId.set(orderId);
        this.accountId.set(accountId);
        this.market.set(market);
        this.volume.set(volume);
        this.price.set(price);
        this.side.set(side);
        this.status.set(status);
        this.time.set(time);
        this.workingVolume.set(volume);
    }

    // Constructor fallback (if no accountId needed)
    public OrderRow(String orderId, String market, int volume, String price, String side, String status) {
        this(orderId, "", market, volume, price, side, status, "--");
    }

    public OrderRow(String orderId, String market, int volume, String price, String side, String status, String time) {
        this(orderId, "", market, volume, price, side, status, time);
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
    this.market.set(other.market.get());
    this.side.set(other.side.get());
    this.time.set(other.time.get());
    this.workingVolume.set(other.workingVolume.get());
    this.accountId.set(other.accountId.get());
    this.orderId.set(other.orderId.get());
}

    public int getWorkingVolume() {
        return workingVolume.get();
    }

    public IntegerProperty workingVolumeProperty() {
        return workingVolume;
    }

    public void setWorkingVolume(int volume) {
        this.workingVolume.set(volume);
    }

    public boolean isWorking() {
        return getWorkingVolume() > 0;
    }

    public String getTime() {
        return time.get();
    }

    public StringProperty timeProperty() {
        return time;
    }

    public void setTime(String value) {
        this.time.set(value);
    }
}