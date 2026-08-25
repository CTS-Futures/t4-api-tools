// Port of com.t4login.definitions.priceconversion.Price.
//
// Decimal-precision price quantized to scale 18 with HALF_EVEN rounding,
// matching Java BigDecimal at the same scale. Wraps the dependency-free
// Decimal.
#pragma once

#include <string>

#include "t4decoder/decimal.hpp"

namespace t4 {

class IMarketConversion;  // see i_market_conversion.hpp

class Price {
public:
  static constexpr int Scale = 18;

  Price() : value_(Decimal::zero()) {}
  explicit Price(Decimal d) : value_(d.setScaleHalfEven(Scale)) {}
  static Price fromDecimal(const Decimal& d) { return Price(d); }
  static const Price& zero();

  const Decimal& value() const { return value_; }
  bool isZero() const { return value_.isZero(); }
  int sign() const { return value_.sign(); }

  // tick value -> price using the market denominator (scale 18, half-even).
  static Price fromTicks(const IMarketConversion& mkt, long long ticks);
  // increment count -> price (VPT if the market defines one, else
  // increments * minPriceIncrement).
  static Price fromIncrements(const IMarketConversion& mkt,
                              const Decimal& increments);

  Price add(const Price& o) const { return Price(value_.add(o.value_)); }
  Price subtract(const Price& o) const { return Price(value_.subtract(o.value_)); }
  Price multiply(const Price& o) const { return Price(value_.multiply(o.value_)); }
  Price addDecimal(const Decimal& d) const { return Price(value_.add(d)); }

  int compareTo(const Price& o) const { return Decimal::compare(value_, o.value_); }
  bool equals(const Price& o) const { return compareTo(o) == 0; }

  std::string toString() const { return value_.toString(); }

private:
  Decimal value_;
};

}  // namespace t4
