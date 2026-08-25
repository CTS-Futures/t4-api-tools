package com.t4login.definitions;

import com.t4login.AsEnum;
import com.t4login.Constant;
import com.t4login.Log;
import com.t4login.Resource;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@AsEnum
public class BidOffer implements Serializable {

    private static final String TAG = "BidOffer";

    // @formatter:off
    @Constant(0)
    public static final BidOffer Undefined;
    @Constant(1)
    public static final BidOffer Bid;
    @Constant(-1)
    public static final BidOffer Offer;
    // @formatter:on

    private final int value;
    private final String descr_loc;
    private static Map<Integer, BidOffer> map = new HashMap<>();
    private static BidOffer[] mValues;

    static {
        List<BidOffer> values = new ArrayList<>();

        Undefined = new BidOffer(0, "bidoffer_undefined");
        values.add(Undefined);
        Bid = new BidOffer(1, "bidoffer_bid");
        values.add(Bid);
        Offer = new BidOffer(-1, "bidoffer_offer");
        values.add(Offer);

        for (BidOffer t : values) {
            map.put(t.getValue(), t);
        }

        mValues = new BidOffer[values.size()];
        values.toArray(mValues);
    }

    private BidOffer(int value, String descr_loc) {
        this.value = value;
        this.descr_loc = descr_loc;
    }

    public int getValue() {
        return this.value;
    }

    public String getDescription() {
        if (this.descr_loc != null) {
            return Resource.localizeString(descr_loc);
        } else {
            return Integer.toString(this.value);
        }
    }

    public static BidOffer get(int value) {
        BidOffer val = map.get(value);

        if (val == null) {
            Log.e(TAG, "get(), Non-existent value " + Integer.toString(value) + " created and added without name." + "");
            val = new BidOffer(value, null);
            map.put(value, val);

            List<BidOffer> values = new ArrayList<>();
            Collections.addAll(values, mValues);
            values.add(val);

            mValues = new BidOffer[values.size()];
            values.toArray(mValues);
        }

        return val;
    }

    public static BidOffer[] values() {
        return mValues;
    }

    @Override
    public String toString() {
        return getDescription();
    }

    @Override
    public boolean equals(Object o) {
        return o != null && o instanceof BidOffer && this.value == ((BidOffer) o).value;
    }

    @Override
    public int hashCode() {
        return this.value;
    }
}
