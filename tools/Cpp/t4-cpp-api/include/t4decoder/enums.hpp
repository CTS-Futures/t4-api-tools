// Ports of the small definition enums (BidOffer, MarketMode, ChartDataChange,
// ChartDataType). Underlying int values match the Java/Python/JS sources.
#pragma once

namespace t4 {

// Which side of the market a trade executed against.
enum class BidOffer : int { Undefined = 0, Bid = 1, Offer = -1 };

inline BidOffer bidOfferFromInt(int v) {
  if (v == 1) return BidOffer::Bid;
  if (v == -1) return BidOffer::Offer;
  return BidOffer::Undefined;
}

// Exchange session lifecycle states (0..15).
enum class MarketMode : int {
  Undefined = 0, PreOpen = 1, Open = 2, RestrictedOpen = 3, PreClosed = 4,
  Closed = 5, Suspended = 6, Halted = 7, Failed = 8, PreCross = 9, Cross = 10,
  Expired = 11, Rejected = 12, Unavailable = 13, NoPermission = 14,
  TrialExpired = 15
};

inline MarketMode marketModeFromInt(int v) {
  if (v >= 0 && v <= 15) return static_cast<MarketMode>(v);
  return MarketMode::Undefined;
}

// The kind of change the reader last applied to ChartDataState.
enum class ChartDataChange : int {
  NONE = 0, Trade = 1, Quote = 2, MarketMode = 3, Settlement = 4, TradeBar = 5,
  TradeDate = 6, TPO = 7, TickChange = 8, RFQ = 9, HeldSettlement = 10,
  ClearedVolume = 11, OpenInterest = 12, VWAP = 13, MarketSwitch = 14,
  MarketDefinition = 15
};

// Aggregation type. Values match the Java static instances; unknown wire
// values map to Tick (the getBarStartTime default branch returns the raw time
// for anything that is not Second/Minute/Hour/Day/TPO).
enum class ChartDataType : int {
  Tick = 0, Second = 1, Minute = 2, Hour = 3, Day = 4, TPO = 5, TickChange = 6
};

inline ChartDataType chartDataTypeFromInt(int v) {
  if (v >= 0 && v <= 6) return static_cast<ChartDataType>(v);
  return ChartDataType::Tick;
}

}  // namespace t4
