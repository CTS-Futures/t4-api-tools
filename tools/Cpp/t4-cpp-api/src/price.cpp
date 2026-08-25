#include "t4decoder/price.hpp"

#include "t4decoder/i_market_conversion.hpp"
#include "t4decoder/vpt.hpp"

namespace t4 {

const Price& Price::zero() {
  static const Price z;
  return z;
}

Price Price::fromTicks(const IMarketConversion& mkt, long long ticks) {
  long long denom = mkt.getDenominator();
  // ticks / denominator at scale 18, half-even. denom is a positive market
  // denominator; divideInt requires a positive scalar within BigInt limits.
  return Price(Decimal::divideInt(BigInt(ticks),
                                  static_cast<std::uint64_t>(denom), Scale));
}

Price Price::fromIncrements(const IMarketConversion& mkt,
                            const Decimal& increments) {
  const VPT* vpt = mkt.getVpt();
  if (vpt == nullptr || !vpt->getIsValid()) {
    return Price(increments.multiply(mkt.getMinPriceIncrement().value()));
  }
  // Full VPT path is not yet implemented (see vpt.hpp). getIsValid()==false
  // means we never reach here today.
  return Price(increments.multiply(mkt.getMinPriceIncrement().value()));
}

}  // namespace t4
