// Port of com.t4login.definitions.chartdata.ChartDataStreamReader.
//
// Reads non-aggregated chart data (T4Bin format — /chart/tradehistory with
// Accept: application/octet-stream). Each read() consumes one record and
// mutates the public state(). Mirrors the Java/JS dispatch tag-for-tag,
// including the absolute-time threshold, ALT order-volume abs(), and
// multi-market state switching.
#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "t4decoder/byte_stream.hpp"
#include "t4decoder/chart_data_state.hpp"
#include "t4decoder/chart_format.hpp"
#include "t4decoder/enums.hpp"
#include "t4decoder/n_date_time.hpp"

namespace t4 {

class ChartDataStreamReader {
public:
  // Any 7-bit "delta time" greater than this is an absolute tick value rather
  // than a delta (numerically ~ year 1900).
  static constexpr long long kAbsoluteTimeThreshold = 599266080000000000LL;

  ChartDataStreamReader(std::vector<std::uint8_t> data, NDateTime tradeDate,
                        std::string marketId,
                        ChartDataType dataType = ChartDataType::Tick);

  // Holds self-referential pointers (ByteReader -> data_, cin_ -> byteReader_),
  // so it must never be copied or moved. Heap-allocate (e.g. unique_ptr) if a
  // stable handle is needed.
  ChartDataStreamReader(const ChartDataStreamReader&) = delete;
  ChartDataStreamReader& operator=(const ChartDataStreamReader&) = delete;
  ChartDataStreamReader(ChartDataStreamReader&&) = delete;
  ChartDataStreamReader& operator=(ChartDataStreamReader&&) = delete;

  ChartDataState& state() { return *state_; }
  bool read() { return readT4Bin(); }
  void close() { in_ = nullptr; }

  static long long getIncrementalTime(long long baseTicks, long long ticks) {
    return ticks > kAbsoluteTimeThreshold ? ticks : baseTicks + ticks;
  }

private:
  bool readT4Bin();
  void readTradeAttrs();
  void readOrderVolumes();
  void readBarVolumes();
  void readTpo(bool isOpening, bool isClosing);
  void readTpoPrice(bool isOpening, bool isClosing);
  ChartDataState* getMarketState(const std::string& marketId);
  bool incrementTimeTicks(long long ticks);

  std::vector<std::uint8_t> data_;
  ByteReader byteReader_;
  CountingInputStream cin_;
  CountingInputStream* in_;  // nullptr when closed
  ChartDataType dataType_;
  std::map<std::string, std::shared_ptr<ChartDataState>> marketStates_;
  std::map<int, std::string> marketKeys_;
  bool isConsolidated_ = false;
  bool eof_ = false;
  int binVersion_ = CVAL_T4BIN_VERSION;
  std::shared_ptr<ChartDataState> state_;
};

}  // namespace t4
