// t4decoder_fetch — exercise the HTTP ChartClient against a URL.
//
//   t4decoder_fetch <baseUrl> <token> [exchangeId contractId tradeDateStart tradeDateEnd]
//
// Used for the local-loopback HTTP test (a Node server serving sample.bin) and
// usable against the live sim API with a real token. Built only with
// -DT4DECODER_BUILD_CLIENT=ON.
#include <iostream>
#include <string>

#include "t4decoder/chart_client.hpp"

using namespace t4;

namespace {
struct CountingHandler : AggrHandler {
  int marketDefs = 0, bars = 0, modes = 0, settlements = 0, ois = 0;
  bool haveFirst = false;
  Bar first;
  void onMarketDefinition(const MarketDefinition&) override { ++marketDefs; }
  void onBar(const Bar& b) override {
    if (!haveFirst) { first = b; haveFirst = true; }
    ++bars;
  }
  void onModeChange(const std::string&, const NDateTime&, const NDateTime&,
                    MarketMode) override { ++modes; }
  void onSettlement(const std::string&, const NDateTime&, const NDateTime&,
                    const Price&, bool) override { ++settlements; }
  void onOpenInterest(const std::string&, const NDateTime&, const NDateTime&,
                      int) override { ++ois; }
};
}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cerr << "usage: t4decoder_fetch <baseUrl> <token> "
                 "[exchangeId contractId tradeDateStart tradeDateEnd marketId barInterval]\n";
    return 2;
  }
  std::string baseUrl = argv[1];
  std::string token = argv[2];

  BarchartParams p;
  p.exchangeId = argc > 3 ? argv[3] : "CME_E";
  p.contractId = argc > 4 ? argv[4] : "YM";
  p.tradeDateStart = argc > 5 ? argv[5] : "2025-06-01";
  p.tradeDateEnd = argc > 6 ? argv[6] : "2025-06-02";
  if (argc > 7) p.marketId = std::string(argv[7]);
  p.barInterval = argc > 8 ? argv[8] : "Day";

  try {
    ChartClient client(token, baseUrl);
    CountingHandler h;
    client.getBarchartBinary(p, h);
    std::cout << "OK marketDefs=" << h.marketDefs << " bars=" << h.bars
              << " modes=" << h.modes << " settlements=" << h.settlements
              << " openInterests=" << h.ois << "\n";
    if (h.haveFirst) {
      std::cout << "firstBar market=" << h.first.MarketID
                << " O=" << h.first.OpenPrice.toString()
                << " H=" << h.first.HighPrice.toString()
                << " L=" << h.first.LowPrice.toString()
                << " C=" << h.first.ClosePrice.toString()
                << " V=" << h.first.Volume << "\n";
    }
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "ERROR: " << e.what() << "\n";
    return 1;
  }
}
