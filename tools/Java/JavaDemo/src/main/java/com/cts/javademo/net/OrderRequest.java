package com.cts.javademo.net;

/** A UI order-entry request, translated into protobuf by {@link T4Client}. */
public final class OrderRequest {

    public enum Kind {
        MARKET, LIMIT, STOP, STOP_LIMIT;

        public boolean hasLimit() {
            return this == LIMIT || this == STOP_LIMIT;
        }

        public boolean hasStop() {
            return this == STOP || this == STOP_LIMIT;
        }
    }

    public enum TimeInForce {
        DAY, GTC, IOC, FOK;

        public String label() {
            return switch (this) {
                case DAY -> "Day";
                case GTC -> "GTC";
                case IOC -> "IOC";
                case FOK -> "FOK";
            };
        }
    }

    public String accountId = "";
    public boolean buy = true;
    public Kind kind = Kind.MARKET;
    public int volume = 1;
    public String limitPrice = "";
    public String stopPrice = "";
    public TimeInForce tif = TimeInForce.DAY;

    /** Optional bracket protection in dollars (null = none). */
    public Double takeProfit;
    public Double stopLoss;
}
