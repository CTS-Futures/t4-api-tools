// Phase 2 domain types: NDateTime, Price, getBarStartTime, message readers.
#include <cstdint>
#include <string>
#include <vector>

#include "check.hpp"
#include "t4decoder/byte_stream.hpp"
#include "t4decoder/chart_data_state.hpp"
#include "t4decoder/chart_format.hpp"
#include "t4decoder/encoding.hpp"
#include "t4decoder/message_reader.hpp"
#include "t4decoder/n_date_time.hpp"
#include "t4decoder/price.hpp"

using namespace t4;

namespace {
using Bytes = std::vector<std::uint8_t>;
void append(Bytes& b, const Bytes& more) { b.insert(b.end(), more.begin(), more.end()); }
}  // namespace

// --- NDateTime --------------------------------------------------------------
T4_TEST(ndatetime_epoch) {
  CHECK_EQ(NDateTime(1, 1, 1, 0, 0, 0).ticks(), 0LL);
  // One year after the epoch (year 1 is not a leap year): 365 days of ticks.
  CHECK_EQ(NDateTime(2, 1, 1).ticks(), 365LL * NDateTime::kTicksPerDay);
}

T4_TEST(ndatetime_round_trip_components) {
  NDateTime d(2025, 6, 30, 14, 30, 15);
  CHECK_EQ(d.year(), 2025);
  CHECK_EQ(d.month(), 6);
  CHECK_EQ(d.day(), 30);
  CHECK_EQ(d.hour(), 14);
  CHECK_EQ(d.minute(), 30);
  CHECK_EQ(d.second(), 15);
  // Reconstruct from ticks -> same calendar breakdown.
  NDateTime e(d.ticks());
  CHECK_EQ(e.toString(), std::string("2025-06-30 14:30:15"));
}

T4_TEST(ndatetime_leap_day) {
  NDateTime d(2024, 2, 29, 0, 0, 0);  // 2024 is a leap year
  CHECK_EQ(d.month(), 2);
  CHECK_EQ(d.day(), 29);
}

// --- getBarStartTime --------------------------------------------------------
T4_TEST(bar_start_time_truncation) {
  NDateTime t(2025, 6, 30, 14, 30, 45);
  long long minuteStart = getBarStartTime(t.ticks(), 0, ChartDataType::Minute);
  CHECK_EQ(NDateTime(minuteStart).toString(),
           std::string("2025-06-30 14:30:00"));
  long long hourStart = getBarStartTime(t.ticks(), 0, ChartDataType::Hour);
  CHECK_EQ(NDateTime(hourStart).toString(), std::string("2025-06-30 14:00:00"));
  // Tick/default returns the raw time.
  CHECK_EQ(getBarStartTime(t.ticks(), 999, ChartDataType::Tick), t.ticks());
  // Day returns the trade date.
  CHECK_EQ(getBarStartTime(t.ticks(), 12345, ChartDataType::Day), 12345LL);
}

// --- Price (via ChartDataState as IMarketConversion) ------------------------
T4_TEST(price_from_ticks_and_increments) {
  ChartDataState s;
  s.Numerator = 1;
  s.Denominator = 4;

  CHECK_EQ(Price::fromTicks(s, 20001).toString(),
           std::string("5000.250000000000000000"));
  CHECK_EQ(Price::fromTicks(s, 1).toString(),
           std::string("0.250000000000000000"));
  // minPriceIncrement = 1/4 = 0.25
  CHECK_EQ(s.getMinPriceIncrement().toString(),
           std::string("0.250000000000000000"));
  // fromIncrements (no VPT) = increments * minPriceIncrement
  CHECK_EQ(Price::fromIncrements(s, Decimal(3)).toString(),
           std::string("0.750000000000000000"));
}

T4_TEST(price_arithmetic) {
  Price a(Decimal::fromString("100.5"));
  Price b(Decimal::fromString("0.25"));
  CHECK_EQ(a.add(b).toString(), std::string("100.750000000000000000"));
  CHECK_EQ(a.subtract(b).toString(), std::string("100.250000000000000000"));
  CHECK(a.compareTo(b) > 0);
  CHECK(b.compareTo(a) < 0);
  CHECK(a.equals(Price(Decimal::fromString("100.5"))));
}

// --- Message readers --------------------------------------------------------
T4_TEST(message_readers) {
  // readInteger: little-endian 0x04030201 = 16909060
  {
    ByteReader r(Bytes{0x01, 0x02, 0x03, 0x04});
    CHECK_EQ(readInteger(r), std::int32_t(0x04030201));
  }
  // readLong: little-endian 1
  {
    ByteReader r(Bytes{0x01, 0, 0, 0, 0, 0, 0, 0});
    CHECK_EQ(readLong(r), std::int64_t(1));
  }
  // readString: 7-bit length 5 + "HELLO"
  {
    Bytes b{0x05, 'H', 'E', 'L', 'L', 'O'};
    ByteReader r(b);
    CHECK_EQ(readString(r), std::string("HELLO"));
  }
  // readShortString empty -> ""
  {
    ByteReader r(Bytes{0x00});
    CHECK_EQ(readShortString(r), std::string());
  }
}

T4_TEST(decode_price_helpers) {
  // decodePrice over an encoded decimal.
  {
    Bytes enc = encodeDecimal(Decimal::fromString("109.05"));
    ByteReader r(enc);
    CHECK(decodePrice(r).value().equalsValue(Decimal::fromString("109.05")));
  }
  // decodePriceN: header 0x00 -> nullopt
  {
    ByteReader r(Bytes{0x00});
    CHECK(!decodePriceN(r).has_value());
  }
  // decodePriceN: header 0x01 + encoded decimal -> present
  {
    Bytes b{0x01};
    append(b, encodeDecimal(Decimal::fromString("25")));
    ByteReader r(b);
    auto p = decodePriceN(r);
    CHECK(p.has_value());
    CHECK(p->value().equalsValue(Decimal::fromString("25")));
  }
}
