// Port of ChartClient (JS: client/ChartClient.js, Python: client/chart_client.py).
//
// HTTP client for the T4 Chart API. Fetches the barchart / tradehistory binary
// streams and feeds them to the decoders. Built on libcurl (the JS/Python
// originals use fetch/httpx; cpp-httplib was the plan's first choice but isn't
// packaged for MSYS2, and libcurl is the de-facto standard and already
// available). Compiled only when -DT4DECODER_BUILD_CLIENT=ON.
#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "t4decoder/chart_data_stream_reader.hpp"
#include "t4decoder/chart_data_stream_reader_aggr.hpp"
#include "t4decoder/enums.hpp"

namespace t4 {

struct BarchartParams {
  std::string exchangeId;
  std::string contractId;
  std::string chartType = "Bar";
  std::string barInterval = "Minute";
  int barPeriod = 1;
  std::string tradeDateStart;
  std::string tradeDateEnd;
  std::optional<std::string> marketId;
  std::optional<std::string> continuationType;
  std::optional<std::string> resetInterval;
};

struct TradehistoryParams {
  std::string exchangeId;
  std::string contractId;
  std::optional<std::string> marketId;
  std::optional<std::string> tradeDateStart;
  std::optional<std::string> tradeDateEnd;
  std::optional<std::string> start;
  std::optional<std::string> end;
  std::optional<std::string> since;
};

class ChartClient {
public:
  explicit ChartClient(std::string token,
                       std::string baseUrl = "https://api-sim.t4login.com/chart");

  // --- Binary endpoints ---
  // Fetch barchart binary and dispatch decoded records to handler.
  void getBarchartBinary(const BarchartParams& params, AggrHandler& handler);
  // Fetch tradehistory binary; iterate the returned reader via read().
  std::unique_ptr<ChartDataStreamReader> getTradehistoryBinary(
      const TradehistoryParams& params,
      ChartDataType dataType = ChartDataType::Tick);

  // --- JSON endpoints (raw response body; no JSON parsing dependency) ---
  std::string getBarchartJson(const BarchartParams& params);
  std::string getTradehistoryJson(const TradehistoryParams& params);

private:
  // GET baseUrl+path?params with Authorization/Accept headers; returns body
  // bytes. Throws std::runtime_error on transport error or non-200 status.
  std::vector<std::uint8_t> get(const std::string& path,
                                const std::map<std::string, std::string>& params,
                                const std::string& accept);
  static std::map<std::string, std::string> barchartQuery(const BarchartParams&);
  static std::map<std::string, std::string> tradehistoryQuery(const TradehistoryParams&);

  std::string token_;
  std::string baseUrl_;  // trailing slashes stripped
};

}  // namespace t4
