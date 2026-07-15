#include "t4decoder/payload.hpp"

#include <array>
#include <stdexcept>
#include <string>

namespace t4 {

namespace {
// SOF record signatures: length, tag=CTAG_SOF(1), version=1 (LE int32).
// Aggregated (T4BinAggr): record length 5.
constexpr std::array<std::uint8_t, 6> kAggrSof = {0x05, 0x01, 0x01, 0x00, 0x00, 0x00};
// Non-aggregated (T4Bin): record length 13.
constexpr std::array<std::uint8_t, 6> kBinSof = {0x0d, 0x01, 0x01, 0x00, 0x00, 0x00};

// First index of needle in haystack, or -1.
long indexOf(const std::vector<std::uint8_t>& hay,
             const std::array<std::uint8_t, 6>& need) {
  if (hay.size() < need.size()) return -1;
  for (std::size_t i = 0; i + need.size() <= hay.size(); ++i) {
    bool match = true;
    for (std::size_t j = 0; j < need.size(); ++j) {
      if (hay[i + j] != need[j]) {
        match = false;
        break;
      }
    }
    if (match) return static_cast<long>(i);
  }
  return -1;
}
}  // namespace

std::vector<std::uint8_t> extractT4BinPayload(
    const std::vector<std::uint8_t>& content) {
  if (content.empty()) return content;

  long aggrIdx = indexOf(content, kAggrSof);
  long binIdx = indexOf(content, kBinSof);

  long start = -1;
  if (aggrIdx >= 0) start = aggrIdx;
  if (binIdx >= 0 && (start < 0 || binIdx < start)) start = binIdx;

  if (start < 0) {
    throw std::runtime_error(
        "No T4Bin SOF signature found in " + std::to_string(content.size()) +
        "-byte response payload. The server may have returned an error body "
        "or an unrecognised format.");
  }
  return std::vector<std::uint8_t>(content.begin() + start, content.end());
}

}  // namespace t4
