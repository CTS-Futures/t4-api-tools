// Port of com.t4login.definitions.chartdata.ChartFormat.
//
// T4Bin (non-aggregated) record tag constants, trade-flag bits, and the
// bar-start-time truncation helper. Values are copied verbatim from the Java
// original as the canonical set.
#pragma once

#include "t4decoder/enums.hpp"

namespace t4 {

inline constexpr int TRADE_NONE = 0;
inline constexpr int TRADE_DUE_TO_SPREAD = 1;
inline constexpr int TRADE_AT_BID = 2;
inline constexpr int TRADE_AT_OFFER = 4;

inline constexpr int CVAL_T4BIN_VERSION = 1;

inline constexpr int CTAG_SOF = 1;
inline constexpr int CTAG_MARKET_DEFINITION = 2;
inline constexpr int CTAG_CONSOLIDATED = 7;
inline constexpr int CTAG_MARKET_SWITCH = 8;
inline constexpr int CTAG_MARKET_KEY = 9;

inline constexpr int CTAG_TICKDATAPOINT_7BIT = 11;
inline constexpr int CTAG_TICKDATAPOINT_NEG_7BIT = 12;
inline constexpr int CTAG_TICKDATAPOINT_ALT_7BIT = 17;
inline constexpr int CTAG_TICKDATAPOINT_ALT_NEG_7BIT = 18;
inline constexpr int CTAG_TICKCHANGEDATAPOINT_7BIT = 14;
inline constexpr int CTAG_TICKCHANGEDATAPOINT_NEG_7BIT = 15;

inline constexpr int CTAG_BARDATAPOINT_7BIT_DELTA_LOW = 21;
inline constexpr int CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW = 22;

inline constexpr int CTAG_TPO_START = 30;
inline constexpr int CTAG_TPO_START_NEGBASE = 31;
inline constexpr int CTAG_TPO_DATAPOINT = 32;
inline constexpr int CTAG_TPO_DATAPOINT_OPEN = 33;
inline constexpr int CTAG_TPO_DATAPOINT_CLOSE = 34;
inline constexpr int CTAG_TPO_DATAPOINT_OPENCLOSE = 35;

inline constexpr int CTAG_QUOTE_7BIT = 50;
inline constexpr int CTAG_QUOTE_NEG_7BIT = 51;
inline constexpr int CTAG_QUOTE_VOLUME_DELTA = 52;
inline constexpr int CTAG_QUOTE_PRICE = 53;
inline constexpr int CTAG_QUOTE_PRICE_DEC = 54;

inline constexpr int CTAG_TRADE_PRICE = 60;
inline constexpr int CTAG_TRADE_PRICE_DEC = 61;
inline constexpr int CTAG_TRADE_PRICE_ALT = 62;
inline constexpr int CTAG_TRADE_PRICE_DEC_ALT = 63;

inline constexpr int CTAG_BAR_PRICE = 65;
inline constexpr int CTAG_BAR_PRICE_DEC = 66;

inline constexpr int CTAG_MARKET_MODE = 100;
inline constexpr int CTAG_MARKET_SETTLEMENT = 101;
inline constexpr int CTAG_MARKET_HELD_SETTLEMENT = 102;
inline constexpr int CTAG_MARKET_CLEARED_VOLUME = 103;
inline constexpr int CTAG_MARKET_OPEN_INTEREST = 104;
inline constexpr int CTAG_MARKET_VWAP = 105;
inline constexpr int CTAG_MARKET_RFQ = 106;
inline constexpr int CTAG_SETTLEMENT_PRICE = 107;
inline constexpr int CTAG_HELD_SETTLEMENT_PRICE = 108;
inline constexpr int CTAG_VWAP_PRICE = 109;

inline constexpr int CTAG_PRICE_CHANGE = 140;
inline constexpr int CTAG_PRICE_CHANGE_DEC = 141;

inline constexpr int CTAG_TPO_START_PRICE = 190;
inline constexpr int CTAG_TPO_START_PRICE_DEC = 191;
inline constexpr int CTAG_TPO_PRICE = 192;
inline constexpr int CTAG_TPO_OPEN_PRICE = 193;
inline constexpr int CTAG_TPO_CLOSE_PRICE = 194;
inline constexpr int CTAG_TPO_OPENCLOSE_PRICE = 195;

// Truncate a bar/time tick value to the start of its bar for the given
// aggregation type. Returns tradeDateTicks for Day, the raw time otherwise.
long long getBarStartTime(long long timeTicks, long long tradeDateTicks,
                          ChartDataType dataType);

}  // namespace t4
