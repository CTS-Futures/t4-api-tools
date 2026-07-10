// Phase 3 golden-fixture parity: decode tests/fixtures/sample.bin with the
// aggregated reader and reproduce sample_expected.csv field-for-field.
// The CSV schema/formatting mirrors the Python csv_binary_helpers exactly.
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "check.hpp"
#include "t4decoder/chart_data_stream_reader_aggr.hpp"

using namespace t4;

namespace {

// 25-column row; unused fields stay empty (matches CSV_COLUMNS order).
struct Row {
  std::string type, market_id, trade_date, time, close_time;
  std::string open, high, low, close;
  std::string volume, volume_at_bid, volume_at_offer, trades, trades_at_bid,
      trades_at_offer;
  std::string numerator, denominator, price_code, tick_value, vpt, min_cab_price;
  std::string mode;
  std::string settlement_price, held;
  std::string open_interest;

  std::string join() const {
    const std::string cols[] = {
        type,           market_id,      trade_date,     time,
        close_time,     open,           high,           low,
        close,          volume,         volume_at_bid,  volume_at_offer,
        trades,         trades_at_bid,  trades_at_offer, numerator,
        denominator,    price_code,     tick_value,     vpt,
        min_cab_price,  mode,           settlement_price, held,
        open_interest};
    std::string s;
    for (std::size_t i = 0; i < sizeof(cols) / sizeof(cols[0]); ++i) {
      if (i) s += ',';
      s += cols[i];
    }
    return s;
  }
};

std::string fmtNdt(const NDateTime& dt) {
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%03d",
                dt.year(), dt.month(), dt.day(), dt.hour(), dt.minute(),
                dt.second(), dt.millisecond());
  return std::string(buf);
}

// Capture decoded records in the same order the Python handler emits them.
struct Recorder : AggrHandler {
  std::vector<Row> mds, bars, modes, settlements, ois;

  void onMarketDefinition(const MarketDefinition& m) override {
    Row r;
    r.type = "market_definition";
    r.market_id = m.MarketID;
    r.numerator = std::to_string(m.Numerator);
    r.denominator = std::to_string(m.Denominator);
    r.price_code = m.PriceCode;
    r.tick_value = m.TickValue.toString();
    r.vpt = m.VPTStr;
    r.min_cab_price = m.MinCabPrice ? m.MinCabPrice->toString() : "";
    mds.push_back(r);
  }
  void onBar(const Bar& b) override {
    Row r;
    r.type = "bar";
    r.market_id = b.MarketID;
    r.trade_date = fmtNdt(b.TradeDate);
    r.time = fmtNdt(b.Time);
    r.close_time = fmtNdt(b.CloseTime);
    r.open = b.OpenPrice.toString();
    r.high = b.HighPrice.toString();
    r.low = b.LowPrice.toString();
    r.close = b.ClosePrice.toString();
    r.volume = std::to_string(b.Volume);
    r.volume_at_bid = std::to_string(b.VolumeAtBid);
    r.volume_at_offer = std::to_string(b.VolumeAtOffer);
    r.trades = std::to_string(b.Trades);
    r.trades_at_bid = std::to_string(b.TradesAtBid);
    r.trades_at_offer = std::to_string(b.TradesAtOffer);
    bars.push_back(r);
  }
  void onModeChange(const std::string& mid, const NDateTime& td,
                    const NDateTime& t, MarketMode mode) override {
    Row r;
    r.type = "mode_change";
    r.market_id = mid;
    r.trade_date = fmtNdt(td);
    r.time = fmtNdt(t);
    r.mode = std::to_string(static_cast<int>(mode));
    modes.push_back(r);
  }
  void onSettlement(const std::string& mid, const NDateTime& td,
                    const NDateTime& t, const Price& p, bool held) override {
    Row r;
    r.type = "settlement";
    r.market_id = mid;
    r.trade_date = fmtNdt(td);
    r.time = fmtNdt(t);
    r.settlement_price = p.toString();
    r.held = held ? "true" : "false";
    settlements.push_back(r);
  }
  void onOpenInterest(const std::string& mid, const NDateTime& td,
                      const NDateTime& t, int oi) override {
    Row r;
    r.type = "open_interest";
    r.market_id = mid;
    r.trade_date = fmtNdt(td);
    r.time = fmtNdt(t);
    r.open_interest = std::to_string(oi);
    ois.push_back(r);
  }
};

const char* kHeader =
    "type,market_id,trade_date,time,close_time,open,high,low,close,volume,"
    "volume_at_bid,volume_at_offer,trades,trades_at_bid,trades_at_offer,"
    "numerator,denominator,price_code,tick_value,vpt,min_cab_price,mode,"
    "settlement_price,held,open_interest";

std::vector<std::string> readLines(const std::string& path, bool& ok) {
  std::ifstream f(path, std::ios::binary);
  ok = f.good();
  std::vector<std::string> lines;
  std::string line;
  std::ostringstream ss;
  ss << f.rdbuf();
  std::string content = ss.str();
  std::string cur;
  for (char c : content) {
    if (c == '\n') {
      while (!cur.empty() && (cur.back() == '\r')) cur.pop_back();
      lines.push_back(cur);
      cur.clear();
    } else {
      cur += c;
    }
  }
  if (!cur.empty()) {
    while (!cur.empty() && cur.back() == '\r') cur.pop_back();
    lines.push_back(cur);
  }
  return lines;
}

std::vector<std::uint8_t> readBytes(const std::string& path, bool& ok) {
  std::ifstream f(path, std::ios::binary);
  ok = f.good();
  return std::vector<std::uint8_t>((std::istreambuf_iterator<char>(f)),
                                   std::istreambuf_iterator<char>());
}

}  // namespace

T4_TEST(aggr_golden_fixture_parity) {
  const std::string dir = T4_FIXTURE_DIR;
  bool ok = false;
  auto data = readBytes(dir + "/sample.bin", ok);
  CHECK_MSG(ok && !data.empty(), "could not read sample.bin");
  if (!ok || data.empty()) return;

  Recorder rec;
  ChartDataStreamReaderAggr::read(data, rec);

  // Build rows in handler_to_rows order: defs, bars, modes, settlements, ois.
  std::vector<std::string> got;
  got.push_back(kHeader);
  for (auto& r : rec.mds) got.push_back(r.join());
  for (auto& r : rec.bars) got.push_back(r.join());
  for (auto& r : rec.modes) got.push_back(r.join());
  for (auto& r : rec.settlements) got.push_back(r.join());
  for (auto& r : rec.ois) got.push_back(r.join());

  bool okExp = false;
  auto expected = readLines(dir + "/sample_expected.csv", okExp);
  CHECK_MSG(okExp, "could not read sample_expected.csv");

  CHECK_MSG(got.size() == expected.size(),
            "row count mismatch: got " + std::to_string(got.size()) +
                " expected " + std::to_string(expected.size()));
  std::size_t n = got.size() < expected.size() ? got.size() : expected.size();
  for (std::size_t i = 0; i < n; ++i) {
    CHECK_MSG(got[i] == expected[i],
              "line " + std::to_string(i) + "\n   got: " + got[i] +
                  "\n   exp: " + expected[i]);
  }
}
