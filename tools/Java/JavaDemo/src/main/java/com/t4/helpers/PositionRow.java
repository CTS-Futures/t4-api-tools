

package com.t4.helpers;

import javafx.beans.property.*;

public class PositionRow {
    private final StringProperty market;
    private final IntegerProperty netPos;
    private final DoubleProperty pnl;
    private final IntegerProperty working;

    public PositionRow(String market, int net, double pnl, int working) {
        this.market = new SimpleStringProperty(market);
        this.netPos = new SimpleIntegerProperty(net);
        this.pnl = new SimpleDoubleProperty(pnl);
        this.working = new SimpleIntegerProperty(working);
    }

    // Getters for TableView binding
    public StringProperty marketProperty() { return market; }
    public IntegerProperty netPosProperty() { return netPos; }
    public DoubleProperty pnlProperty() { return pnl; }
    public IntegerProperty workingProperty() { return working; }

    // Convenience getters and setters
    public String getMarket() { return market.get(); }
    public int getNetPos() { return netPos.get(); }
    public double getPnl() { return pnl.get(); }
    public int getWorking() { return working.get(); }

    public void setNetPos(int net) { this.netPos.set(net); }
    public void setPnl(double pnl) { this.pnl.set(pnl); }
    public void setWorking(int working) { this.working.set(working); }
}