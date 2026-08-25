package com.t4login.definitions.chartdata;

import com.t4login.datetime.NDateTime;


/**
 * Chart data format definitions.
 */
public final class ChartFormat {

    public static final int NONE = 0;
    public static final int TRADE_DUE_TO_SPREAD = 1;
    public static final int TRADE_AT_BID = 2;
    public static final int TRADE_AT_OFFER = 4;

    public static final int NO_CACHE = 1;

    public static final int CVAL_T4BIN_VERSION = 1;     // Current binary version.

    public static final int CTAG_SOF = 1;
    public static final int CTAG_MARKET_DEFINITION = 2;

    public static final int CTAG_CONSOLIDATED = 7;
    public static final int CTAG_MARKET_SWITCH = 8;
    public static final int CTAG_MARKET_KEY = 9;

    //public static final int CTAG_TICKDATAPOINT = 10;             // No compression encoding (used for double price values.)
    public static final int CTAG_TICKDATAPOINT_7BIT = 11;        // Price values 7-bit encoded.
    public static final int CTAG_TICKDATAPOINT_NEG_7BIT = 12;    // Price values negative and 7-bit encoded.

    //public static final int CTAG_TICKDATAPOINT_ALT = 16;          // No compression encoding. (Alt includes order volumes.)
    public static final int CTAG_TICKDATAPOINT_ALT_7BIT = 17;     // Price values 7-bit encoded. (Alt includes order volumes.)
    public static final int CTAG_TICKDATAPOINT_ALT_NEG_7BIT = 18; //Price values negative and 7-bit encoded. (Alt includes order volumes.)

    //public static final int CTAG_TICKCHANGEDATAPOINT = 13;             // No compression encoding (used for double price values.)
    public static final int CTAG_TICKCHANGEDATAPOINT_7BIT = 14;        // Price values 7-bit encoded.
    public static final int CTAG_TICKCHANGEDATAPOINT_NEG_7BIT = 15;    // Price values negative and 7-bit encoded.

    //public static final int CTAG_BARDATAPOINT = 20;
    public static final int CTAG_BARDATAPOINT_7BIT_DELTA_LOW = 21;       // Bar prices as difference to the low price.
    public static final int CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW = 22;   // Bar prices as difference to the low price.

    public static final int CTAG_TPO_START = 30;
    public static final int CTAG_TPO_START_NEGBASE = 31;
    public static final int CTAG_TPO_DATAPOINT = 32;
    public static final int CTAG_TPO_DATAPOINT_OPEN = 33;
    public static final int CTAG_TPO_DATAPOINT_CLOSE = 34;
    public static final int CTAG_TPO_DATAPOINT_OPENCLOSE = 35;

    public static final int CTAG_QUOTE_7BIT = 50;
    public static final int CTAG_QUOTE_NEG_7BIT = 51;
    public static final int CTAG_QUOTE_VOLUME_DELTA = 52;

    public static final int CTAG_MARKET_MODE = 100;
    public static final int CTAG_MARKET_SETTLEMENT = 101;
    public static final int CTAG_MARKET_HELD_SETTLEMENT = 102;
    public static final int CTAG_MARKET_CLEARED_VOLUME = 103;
    public static final int CTAG_MARKET_OPEN_INTEREST = 104;
    public static final int CTAG_MARKET_VWAP = 105;
    public static final int CTAG_MARKET_RFQ = 106;

    // Price support.
    public static final int CTAG_TRADE_PRICE  = 60;             // Market trade recorded with price as a delta increment
    public static final int CTAG_TRADE_PRICE_DEC  = 61;         // Market trade recorded with price increment.

    public static final int CTAG_TRADE_PRICE_ALT  = 62;         // Market trade recorded in integral price intervals. (Alt includes order volumes.)
    public static final int CTAG_TRADE_PRICE_DEC_ALT  = 63;     // Market trade recorded in fractional price intervals. (Alt includes order volumes.)

    public static final int CTAG_PRICE_CHANGE  = 140;         // Price change encoded in delta increments.
    public static final int CTAG_PRICE_CHANGE_DEC  = 141;     // Price change encoded in increments.

    public static final int CTAG_BAR_PRICE  = 65;             // Bar prices recorded in price interval differences to the low price.
    public static final int CTAG_BAR_PRICE_DEC  = 66;         // Bar prices as fractional price intervals (no deltas, each price independentrly encoded).

    public static final int CTAG_TPO_START_PRICE  = 190;
    public static final int CTAG_TPO_START_PRICE_DEC  = 191;
    public static final int CTAG_TPO_PRICE  = 192;
    public static final int CTAG_TPO_OPEN_PRICE  = 193;
    public static final int CTAG_TPO_CLOSE_PRICE  = 194;
    public static final int CTAG_TPO_OPENCLOSE_PRICE  = 195;

    public static final int CTAG_QUOTE_PRICE  = 53;           // Quote prices saved with bid as a delta price increment and offer as a delta increment to bid.
    public static final int CTAG_QUOTE_PRICE_DEC  = 54;       // Quote prices save with bid and offer as decimal increments.

    public static final int CTAG_SETTLEMENT_PRICE  = 107;
    public static final int CTAG_HELD_SETTLEMENT_PRICE  = 108;
    public static final int CTAG_VWAP_PRICE  = 109;


    private ChartFormat() {
    }

    /**
     * Gets the start time of the bar for the specified time.
     *
     * @param time      The time of the bar.
     * @param tradeDate The trade date of the bar.
     * @param dataType  The data type of the bar.
     * @return The start time of the bar.
     */
    public static NDateTime getBarStartTime(NDateTime time, NDateTime tradeDate, ChartDataType dataType) {

        if (dataType == ChartDataType.Second) {
            return new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), time.getMinute(), time.getSecond(), 0);
        } else if (dataType == ChartDataType.Minute || dataType == ChartDataType.TPO) {
            return new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), time.getMinute(), 0, 0);
        } else if (dataType == ChartDataType.Hour) {
            return new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), 0, 0, 0);
        } else if (dataType == ChartDataType.Day) {
            return tradeDate;
        } else {
            return time;
        }
    }

    /**
     * Gets the start time of the bar for the specified time.
     *
     * @param timeTicks      The time of the bar.
     * @param tradeDateTicks The trade date of the bar.
     * @param dataType       The data type of the bar.
     * @return The start time of the bar.
     */
    public static long getBarStartTime(long timeTicks, long tradeDateTicks, ChartDataType dataType) {

        if (dataType == ChartDataType.Second) {
            NDateTime time = new NDateTime(timeTicks);
            time = new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), time.getMinute(), time.getSecond(), 0);
            return time.getTicks();
        } else if (dataType == ChartDataType.Minute || dataType == ChartDataType.TPO) {
            NDateTime time = new NDateTime(timeTicks);
            time = new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), time.getMinute(), 0, 0);
            return time.getTicks();
        } else if (dataType == ChartDataType.Hour) {
            NDateTime time = new NDateTime(timeTicks);
            time = new NDateTime(time.getYear(), time.getMonth(), time.getDay(), time.getHour(), 0, 0, 0);
            return time.getTicks();
        } else if (dataType == ChartDataType.Day) {
            return tradeDateTicks;
        } else {
            return timeTicks;
        }
    }

}
