package com.t4login.definitions.chartdata;

import com.t4login.AsEnum;
import com.t4login.Constant;
import com.t4login.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Chart data aggregation type.
 */
@AsEnum
public class ChartDataType {

    private static final String TAG = "ChartDataType";

    // @formatter:off
    @Constant(0)
    public static final ChartDataType Tick;
    @Constant(1)
    public static final ChartDataType Second;
    @Constant(2)
    public static final ChartDataType Minute;
    @Constant(3)
    public static final ChartDataType Hour;
    @Constant(4)
    public static final ChartDataType Day;
    @Constant(5)
    public static final ChartDataType TPO;
    @Constant(6)
    public static final ChartDataType TickChange;
    // @formatter:on

    private final int value;
    private final String name;
    private static Map<Integer, ChartDataType> map = new HashMap<>();
    private static ChartDataType[] mValues;

    static {
        List<ChartDataType> values = new ArrayList<>();

        Tick = new ChartDataType(0, "Tick");
        values.add(Tick);
        Second = new ChartDataType(1, "Second");
        values.add(Second);
        Minute = new ChartDataType(2, "Minute");
        values.add(Minute);
        Hour = new ChartDataType(3, "Hour");
        values.add(Hour);
        Day = new ChartDataType(4, "Day");
        values.add(Day);
        TPO = new ChartDataType(5, "TPO");
        values.add(TPO);
        TickChange = new ChartDataType(6, "TickChange");
        values.add(TickChange);

        for (ChartDataType t : values) {
            map.put(t.getValue(), t);
        }

        mValues = new ChartDataType[values.size()];
        values.toArray(mValues);
    }

    ChartDataType(int value, String name) {
        this.value = value;
        this.name = name;
    }

    public int getValue() {
        return this.value;
    }

    public static ChartDataType get(int value) {
        ChartDataType val = map.get(value);

        if (val == null) {
            Log.e(TAG, "get(), Non-existent value " + Integer.toString(value) + " created and added without name." + "");
            val = new ChartDataType(value, Integer.toString(value));
            map.put(value, val);

            List<ChartDataType> values = new ArrayList<>();
            Collections.addAll(values, mValues);
            values.add(val);

            mValues = new ChartDataType[values.size()];
            values.toArray(mValues);
        }

        return val;
    }

    public ChartDataType[] values() {
        return mValues;
    }

    @Override
    public String toString() {
        return this.name;
    }
}
