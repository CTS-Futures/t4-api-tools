// Port of com.t4login.definitions.chartdata.ChartFormatAggr.
//
// T4BinAggr tag constants, the Bar data object, and MarketDefinition (an
// IMarketConversion). Used by the aggregated barchart reader.
#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "t4decoder/decimal.hpp"
#include "t4decoder/i_market_conversion.hpp"
#include "t4decoder/n_date_time.hpp"
#include "t4decoder/price.hpp"
#include "t4decoder/vpt.hpp"

namespace t4 {

inline constexpr int CVAL_T4BINAGGR_VERSION = 1;
inline constexpr int CTAG_AGGR_SOF = 1;
inline constexpr int CTAG_AGGR_MARKET_DEFINITION = 2;
inline constexpr int CTAG_AGGR_MARKET_SWITCH = 3;
inline constexpr int CTAG_AGGR_TRADEDATE_SWITCH = 4;
inline constexpr int CTAG_AGGR_BAR_DELTA = 10;
inline constexpr int CTAG_AGGR_BAR = 11;
inline constexpr int CTAG_AGGR_MARKET_MODE = 20;
inline constexpr int CTAG_AGGR_OPEN_INTEREST = 21;
inline constexpr int CTAG_AGGR_SETTLEMENT_PRICE = 22;

// Single aggregated OHLCV bar. Field names match the Java/Python/JS sources.
struct Bar {
  NDateTime TradeDate;
  NDateTime Time;
  NDateTime CloseTime;
  std::string MarketID;
  Price OpenPrice;
  Price HighPrice;
  Price LowPrice;
  Price ClosePrice;
  int Volume = 0;
  int VolumeAtBid = 0;
  int VolumeAtOffer = 0;
  int Trades = 0;
  int TradesAtBid = 0;
  int TradesAtOffer = 0;
};

// Market parameters for price conversion (mirrors the Java inner class).
class MarketDefinition : public IMarketConversion {
public:
  std::string MarketID;
  int Numerator = 0;
  int Denominator = 0;
  std::string PriceCode;
  Decimal TickValue;
  std::string VPTStr;
  std::optional<Price> MinCabPrice;

  MarketDefinition() = default;
  MarketDefinition(std::string marketId, int numerator, int denominator,
                   std::string priceCode, Decimal tickValue, std::string vptStr,
                   std::optional<Price> minCabPrice)
      : MarketID(std::move(marketId)),
        Numerator(numerator),
        Denominator(denominator),
        PriceCode(std::move(priceCode)),
        TickValue(std::move(tickValue)),
        VPTStr(std::move(vptStr)),
        MinCabPrice(std::move(minCabPrice)) {
    minPriceIncrement_ = Price(Decimal::divideInt(
        BigInt(static_cast<long long>(Numerator)),
        static_cast<std::uint64_t>(Denominator), Price::Scale));
    if (!VPTStr.empty() || MinCabPrice.has_value()) {
      vpt_ = VPT(VPTStr);
      hasVpt_ = true;
    }
  }

  long long getDenominator() const override { return Denominator; }
  Price getMinPriceIncrement() const override { return minPriceIncrement_; }
  const VPT* getVpt() const override { return hasVpt_ ? &vpt_ : nullptr; }

private:
  Price minPriceIncrement_;
  VPT vpt_{std::string()};
  bool hasVpt_ = false;
};

}  // namespace t4
