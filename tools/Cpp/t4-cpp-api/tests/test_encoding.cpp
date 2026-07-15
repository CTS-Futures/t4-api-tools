// Ported from t4login/util/test_encoding.py (itself from Java EncodingUtilTests).
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

#include "check.hpp"
#include "t4decoder/byte_stream.hpp"
#include "t4decoder/decimal.hpp"
#include "t4decoder/encoding.hpp"

using namespace t4;

namespace {
using Bytes = std::vector<std::uint8_t>;

std::int32_t decInt(const Bytes& b) {
  ByteReader r(b);
  return decode7BitInt(r);
}
std::int64_t decLong(const Bytes& b) {
  ByteReader r(b);
  return decode7BitLong(r);
}
Decimal decDec(const Bytes& b) {
  ByteReader r(b);
  return decodeDecimal(r);
}

// encode v, decode it back, assert the round-trip value matches.
void roundTripInt(std::int32_t v) {
  CHECK_MSG(decInt(encode7BitInt(v)) == v,
            "int round-trip failed for " + std::to_string(v));
}
void roundTripLong(std::int64_t v) {
  CHECK_MSG(decLong(encode7BitLong(v)) == v,
            "long round-trip failed for " + std::to_string(v));
}
void roundTripDec(const Decimal& v) {
  Decimal back = decDec(encodeDecimal(v));
  CHECK_MSG(back.equalsValue(v),
            "decimal round-trip failed for " + v.toString() + " got " +
                back.toString());
}
}  // namespace

// --- 7-bit int known byte vectors -----------------------------------------
T4_TEST(int_known_vectors) {
  CHECK_EQ(encode7BitInt(0), (Bytes{0x00}));
  CHECK_EQ(encode7BitInt(1), (Bytes{0x01}));
  CHECK_EQ(encode7BitInt(127), (Bytes{0x7F}));
  CHECK_EQ(encode7BitInt(128), (Bytes{0x80, 0x01}));
  CHECK_EQ(encode7BitInt(16383), (Bytes{0xFF, 0x7F}));
  CHECK_EQ(encode7BitInt(16384), (Bytes{0x80, 0x80, 0x01}));
  // decode mirrors
  CHECK_EQ(decInt(Bytes{0x80, 0x01}), 128);
  CHECK_EQ(decInt(Bytes{0xFF, 0x7F}), 16383);
}

T4_TEST(int_lengths_and_round_trip) {
  CHECK_EQ(encode7BitInt(0).size(), std::size_t(1));
  CHECK_EQ(encode7BitInt(0x80).size(), std::size_t(2));
  CHECK_EQ(encode7BitInt(std::numeric_limits<std::int32_t>::max()).size(),
           std::size_t(5));
  CHECK_EQ(encode7BitInt(std::numeric_limits<std::int32_t>::min()).size(),
           std::size_t(5));
  CHECK_EQ(encode7BitInt(-1).size(), std::size_t(5));

  roundTripInt(109050);
  roundTripInt(-109050);
  roundTripInt(0);
  roundTripInt(1);
  roundTripInt(0x7F);
  roundTripInt(0x80);
  roundTripInt(-1);
  roundTripInt(std::numeric_limits<std::int32_t>::max());
  roundTripInt(std::numeric_limits<std::int32_t>::min());
}

// --- 7-bit long known vectors + round trip ---------------------------------
T4_TEST(long_known_vectors) {
  CHECK_EQ(encode7BitLong(0), (Bytes{0x00}));
  CHECK_EQ(encode7BitLong(1), (Bytes{0x01}));
  CHECK_EQ(encode7BitLong(128), (Bytes{0x80, 0x01}));
}

T4_TEST(long_lengths_and_round_trip) {
  CHECK_EQ(encode7BitLong(0).size(), std::size_t(1));
  CHECK_EQ(encode7BitLong(std::numeric_limits<std::int64_t>::max()).size(),
           std::size_t(9));
  CHECK_EQ(encode7BitLong(std::numeric_limits<std::int64_t>::min()).size(),
           std::size_t(10));
  CHECK_EQ(encode7BitLong(-1).size(), std::size_t(10));

  roundTripLong(109050);
  roundTripLong(-109050);
  roundTripLong(0);
  roundTripLong(-1);
  roundTripLong(599266080000000000LL);  // getIncrementalTime threshold
  roundTripLong(638000000000000000LL);  // a trade-date tick value
  roundTripLong(std::numeric_limits<std::int64_t>::max());
  roundTripLong(std::numeric_limits<std::int64_t>::min());
}

// --- Decimal ----------------------------------------------------------------
T4_TEST(decimal_zero_vector) {
  CHECK_EQ(encodeDecimal(Decimal::fromString("0")), (Bytes{0x00}));
}

T4_TEST(decimal_simple_round_trip) {
  roundTripDec(Decimal::fromString("1"));
  roundTripDec(Decimal::fromString("-1"));
  roundTripDec(Decimal::fromString("109.050"));
  roundTripDec(Decimal::fromString("-109.050"));
  roundTripDec(Decimal::fromString("0"));
}

// Comprehensive value set from Java test_Should_Encode_Decode_BigDecimal_3,
// quantized to scale 18 (matches Python test_scale18_round_trip).
T4_TEST(decimal_scale18_round_trip) {
  const char* values[] = {
      "0",         "0.000000000001", "0.00000000001", "0.0000000001",
      "0.000000001","0.00000001",    "0.00000005",    "0.0000001",
      "0.00000015","0.00000025",     "0.0000005",     "0.000001",
      "0.00000105","0.0000015",      "0.0000025",     "0.000005",
      "0.00001",   "0.000025",       "0.00005",       "0.0001",
      "0.00025",   "0.0005",         "0.001",         "0.00125",
      "0.0025",    "0.00390625",     "0.005",         "0.0078125",
      "0.01",      "0.015625",       "0.02",          "0.025",
      "0.03125",   "0.05",           "0.1",           "0.10000000000000001",
      "0.125",     "0.2",            "0.25",          "0.5",
      "1",         "10",             "100",           "125",
      "2",         "2.5",            "20",            "200",
      "25",        "250",            "400",           "5",
      "50",        "500"};
  for (const char* v : values) {
    Decimal d = Decimal::fromString(v).setScaleHalfEven(18);
    roundTripDec(d);
  }
}

// setScaleHalfEven banker's-rounding behaviour.
T4_TEST(decimal_half_even_rounding) {
  // 0.125 -> scale 2: halfway, round to even (0.12).
  CHECK_EQ(Decimal::fromString("0.125").setScaleHalfEven(2).toString(),
           std::string("0.12"));
  // 0.135 -> scale 2: halfway, round to even (0.14).
  CHECK_EQ(Decimal::fromString("0.135").setScaleHalfEven(2).toString(),
           std::string("0.14"));
  // 0.121 -> scale 2: below half, truncates (0.12).
  CHECK_EQ(Decimal::fromString("0.121").setScaleHalfEven(2).toString(),
           std::string("0.12"));
  // 0.126 -> scale 2: above half, rounds up (0.13).
  CHECK_EQ(Decimal::fromString("0.126").setScaleHalfEven(2).toString(),
           std::string("0.13"));
  // extend scale up: value preserved.
  CHECK_EQ(Decimal::fromString("5000.25").setScaleHalfEven(18).toString(),
           std::string("5000.250000000000000000"));
}

// divideInt mirrors Price::fromTicks: integer/integer at scale 18, half-even.
T4_TEST(decimal_divide_int) {
  // 1 / 4 = 0.25
  CHECK_EQ(Decimal::divideInt(BigInt(1), 4, 18).toString(),
           std::string("0.250000000000000000"));
  // 20001 / 4 = 5000.25
  CHECK_EQ(Decimal::divideInt(BigInt(20001), 4, 18).toString(),
           std::string("5000.250000000000000000"));
  // 1 / 3 at scale 18 = 0.333...3 (half-even on the 19th digit -> stays 3)
  CHECK_EQ(Decimal::divideInt(BigInt(1), 3, 18).toString(),
           std::string("0.333333333333333333"));
  // 2 / 3 at scale 18 = 0.666...7 (rounds up)
  CHECK_EQ(Decimal::divideInt(BigInt(2), 3, 18).toString(),
           std::string("0.666666666666666667"));
  // negative
  CHECK_EQ(Decimal::divideInt(BigInt(-1), 4, 18).toString(),
           std::string("-0.250000000000000000"));
}
