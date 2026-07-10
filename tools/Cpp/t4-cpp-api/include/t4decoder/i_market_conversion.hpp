// Port of com.t4login.definitions.priceconversion.IMarketConversion.
//
// Contract a market context (ChartDataState, MarketDefinition) exposes so
// Price::fromTicks / fromIncrements can convert ticks and increments.
#pragma once

#include "t4decoder/price.hpp"

namespace t4 {

class VPT;

class IMarketConversion {
public:
  virtual ~IMarketConversion() = default;
  virtual long long getDenominator() const = 0;
  virtual Price getMinPriceIncrement() const = 0;
  virtual const VPT* getVpt() const = 0;  // nullptr when the market has none
};

}  // namespace t4
