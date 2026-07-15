package com.t4login.datetime;

import java.util.HashMap;
import java.util.Map;

public enum DayOfWeek {
    // @formatter:off
    Sunday(0),
    Monday(1),
    Tuesday(2),
    Wednesday(3),
    Thursday(4),
    Friday(5),
    Saturday(6);

    public static final int SUNDAY = 0;
    public static final int MONDAY = 1;
    public static final int TUESDAY = 2;
    public static final int WEDNESDAY = 3;
    public static final int THURSDAY = 4;
    public static final int FRIDAY = 5;
    public static final int SATURDAY = 6;
    // @formatter:on

    private final int value;
    private static Map<Integer, DayOfWeek> map = new HashMap<>();

    static {
        for (DayOfWeek t : DayOfWeek.values()) {
            map.put(t.getValue(), t);
        }
    }

    DayOfWeek(int value) {
        this.value = value;
    }

    public int getValue() {
        return this.value;
    }

    public static DayOfWeek get(int value) {
        return map.get(value);
    }

    @Override
    public String toString() {
        return this.name();
    }
}
