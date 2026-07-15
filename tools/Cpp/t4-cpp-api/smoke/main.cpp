// t4decoder_smoke — decode a T4 chart-data binary file and print it.
//
//   t4decoder_smoke aggr <file.bin>            (aggregated barchart -> CSV)
//   t4decoder_smoke tick <file.bin> [marketId] (tradehistory -> per-record lines)
//
// The `aggr` mode reproduces the CSV schema of the Python fixtures, so it can
// regenerate / diff against sample_expected.csv.
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include "t4decoder/chart_data_stream_reader.hpp"
#include "t4decoder/chart_data_stream_reader_aggr.hpp"

using namespace t4;

namespace {

std::vector<std::uint8_t> readFile(const std::string& path, bool& ok) {
  std::ifstream f(path, std::ios::binary);
  ok = f.good();
  return std::vector<std::uint8_t>((std::istreambuf_iterator<char>(f)),
                                   std::istreambuf_iterator<char>());
}

std::string fmtNdt(const NDateTime& dt) {
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%03d",
                dt.year(), dt.month(), dt.day(), dt.hour(), dt.minute(),
                dt.second(), dt.millisecond());
  return std::string(buf);
}

// Aggregated -> CSV (same 25 columns/order as the Python csv helper). Build a
// fixed 25-field row and comma-join, so column placement can't drift.
struct CsvHandler : AggrHandler {
  std::vector<std::string> mds, bars, modes, settlements, ois;

  // Column indices in CSV_COLUMNS order.
  enum {
    TYPE, MARKET_ID, TRADE_DATE, TIME, CLOSE_TIME, OPEN, HIGH, LOW, CLOSE,
    VOLUME, VOLUME_AT_BID, VOLUME_AT_OFFER, TRADES, TRADES_AT_BID,
    TRADES_AT_OFFER, NUMERATOR, DENOMINATOR, PRICE_CODE, TICK_VALUE, VPT,
    MIN_CAB_PRICE, MODE, SETTLEMENT_PRICE, HELD, OPEN_INTEREST, NCOLS
  };
  static std::string join(const std::vector<std::string>& f) {
    std::string s;
    for (std::size_t i = 0; i < f.size(); ++i) {
      if (i) s += ',';
      s += f[i];
    }
    return s;
  }

  void onMarketDefinition(const MarketDefinition& m) override {
    std::vector<std::string> f(NCOLS);
    f[TYPE] = "market_definition";
    f[MARKET_ID] = m.MarketID;
    f[NUMERATOR] = std::to_string(m.Numerator);
    f[DENOMINATOR] = std::to_string(m.Denominator);
    f[PRICE_CODE] = m.PriceCode;
    f[TICK_VALUE] = m.TickValue.toString();
    f[VPT] = m.VPTStr;
    f[MIN_CAB_PRICE] = m.MinCabPrice ? m.MinCabPrice->toString() : "";
    mds.push_back(join(f));
  }
  void onBar(const Bar& b) override {
    std::vector<std::string> f(NCOLS);
    f[TYPE] = "bar";
    f[MARKET_ID] = b.MarketID;
    f[TRADE_DATE] = fmtNdt(b.TradeDate);
    f[TIME] = fmtNdt(b.Time);
    f[CLOSE_TIME] = fmtNdt(b.CloseTime);
    f[OPEN] = b.OpenPrice.toString();
    f[HIGH] = b.HighPrice.toString();
    f[LOW] = b.LowPrice.toString();
    f[CLOSE] = b.ClosePrice.toString();
    f[VOLUME] = std::to_string(b.Volume);
    f[VOLUME_AT_BID] = std::to_string(b.VolumeAtBid);
    f[VOLUME_AT_OFFER] = std::to_string(b.VolumeAtOffer);
    f[TRADES] = std::to_string(b.Trades);
    f[TRADES_AT_BID] = std::to_string(b.TradesAtBid);
    f[TRADES_AT_OFFER] = std::to_string(b.TradesAtOffer);
    bars.push_back(join(f));
  }
  void onModeChange(const std::string& mid, const NDateTime& td,
                    const NDateTime& t, MarketMode mode) override {
    std::vector<std::string> f(NCOLS);
    f[TYPE] = "mode_change";
    f[MARKET_ID] = mid;
    f[TRADE_DATE] = fmtNdt(td);
    f[TIME] = fmtNdt(t);
    f[MODE] = std::to_string(static_cast<int>(mode));
    modes.push_back(join(f));
  }
  void onSettlement(const std::string& mid, const NDateTime& td,
                    const NDateTime& t, const Price& p, bool held) override {
    std::vector<std::string> f(NCOLS);
    f[TYPE] = "settlement";
    f[MARKET_ID] = mid;
    f[TRADE_DATE] = fmtNdt(td);
    f[TIME] = fmtNdt(t);
    f[SETTLEMENT_PRICE] = p.toString();
    f[HELD] = held ? "true" : "false";
    settlements.push_back(join(f));
  }
  void onOpenInterest(const std::string& mid, const NDateTime& td,
                      const NDateTime& t, int oi) override {
    std::vector<std::string> f(NCOLS);
    f[TYPE] = "open_interest";
    f[MARKET_ID] = mid;
    f[TRADE_DATE] = fmtNdt(td);
    f[TIME] = fmtNdt(t);
    f[OPEN_INTEREST] = std::to_string(oi);
    ois.push_back(join(f));
  }
};

const char* kHeader =
    "type,market_id,trade_date,time,close_time,open,high,low,close,volume,"
    "volume_at_bid,volume_at_offer,trades,trades_at_bid,trades_at_offer,"
    "numerator,denominator,price_code,tick_value,vpt,min_cab_price,mode,"
    "settlement_price,held,open_interest";

int runAggr(const std::vector<std::uint8_t>& data) {
  CsvHandler h;
  ChartDataStreamReaderAggr::read(data, h);
  std::cout << kHeader << "\n";
  for (auto& r : h.mds) std::cout << r << "\n";
  for (auto& r : h.bars) std::cout << r << "\n";
  for (auto& r : h.modes) std::cout << r << "\n";
  for (auto& r : h.settlements) std::cout << r << "\n";
  for (auto& r : h.ois) std::cout << r << "\n";
  return 0;
}

int runTick(std::vector<std::uint8_t> data, const std::string& marketId) {
  ChartDataStreamReader reader(std::move(data), NDateTime(0), marketId);
  long recs = 0;
  while (reader.read()) {
    const ChartDataState& s = reader.state();
    switch (s.Change) {
      case ChartDataChange::Trade:
        std::cout << "trade time_ticks=" << s.LastTimeTicks
                  << " price=" << s.LastTradePrice.toString()
                  << " vol=" << s.TradeVolume << "\n";
        break;
      case ChartDataChange::Quote:
        std::cout << "quote bid=" << s.BidPrice.toString()
                  << " offer=" << s.OfferPrice.toString()
                  << " bidvol=" << s.BidRealVolume
                  << " offervol=" << s.OfferRealVolume << "\n";
        break;
      case ChartDataChange::TradeBar:
        std::cout << "bar O=" << s.BarOpenPrice.toString()
                  << " H=" << s.BarHighPrice.toString()
                  << " L=" << s.BarLowPrice.toString()
                  << " C=" << s.BarClosePrice.toString()
                  << " V=" << s.BarVolume << "\n";
        break;
      case ChartDataChange::MarketDefinition:
        std::cout << "market_definition " << s.MarketID
                  << " num=" << s.Numerator << " den=" << s.Denominator << "\n";
        break;
      default:
        break;
    }
    ++recs;
  }
  std::cout << "(" << recs << " records)\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cerr << "usage: t4decoder_smoke <aggr|tick> <file.bin> [marketId]\n";
    return 2;
  }
  std::string mode = argv[1];
  bool ok = false;
  auto data = readFile(argv[2], ok);
  if (!ok) {
    std::cerr << "error: cannot read " << argv[2] << "\n";
    return 2;
  }
  if (mode == "aggr") return runAggr(data);
  if (mode == "tick")
    return runTick(std::move(data), argc > 3 ? argv[3] : std::string("DEFAULT"));
  std::cerr << "unknown mode: " << mode << " (expected aggr|tick)\n";
  return 2;
}
