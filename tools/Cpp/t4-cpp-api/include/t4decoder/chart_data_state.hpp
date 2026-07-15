// Port of com.t4login.definitions.chartdata.ChartDataState.
//
// Mutable state populated by the non-aggregated (T4Bin) reader. Field names
// keep the PascalCase of the Java/Python/JS sources for 1:1 parity. Also
// implements IMarketConversion so it can drive Price::fromTicks/fromIncrements.
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "t4decoder/decimal.hpp"
#include "t4decoder/enums.hpp"
#include "t4decoder/i_market_conversion.hpp"
#include "t4decoder/n_date_time.hpp"
#include "t4decoder/price.hpp"

namespace t4 {

struct ChartDataState : public IMarketConversion {
  ChartDataChange Change = ChartDataChange::NONE;

  // Trade date
  NDateTime TradeDate;
  long long TradeDateTicks = 0;

  // Market definition
  bool MarketDefined = false;
  std::string MarketID;
  int Numerator = 0;
  int Denominator = 0;
  std::string PriceCode;
  double TickValue = 0.0;
  std::string VPTSpec;
  std::optional<Price> MinCabPrice;

  // Last trade
  long long LastTTV = 0;
  long long LastTimeTicks = 0;
  Price LastTradePrice;
  Decimal LastPriceIncrements;

  int TradeVolume = 0;
  BidOffer AtBidOrOffer = BidOffer::Undefined;
  std::vector<int> OrderVolumes;
  bool DueToSpread = false;

  // Bar
  long long BarStartTime = 0;
  long long BarCloseTime = 0;
  Price BarOpenPrice;
  Price BarHighPrice;
  Price BarLowPrice;
  Price BarClosePrice;
  int BarVolume = 0;
  int BarBidVolume = 0;
  int BarOfferVolume = 0;
  int BarTrades = 0;
  int BarTradesAtBid = 0;
  int BarTradesAtOffer = 0;

  // TPO
  long long TPOStartTime = 0;
  Price TPOBasePrice;
  std::optional<Price> TPOPrice;
  int TPOVolume = 0;
  int TPOVolumeAtBid = 0;
  int TPOVolumeAtOffer = 0;
  bool TPOIsOpening = false;
  bool TPOIsClosing = false;

  // Quote
  Price BidPrice;
  int BidRealVolume = 0;
  int BidImpliedVolume = 0;
  Price OfferPrice;
  int OfferRealVolume = 0;
  int OfferImpliedVolume = 0;

  // Market mode / settlement / OI / VWAP
  MarketMode Mode = MarketMode::Undefined;
  std::optional<Price> SettlementPrice;
  std::optional<Price> SettlementHeldPrice;
  int ClearedVolume = 0;
  long long OpenInterest = 0;
  std::optional<Price> VWAP_Price;

  // RFQ
  BidOffer RFQBuySell = BidOffer::Undefined;
  int RFQVolume = 0;

  // Incremental state
  Decimal LastBarLowPriceIncrements;
  Decimal LastTPOBasePriceIncrements;
  Decimal LastBidPriceIncrements;

  // --- IMarketConversion -------------------------------------------------
  long long getDenominator() const override { return Denominator; }

  Price getMinPriceIncrement() const override {
    if (!minPriceIncrement_ || minPriceIncrement_->isZero()) {
      minPriceIncrement_ = Price(Decimal::divideInt(
          BigInt(static_cast<long long>(Numerator)),
          static_cast<std::uint64_t>(Denominator), Price::Scale));
    }
    return *minPriceIncrement_;
  }

  const VPT* getVpt() const override { return nullptr; }

  // Drop the lazily-computed min-price-increment (call after Numerator/
  // Denominator change, e.g. a market (re)definition).
  void resetConversionCache() const { minPriceIncrement_.reset(); }

private:
  mutable std::optional<Price> minPriceIncrement_;
};

}  // namespace t4
