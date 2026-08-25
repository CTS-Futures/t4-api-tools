// Exact base-10 decimal: value = unscaled * 10^(-scale), scale >= 0.
//
// Mirrors the subset of Java BigDecimal / decimal.js (precision 40,
// ROUND_HALF_EVEN) that the chart decoder uses. Built on the dependency-free
// BigInt. The wire decimal codec produces (unscaled, scale) directly, so no
// general long division is required here — only:
//   - setScale (multiply by 10^k, or divide by 10^k with half-even rounding)
//   - add / subtract / multiply (exact)
//   - divideInt: integer/integer -> fixed scale, half-even (Price::fromTicks)
#pragma once

#include <string>

#include "t4decoder/big_int.hpp"

namespace t4 {

class Decimal {
public:
  Decimal() : scale_(0) {}
  Decimal(BigInt unscaled, int scale) : unscaled_(std::move(unscaled)), scale_(scale) {}
  explicit Decimal(long long v) : unscaled_(v), scale_(0) {}

  static Decimal fromString(const std::string& s);
  static const Decimal& zero();

  const BigInt& unscaled() const { return unscaled_; }
  int scale() const { return scale_; }
  int sign() const { return unscaled_.sign(); }
  bool isZero() const { return unscaled_.isZero(); }

  Decimal negated() const { return Decimal(unscaled_.negated(), scale_); }
  Decimal abs() const { return Decimal(unscaled_.abs(), scale_); }

  // Return an equal-value decimal rounded/extended to exactly targetScale,
  // using banker's rounding (HALF_EVEN) when digits are dropped.
  Decimal setScaleHalfEven(int targetScale) const;

  // Remove trailing zero digits from the fraction, reducing scale (>= 0).
  // Mirrors Python's `Decimal(unscaled) / 10^scale` normalization used by
  // the wire decimal decoder (so e.g. 12.500000000000000000 prints as 12.5).
  Decimal stripTrailingZeros() const;

  Decimal add(const Decimal& o) const;
  Decimal subtract(const Decimal& o) const;
  Decimal multiply(const Decimal& o) const;

  // round(numerator / denominator) at targetScale, HALF_EVEN. denominator must
  // be a positive integer that fits BigInt::divModScalar (market denominators
  // and 10^k for k<=9 always do).
  static Decimal divideInt(const BigInt& numerator, std::uint64_t denominator,
                           int targetScale);

  // Value comparison (ignores scale differences): -1 / 0 / +1.
  static int compare(const Decimal& a, const Decimal& b);
  bool equalsValue(const Decimal& o) const { return compare(*this, o) == 0; }

  // Plain decimal string (no scientific notation), e.g. "-109.050".
  std::string toString() const;

private:
  // Multiply unscaled by 10^n (n >= 0), keeping value, raising scale by n.
  Decimal scaleUpBy(int n) const;

  BigInt unscaled_;
  int scale_;
};

}  // namespace t4
