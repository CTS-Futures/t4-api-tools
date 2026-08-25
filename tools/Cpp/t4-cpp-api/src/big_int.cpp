#include "t4decoder/big_int.hpp"

#include <algorithm>
#include <stdexcept>

namespace t4 {

void BigInt::trim() {
  while (!mag_.empty() && mag_.back() == 0) mag_.pop_back();
  if (mag_.empty()) neg_ = false;  // canonical zero is non-negative
}

BigInt BigInt::fromU64(std::uint64_t v) {
  BigInt r;
  while (v != 0) {
    r.mag_.push_back(static_cast<std::uint32_t>(v % kBase));
    v /= kBase;
  }
  return r;
}

BigInt::BigInt(long long v) {
  bool n = v < 0;
  // Take magnitude safely (handles LLONG_MIN without UB).
  unsigned long long u = n ? (~static_cast<unsigned long long>(v) + 1ull)
                           : static_cast<unsigned long long>(v);
  *this = fromU64(u);
  neg_ = (!mag_.empty()) && n;
}

BigInt BigInt::fromDecimalString(const std::string& s) {
  std::size_t i = 0;
  bool n = false;
  if (i < s.size() && (s[i] == '+' || s[i] == '-')) {
    n = (s[i] == '-');
    ++i;
  }
  if (i >= s.size())
    throw std::invalid_argument("BigInt::fromDecimalString: no digits");
  // Build by processing 9 decimal digits at a time from the most-significant
  // end via repeated mul-by-10^k + add. Simpler: accumulate digit by digit.
  BigInt r;
  const BigInt ten(10);
  for (; i < s.size(); ++i) {
    char c = s[i];
    if (c < '0' || c > '9')
      throw std::invalid_argument("BigInt::fromDecimalString: bad digit");
    r = r.mul(ten).add(BigInt(static_cast<long long>(c - '0')));
  }
  r.neg_ = (!r.mag_.empty()) && n;
  return r;
}

BigInt BigInt::powerOfTen(unsigned e) {
  // 10^e. Build directly in base-1e9 limbs: 10^(9*q) shifts q limbs, 10^r fills.
  BigInt r;
  unsigned q = e / 9;
  unsigned rem = e % 9;
  std::uint32_t lead = 1;
  for (unsigned k = 0; k < rem; ++k) lead *= 10u;
  r.mag_.assign(q, 0u);
  r.mag_.push_back(lead);
  r.trim();
  return r;
}

BigInt BigInt::abs() const {
  BigInt r = *this;
  r.neg_ = false;
  return r;
}

BigInt BigInt::negated() const {
  BigInt r = *this;
  if (!r.mag_.empty()) r.neg_ = !r.neg_;
  return r;
}

int BigInt::cmpMag(const BigInt& a, const BigInt& b) {
  if (a.mag_.size() != b.mag_.size())
    return a.mag_.size() < b.mag_.size() ? -1 : 1;
  for (std::size_t i = a.mag_.size(); i-- > 0;) {
    if (a.mag_[i] != b.mag_[i]) return a.mag_[i] < b.mag_[i] ? -1 : 1;
  }
  return 0;
}

int BigInt::cmp(const BigInt& a, const BigInt& b) {
  int sa = a.sign(), sb = b.sign();
  if (sa != sb) return sa < sb ? -1 : 1;
  if (sa == 0) return 0;
  int m = cmpMag(a, b);
  return sa > 0 ? m : -m;  // both negative => reverse magnitude order
}

BigInt BigInt::addMag(const BigInt& a, const BigInt& b) {
  BigInt r;
  std::uint64_t carry = 0;
  std::size_t n = std::max(a.mag_.size(), b.mag_.size());
  r.mag_.reserve(n + 1);
  for (std::size_t i = 0; i < n; ++i) {
    std::uint64_t s = carry;
    if (i < a.mag_.size()) s += a.mag_[i];
    if (i < b.mag_.size()) s += b.mag_[i];
    r.mag_.push_back(static_cast<std::uint32_t>(s % kBase));
    carry = s / kBase;
  }
  if (carry) r.mag_.push_back(static_cast<std::uint32_t>(carry));
  r.trim();
  return r;
}

// Requires |a| >= |b|.
BigInt BigInt::subMag(const BigInt& a, const BigInt& b) {
  BigInt r;
  std::int64_t borrow = 0;
  r.mag_.reserve(a.mag_.size());
  for (std::size_t i = 0; i < a.mag_.size(); ++i) {
    std::int64_t s = static_cast<std::int64_t>(a.mag_[i]) - borrow;
    if (i < b.mag_.size()) s -= b.mag_[i];
    if (s < 0) {
      s += kBase;
      borrow = 1;
    } else {
      borrow = 0;
    }
    r.mag_.push_back(static_cast<std::uint32_t>(s));
  }
  r.trim();
  return r;
}

BigInt BigInt::add(const BigInt& o) const {
  if (neg_ == o.neg_) {
    BigInt r = addMag(*this, o);
    r.neg_ = (!r.mag_.empty()) && neg_;
    return r;
  }
  // Differing signs => subtract smaller magnitude from larger.
  int m = cmpMag(*this, o);
  if (m == 0) return BigInt();  // cancel to zero
  if (m > 0) {
    BigInt r = subMag(*this, o);
    r.neg_ = (!r.mag_.empty()) && neg_;
    return r;
  }
  BigInt r = subMag(o, *this);
  r.neg_ = (!r.mag_.empty()) && o.neg_;
  return r;
}

BigInt BigInt::sub(const BigInt& o) const { return add(o.negated()); }

BigInt BigInt::mul(const BigInt& o) const {
  if (mag_.empty() || o.mag_.empty()) return BigInt();
  BigInt r;
  r.mag_.assign(mag_.size() + o.mag_.size(), 0u);
  for (std::size_t i = 0; i < mag_.size(); ++i) {
    std::uint64_t carry = 0;
    std::uint64_t ai = mag_[i];
    for (std::size_t j = 0; j < o.mag_.size(); ++j) {
      std::uint64_t cur = r.mag_[i + j] + ai * o.mag_[j] + carry;
      r.mag_[i + j] = static_cast<std::uint32_t>(cur % kBase);
      carry = cur / kBase;
    }
    std::size_t k = i + o.mag_.size();
    while (carry) {
      std::uint64_t cur = r.mag_[k] + carry;
      r.mag_[k] = static_cast<std::uint32_t>(cur % kBase);
      carry = cur / kBase;
      ++k;
    }
  }
  r.neg_ = neg_ != o.neg_;
  r.trim();
  return r;
}

BigInt BigInt::divModScalar(std::uint64_t d, std::uint64_t& rem) const {
  if (d == 0) throw std::invalid_argument("BigInt::divModScalar: divide by zero");
  // Guard the no-128-bit invariant: (d-1)*kBase + (kBase-1) must fit in uint64.
  // That holds for d up to ~1.8e10, far above any market denominator / 10^k<=9.
  if (d > (UINT64_MAX - (kBase - 1)) / kBase + 1)
    throw std::invalid_argument("BigInt::divModScalar: divisor too large");
  BigInt q;
  q.mag_.assign(mag_.size(), 0u);
  std::uint64_t carry = 0;
  for (std::size_t i = mag_.size(); i-- > 0;) {
    std::uint64_t cur = carry * kBase + mag_[i];
    q.mag_[i] = static_cast<std::uint32_t>(cur / d);
    carry = cur % d;
  }
  q.neg_ = neg_;
  q.trim();
  rem = carry;
  return q;
}

std::string BigInt::toString() const {
  if (mag_.empty()) return "0";
  std::string s;
  if (neg_) s.push_back('-');
  // Most-significant limb without padding, the rest zero-padded to 9 digits.
  s += std::to_string(mag_.back());
  for (std::size_t i = mag_.size() - 1; i-- > 0;) {
    std::string chunk = std::to_string(mag_[i]);
    s.append(9 - chunk.size(), '0');
    s += chunk;
  }
  return s;
}

}  // namespace t4
