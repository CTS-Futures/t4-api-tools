// Port of com.t4login.definitions.priceconversion.VPT (Variable Price Tick).
//
// NOTE: Currently a documented stub. The full VPT tree (non-uniform tick
// sizes parsed from specs like "25;P>100=50") requires general decimal/decimal
// division and is exercised only by markets that publish a VPT spec. Neither
// ChartDataState (getVpt() == nullptr) nor the aggregated golden fixture uses
// one, so the decoders fall back to the `increments * minPriceIncrement` path.
// getIsValid() returns false here so callers always take that fallback. Full
// VPT support is tracked as a follow-up (see README / plan).
#pragma once

#include <string>

namespace t4 {

class Price;

class VPT {
public:
  explicit VPT(const std::string& spec) : spec_(spec) {}
  bool getIsValid() const { return false; }  // stub: see header note
  const std::string& spec() const { return spec_; }

private:
  std::string spec_;
};

}  // namespace t4
