// Phase 4: non-aggregated (T4Bin) reader. Builds a synthetic stream with the
// already-validated encoders and checks the decoded ChartDataState after each
// record (SOF, market definition, trade, quote).
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "check.hpp"
#include "t4decoder/chart_data_stream_reader.hpp"
#include "t4decoder/encoding.hpp"
#include "t4decoder/n_date_time.hpp"

using namespace t4;

namespace {
using Bytes = std::vector<std::uint8_t>;

void appendBytes(Bytes& b, const Bytes& more) {
  b.insert(b.end(), more.begin(), more.end());
}
void putLE(Bytes& b, std::uint64_t v, int n) {
  for (int i = 0; i < n; ++i) b.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xFF));
}
void putString7(Bytes& b, const std::string& s) {
  appendBytes(b, encode7BitInt(static_cast<std::int32_t>(s.size())));
  b.insert(b.end(), s.begin(), s.end());
}
// Frame a record: enc7(length) + enc7(tag) + payload, length = tag+payload.
Bytes record(int tag, const Bytes& payload) {
  Bytes body = encode7BitInt(tag);
  appendBytes(body, payload);
  Bytes out = encode7BitInt(static_cast<std::int32_t>(body.size()));
  appendBytes(out, body);
  return out;
}
}  // namespace

T4_TEST(t4bin_reader_trade_and_quote) {
  const long long tradeTicks = NDateTime(2025, 6, 30, 0, 0, 0).ticks();

  Bytes stream;

  // SOF: version int32 + tradeDate (8-byte tick long). body length 13 (>12).
  {
    Bytes p;
    putLE(p, 1, 4);                                   // version
    putLE(p, static_cast<std::uint64_t>(tradeTicks), 8);  // trade date
    appendBytes(stream, record(/*CTAG_SOF*/ 1, p));
  }
  // MARKET_DEFINITION: id, numerator, denominator, priceCode, tickValue(double)
  {
    Bytes p;
    putString7(p, "ES");
    appendBytes(p, encode7BitInt(1));   // numerator
    appendBytes(p, encode7BitInt(4));   // denominator
    putString7(p, "0.25");              // priceCode
    double tv = 12.5;
    std::uint64_t bits;
    std::memcpy(&bits, &tv, sizeof(bits));
    putLE(p, bits, 8);                  // tickValue
    appendBytes(stream, record(/*CTAG_MARKET_DEFINITION*/ 2, p));
  }
  // TICKDATAPOINT_7BIT: timeDelta, volume, priceDelta(ticks), ttv, attr(AT_BID)
  {
    Bytes p;
    appendBytes(p, encode7BitLong(1000));   // time delta
    appendBytes(p, encode7BitInt(10));      // volume
    appendBytes(p, encode7BitInt(20001));   // price delta in ticks -> 5000.25
    appendBytes(p, encode7BitInt(5));       // ttv
    appendBytes(p, encode7BitInt(2));       // attr = TRADE_AT_BID
    appendBytes(stream, record(/*CTAG_TICKDATAPOINT_7BIT*/ 11, p));
  }
  // QUOTE_7BIT: timeDelta, bidDelta, bidReal, bidImplied, offerDelta, offerReal, offerImplied
  {
    Bytes p;
    appendBytes(p, encode7BitLong(10));     // time delta
    appendBytes(p, encode7BitInt(20000));   // bid delta -> 5000.00
    appendBytes(p, encode7BitInt(7));       // bid real vol
    appendBytes(p, encode7BitInt(0));       // bid implied
    appendBytes(p, encode7BitInt(1));       // offer delta -> bid + 0.25
    appendBytes(p, encode7BitInt(8));       // offer real vol
    appendBytes(p, encode7BitInt(0));       // offer implied
    appendBytes(stream, record(/*CTAG_QUOTE_7BIT*/ 50, p));
  }

  ChartDataStreamReader reader(stream, NDateTime(0), "ES");

  // 1) SOF -> TradeDate
  CHECK(reader.read());
  CHECK(reader.state().Change == ChartDataChange::TradeDate);
  CHECK_EQ(reader.state().TradeDate.toString(),
           std::string("2025-06-30 00:00:00"));

  // 2) MARKET_DEFINITION
  CHECK(reader.read());
  CHECK(reader.state().Change == ChartDataChange::MarketDefinition);
  CHECK(reader.state().MarketDefined);
  CHECK_EQ(reader.state().Numerator, 1);
  CHECK_EQ(reader.state().Denominator, 4);
  CHECK_EQ(reader.state().PriceCode, std::string("0.25"));
  CHECK_EQ(reader.state().getMinPriceIncrement().toString(),
           std::string("0.250000000000000000"));

  // 3) Trade
  CHECK(reader.read());
  CHECK(reader.state().Change == ChartDataChange::Trade);
  CHECK_EQ(reader.state().TradeVolume, 10);
  CHECK_EQ(reader.state().LastTTV, 5LL);
  CHECK(reader.state().AtBidOrOffer == BidOffer::Bid);
  CHECK_EQ(reader.state().LastTradePrice.toString(),
           std::string("5000.250000000000000000"));

  // 4) Quote
  CHECK(reader.read());
  CHECK(reader.state().Change == ChartDataChange::Quote);
  CHECK_EQ(reader.state().BidPrice.toString(),
           std::string("5000.000000000000000000"));
  CHECK_EQ(reader.state().OfferPrice.toString(),
           std::string("5000.250000000000000000"));
  CHECK_EQ(reader.state().BidRealVolume, 7);
  CHECK_EQ(reader.state().OfferRealVolume, 8);

  // End of stream.
  CHECK(!reader.read());
}
