// Minimal arbitrary-precision signed integer (dependency-free).
//
// Backs the Decimal/Price types. The reference implementations lean on Java
// BigInteger / JS BigInt / Python int; this is the smallest subset of that
// behaviour the chart decoder actually needs:
//   - construct from int64 / uint64 / decimal digit string
//   - add, subtract, multiply, compare, negate, abs
//   - divide magnitude by a small (<= ~1.8e10) positive scalar with remainder
//   - 10^e construction (for decimal scale shifts)
//   - decimal toString
//
// General BigInt/BigInt long division is intentionally NOT implemented: the
// decode path never needs it (see decimal.hpp notes). Representation is
// sign-magnitude with base-1e9 little-endian limbs, which makes decimal
// rendering and power-of-ten scaling cheap.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace t4 {

class BigInt {
public:
  static constexpr std::uint32_t kBase = 1000000000u;  // 1e9 per limb

  BigInt() = default;                       // zero
  BigInt(long long v);                      // NOLINT(runtime/explicit)
  static BigInt fromU64(std::uint64_t v);
  // Parse optional leading '-' then decimal digits. Throws on bad input.
  static BigInt fromDecimalString(const std::string& s);
  // 10^e.
  static BigInt powerOfTen(unsigned e);

  bool isZero() const { return mag_.empty(); }
  int sign() const { return mag_.empty() ? 0 : (neg_ ? -1 : 1); }
  BigInt abs() const;
  BigInt negated() const;

  // Signed three-way compare: -1 if a<b, 0 if equal, +1 if a>b.
  static int cmp(const BigInt& a, const BigInt& b);

  BigInt add(const BigInt& o) const;
  BigInt sub(const BigInt& o) const;
  BigInt mul(const BigInt& o) const;

  // Divide |this| by a positive scalar d (1 <= d <= ~1.8e10 so that
  // (d-1)*base + (base-1) fits in uint64). Returns floor(|this|/d) with the
  // result sign = this->sign(); sets rem = |this| mod d (always >= 0).
  BigInt divModScalar(std::uint64_t d, std::uint64_t& rem) const;

  std::string toString() const;  // signed decimal, no leading zeros

private:
  void trim();
  // Magnitude-only helpers (ignore sign).
  static int cmpMag(const BigInt& a, const BigInt& b);
  static BigInt addMag(const BigInt& a, const BigInt& b);  // |a|+|b|
  static BigInt subMag(const BigInt& a, const BigInt& b);  // |a|-|b|, needs |a|>=|b|

  bool neg_ = false;
  std::vector<std::uint32_t> mag_;  // little-endian, each limb < kBase; empty == 0
};

}  // namespace t4
