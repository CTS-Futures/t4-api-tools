package com.t4login.datetime;


import java.util.HashMap;
import java.util.Map;

public enum DateTimeKind {
    // @formatter:off
    Unspecified(0),
    Utc(1),
    Local(2);
    // @formatter:on

    private final int value;
    private static Map<Integer, DateTimeKind> map = new HashMap<>();

    static {
        for (DateTimeKind t : DateTimeKind.values()) {
            map.put(t.getValue(), t);
        }
    }

    DateTimeKind(int value) {
        this.value = value;
    }

    public int getValue() {
        return this.value;
    }

    public static DateTimeKind get(int value) {
        return map.get(value);
    }

    @Override
    public String toString() {
        return this.name();
    }
}
