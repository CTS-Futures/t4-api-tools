package com.t4login.definitions.chartdata;

import java.util.HashMap;
import java.util.Map;

/**
 * Defines the data that was last read on the reader.
 */
public enum ChartDataChange {
    // @formatter:off
    None(0),
    Trade(1),
    Quote(2),
    MarketMode(3),
    Settlement(4),
    TradeBar(5),
    TradeDate(6),
    TPO(7),
    TickChange(8),
    RFQ(9),
    HeldSettlement(10),
    ClearedVolume(11),
    OpenInterest(12),
    VWAP(13),
    MarketSwitch(14),
    MarketDefinition(15);
    // @formatter:on

    private final int value;
    private static Map<Integer, ChartDataChange> map = new HashMap<>();

    static {
        for (ChartDataChange t : ChartDataChange.values()) {
            map.put(t.getValue(), t);
        }
    }

    ChartDataChange(int value) {
        this.value = value;
    }

    public int getValue() {
        return this.value;
    }

    public static ChartDataChange get(int value) {
        return map.get(value);
    }


}
