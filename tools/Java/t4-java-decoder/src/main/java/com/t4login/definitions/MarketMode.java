package com.t4login.definitions;

import com.t4login.AsEnum;
import com.t4login.Constant;
import com.t4login.Log;
import com.t4login.Resource;

import java.util.HashMap;
import java.util.Map;

@AsEnum
public class MarketMode {

    private static final String TAG = MarketMode.class.getName();

    // @formatter:off
    @Constant(0)
    public static final MarketMode Undefined;
    @Constant(1)
    public static final MarketMode PreOpen;
    @Constant(2)
    public static final MarketMode Open;
    @Constant(3)
    public static final MarketMode RestrictedOpen;
    @Constant(4)
    public static final MarketMode PreClosed;
    @Constant(5)
    public static final MarketMode Closed;
    @Constant(6)
    public static final MarketMode Suspended;
    @Constant(7)
    public static final MarketMode Halted;
    @Constant(8)
    public static final MarketMode Failed;
    @Constant(9)
    public static final MarketMode PreCross;
    @Constant(10)
    public static final MarketMode Cross;
    @Constant(11)
    public static final MarketMode Expired;
    @Constant(12)
    public static final MarketMode Rejected;
    @Constant(13)
    public static final MarketMode Unavailable;
    @Constant(14)
    public static final MarketMode NoPermission;
    @Constant(15)
    public static final MarketMode TrialExpired;
    // @formatter:on

    private final int value;
    private final String name;
    private final String descr_loc;
    private final String ico_res;

    private static Map<Integer, MarketMode> map = new HashMap<>();
    private static Map<String, MarketMode> names = new HashMap<>();

    static {
        Undefined = new MarketMode(0, "Undefined", "market_mode_undef", "t4_mode_undef");
        map.put(Undefined.getValue(), Undefined);
        PreOpen = new MarketMode(1, "PreOpen", "market_mode_preopen", "t4_mode_preopen");
        map.put(PreOpen.getValue(), PreOpen);
        Open = new MarketMode(2, "Open", "market_mode_open", "t4_mode_open");
        map.put(Open.getValue(), Open);
        RestrictedOpen = new MarketMode(3, "RestrictedOpen", "market_mode_restrictedopen", "t4_mode_closed");
        map.put(RestrictedOpen.getValue(), RestrictedOpen);
        PreClosed = new MarketMode(4, "PreClosed", "market_mode_preclosed", "t4_mode_preopen");
        map.put(PreClosed.getValue(), PreClosed);
        Closed = new MarketMode(5, "Closed", "market_mode_closed", "t4_mode_closed");
        map.put(Closed.getValue(), Closed);
        Suspended = new MarketMode(6, "Suspended", "market_mode_suspended", "t4_mode_closed");
        map.put(Suspended.getValue(), Suspended);
        Halted = new MarketMode(7, "Halted", "market_mode_halted", "t4_mode_closed");
        map.put(Halted.getValue(), Halted);
        Failed = new MarketMode(8, "Failed", "market_mode_failed", "t4_mode_closed");
        map.put(Failed.getValue(), Failed);
        PreCross = new MarketMode(9, "PreCross", "market_mode_precross", "t4_mode_open");
        map.put(PreCross.getValue(), PreCross);
        Cross = new MarketMode(10, "Cross", "market_mode_cross", "t4_mode_open");
        map.put(Cross.getValue(), Cross);
        Expired = new MarketMode(11, "Expired", "market_mode_expired", "t4_mode_closed");
        map.put(Expired.getValue(), Expired);
        Rejected = new MarketMode(12, "Rejected", "market_mode_rejected", "t4_mode_undef");
        map.put(Rejected.getValue(), Rejected);
        Unavailable = new MarketMode(13, "Unavailable", "market_mode_unavailable", "t4_mode_undef");
        map.put(Unavailable.getValue(), Unavailable);
        NoPermission = new MarketMode(14, "NoPermission", "market_mode_nopermission", "t4_mode_undef");
        map.put(NoPermission.getValue(), NoPermission);
        TrialExpired = new MarketMode(15, "TrialExpired", "market_mode_trialexpired", "t4_mode_undef");
        map.put(TrialExpired.getValue(), TrialExpired);
    }

    MarketMode(int value, String name, String descr_loc, String ico_res) {
        this.value = value;
        this.name = name;
        this.descr_loc = descr_loc;
        this.ico_res = ico_res;
    }

    public int getValue() {
        return this.value;
    }

    public String getName() {
        return this.name;
    }

    public String getDescription() {
        if (this.descr_loc != null) {
            return Resource.localizeString(descr_loc);
        } else {
            return Integer.toString(this.value);
        }
    }

    /**
     * Returns the description resource id to use for this market mode.
     *
     * @return
     */
    public String getDescrResID() {
        return this.descr_loc;
    }

    /**
     * Returns the drawable resource id to use for this market mode.
     *
     * @return
     */
    public String getIconResID() {
        return this.ico_res;
    }

    public static MarketMode get(int value) {

        MarketMode val = map.get(value);

        if (val == null) {
            Log.e(TAG, "get(), Non-existent value " + Integer.toString(value) + " created and added without name." + "");
            val = new MarketMode(value, Integer.toString(value), null, "t4_mode_undef");
            map.put(value, val);
            names.put(Integer.toString(value), val);
        }

        return val;
    }

    public static MarketMode valueOf(String name) {
        return names.get(name);
    }

    @Override
    public String toString() {
        return getDescription();
    }
}
