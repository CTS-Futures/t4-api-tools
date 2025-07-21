package com.t4.helpers;

public class PositionRow {
    private String market;
    private int net;
    private double pnl;
    private int working;

    public PositionRow(String market, int net, double pnl, int working) {
        this.market = market;
        this.net = net;
        this.pnl = pnl;
        this.working = working;
    }

    public String getMarket() { return market; }
    public int getNet() { return net; }
    public double getPnl() { return pnl; }
    public int getWorking() { return working; }

    public void setNet(int net) { this.net = net; }
    public void setPnl(double pnl) { this.pnl = pnl; }
    public void setWorking(int working) { this.working = working; }
}