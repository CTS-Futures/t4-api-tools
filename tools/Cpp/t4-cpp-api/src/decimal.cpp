#include "t4decoder/decimal.hpp"

#include <algorithm>
#include <stdexcept>

namespace t4 {

namespace {
std::uint64_t pow10u(unsigned e) {  // e <= 9 -> fits comfortably in uint64
  std::uint64_t r = 1;
  for (unsigned i = 0; i < e; ++i) r *= 10ull;
  return r;
}

// floor(|mag| / 10^e), and the exact remainder |mag| mod 10^e.
BigInt floorDivPow10(const BigInt& mag, unsigned e, BigInt& remainder) {
  BigInt q = mag.abs();
  unsigned remaining = e;
  while (remaining > 0) {
    unsigned step = remaining < 9u ? remaining : 9u;
    std::uint64_t dummy;
    q = q.divModScalar(pow10u(step), dummy);
    remaining -= step;
  }
  remainder = mag.abs().sub(q.mul(BigInt::powerOfTen(e)));
  return q;
}
}  // namespace

const Decimal& Decimal::zero() {
  static const Decimal z;
  return z;
}

Decimal Decimal::fromString(const std::string& s) {
  std::size_t i = 0;
  bool neg = false;
  if (i < s.size() && (s[i] == '+' || s[i] == '-')) {
    neg = (s[i] == '-');
    ++i;
  }
  std::string digits;
  int scale = 0;
  bool seenDot = false;
  for (; i < s.size(); ++i) {
    char c = s[i];
    if (c == '.') {
      if (seenDot) throw std::invalid_argument("Decimal::fromString: two dots");
      seenDot = true;
      continue;
    }
    if (c < '0' || c > '9')
      throw std::invalid_argument("Decimal::fromString: bad char");
    digits.push_back(c);
    if (seenDot) ++scale;
  }
  if (digits.empty()) digits = "0";
  BigInt unscaled = BigInt::fromDecimalString((neg ? "-" : "") + digits);
  return Decimal(std::move(unscaled), scale);
}

Decimal Decimal::scaleUpBy(int n) const {
  if (n <= 0) return *this;
  return Decimal(unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(n))),
                 scale_ + n);
}

Decimal Decimal::setScaleHalfEven(int targetScale) const {
  if (targetScale == scale_) return *this;
  if (targetScale > scale_) return scaleUpBy(targetScale - scale_);

  unsigned drop = static_cast<unsigned>(scale_ - targetScale);
  BigInt remainder;
  BigInt q = floorDivPow10(unscaled_, drop, remainder);

  // Half-even on the dropped fraction: compare 2*remainder against 10^drop.
  BigInt divisor = BigInt::powerOfTen(drop);
  BigInt twice = remainder.add(remainder);
  int c = BigInt::cmp(twice, divisor);
  bool roundUp = false;
  if (c > 0) {
    roundUp = true;
  } else if (c == 0) {
    std::uint64_t odd;
    q.divModScalar(2, odd);
    roundUp = (odd == 1);  // round half to even
  }
  if (roundUp) q = q.add(BigInt(1));
  if (unscaled_.sign() < 0) q = q.negated();
  return Decimal(std::move(q), targetScale);
}

Decimal Decimal::stripTrailingZeros() const {
  if (scale_ <= 0 || unscaled_.isZero()) return *this;
  BigInt u = unscaled_;
  int s = scale_;
  while (s > 0) {
    std::uint64_t rem;
    BigInt q = u.divModScalar(10, rem);
    if (rem != 0) break;
    u = q;
    --s;
  }
  return Decimal(std::move(u), s);
}

Decimal Decimal::add(const Decimal& o) const {
  int t = std::max(scale_, o.scale_);
  BigInt au = unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - scale_)));
  BigInt bu = o.unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - o.scale_)));
  return Decimal(au.add(bu), t);
}

Decimal Decimal::subtract(const Decimal& o) const {
  int t = std::max(scale_, o.scale_);
  BigInt au = unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - scale_)));
  BigInt bu = o.unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - o.scale_)));
  return Decimal(au.sub(bu), t);
}

Decimal Decimal::multiply(const Decimal& o) const {
  return Decimal(unscaled_.mul(o.unscaled_), scale_ + o.scale_);
}

Decimal Decimal::divideInt(const BigInt& numerator, std::uint64_t denominator,
                           int targetScale) {
  int sign = numerator.sign();
  BigInt scaled =
      numerator.abs().mul(BigInt::powerOfTen(static_cast<unsigned>(targetScale)));
  std::uint64_t rem;
  BigInt q = scaled.divModScalar(denominator, rem);
  std::uint64_t twice = rem * 2;  // rem < denom (<=2^31), so no overflow
  if (twice > denominator) {
    q = q.add(BigInt(1));
  } else if (twice == denominator) {
    std::uint64_t odd;
    q.divModScalar(2, odd);
    if (odd == 1) q = q.add(BigInt(1));
  }
  if (sign < 0) q = q.negated();
  return Decimal(std::move(q), targetScale);
}

int Decimal::compare(const Decimal& a, const Decimal& b) {
  int t = std::max(a.scale_, b.scale_);
  BigInt au = a.unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - a.scale_)));
  BigInt bu = b.unscaled_.mul(BigInt::powerOfTen(static_cast<unsigned>(t - b.scale_)));
  return BigInt::cmp(au, bu);
}

std::string Decimal::toString() const {
  std::string digits = unscaled_.abs().toString();  // "0", "109050", ...
  bool neg = unscaled_.sign() < 0;
  std::string body;
  if (scale_ <= 0) {
    body = digits;
  } else {
    std::size_t s = static_cast<std::size_t>(scale_);
    if (digits.size() <= s) {
      body = "0." + std::string(s - digits.size(), '0') + digits;
    } else {
      std::size_t cut = digits.size() - s;
      body = digits.substr(0, cut) + "." + digits.substr(cut);
    }
  }
  if (neg) body.insert(body.begin(), '-');
  return body;
}

}  // namespace t4
