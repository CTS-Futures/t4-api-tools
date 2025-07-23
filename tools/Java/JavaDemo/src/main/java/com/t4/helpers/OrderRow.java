package com.t4.helpers;

import javafx.beans.property.*;

public class OrderRow {
    private final StringProperty orderId = new SimpleStringProperty();
    private final StringProperty market = new SimpleStringProperty();
    private final IntegerProperty volume = new SimpleIntegerProperty();
    private final StringProperty price = new SimpleStringProperty();
    private final StringProperty side = new SimpleStringProperty();
    private final StringProperty status = new SimpleStringProperty();
    private final StringProperty action = new SimpleStringProperty();

    public OrderRow(String orderId, String market, int volume, String price, String side, String status) {
        this.orderId.set(orderId);
        this.market.set(market);
        this.volume.set(volume);
        this.price.set(price);
        this.side.set(side);
        this.status.set(status);
    }

    public String getOrderId() { return orderId.get(); }
public String getMarket() { return market.get(); }
public int getVolume() { return volume.get(); }
public String getPrice() { return price.get(); }
public String getSide() { return side.get(); }
public String getStatus() { return status.get(); }

    public StringProperty orderIdProperty() { return orderId; }
    public StringProperty marketProperty() { return market; }
    public IntegerProperty volumeProperty() { return volume; }
    public StringProperty priceProperty() { return price; }
    public StringProperty sideProperty() { return side; }
    public StringProperty statusProperty() { return status; }

    public String getAccountId() {
        return "FIXME"; // Add accountId tracking if needed
    }

    public void copyFrom(OrderRow other) {
        this.volume.set(other.volume.get());
        this.price.set(other.price.get());
        this.status.set(other.status.get());
    }

    public String getUniqueId() {
        return orderId.get();
    }

    public StringProperty actionProperty() { return action; }
    public String getAction() { return action.get(); }
    public void setAction(String value) { this.action.set(value); }
}