// Port of com.t4login.definitions.chartdata.ChartDataStreamReaderAggr.
//
// Reads the aggregated chart format (T4BinAggr — /chart/barchart with
// Accept: application/octet-stream) and dispatches each record to a handler.
#pragma once

#include <cstdint>
#include <vector>

#include "t4decoder/byte_stream.hpp"
#include "t4decoder/chart_format_aggr.hpp"
#include "t4decoder/enums.hpp"
#include "t4decoder/n_date_time.hpp"
#include "t4decoder/price.hpp"

namespace t4 {

// Override the callbacks you care about; defaults are no-ops.
class AggrHandler {
public:
  virtual ~AggrHandler() = default;
  virtual void onMarketDefinition(const MarketDefinition&) {}
  virtual void onBar(const Bar&) {}
  virtual void onModeChange(const std::string& /*marketId*/,
                            const NDateTime& /*tradeDate*/,
                            const NDateTime& /*time*/, MarketMode /*mode*/) {}
  virtual void onSettlement(const std::string& /*marketId*/,
                            const NDateTime& /*tradeDate*/,
                            const NDateTime& /*time*/, const Price& /*price*/,
                            bool /*held*/) {}
  virtual void onOpenInterest(const std::string& /*marketId*/,
                              const NDateTime& /*tradeDate*/,
                              const NDateTime& /*time*/, int /*openInterest*/) {}
};

class ChartDataStreamReaderAggr {
public:
  static void read(const std::vector<std::uint8_t>& data, AggrHandler& handler);
  static void readStream(InputStream& reader, AggrHandler& handler);
};

}  // namespace t4
