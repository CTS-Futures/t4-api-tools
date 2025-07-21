package com.t4.helpers;

import javafx.beans.property.*;

public class OrderRow {
    private final StringProperty market;
    private final StringProperty side;
    private final IntegerProperty volume;
    private final StringProperty price;
    private final StringProperty status;
    private final StringProperty action;

    public OrderRow(String market, String side, int volume, String price, String status, String action) {
        this.market = new SimpleStringProperty(market);
        this.side = new SimpleStringProperty(side);
        this.volume = new SimpleIntegerProperty(volume);
        this.price = new SimpleStringProperty(price);
        this.status = new SimpleStringProperty(status);
        this.action = new SimpleStringProperty(action);
    }

    public String getMarket() { return market.get(); }
    public StringProperty marketProperty() { return market; }

    public StringProperty sideProperty() { return side; }
    public IntegerProperty volumeProperty() { return volume; }
    public StringProperty priceProperty() { return price; }
    public StringProperty statusProperty() { return status; }
    public StringProperty actionProperty() { return action; }
}