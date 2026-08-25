// extractT4BinPayload: locate the embedded SOF in an HTTP chart response.
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "check.hpp"
#include "t4decoder/payload.hpp"

using namespace t4;

namespace {
using Bytes = std::vector<std::uint8_t>;
const Bytes kAggrSof = {0x05, 0x01, 0x01, 0x00, 0x00, 0x00};
const Bytes kBinSof = {0x0d, 0x01, 0x01, 0x00, 0x00, 0x00};
}  // namespace

T4_TEST(payload_empty_passthrough) {
  CHECK(extractT4BinPayload(Bytes{}).empty());
}

T4_TEST(payload_aggr_at_start) {
  Bytes in = kAggrSof;
  in.push_back(0xAB);
  CHECK_EQ(extractT4BinPayload(in), in);
}

T4_TEST(payload_strips_preamble) {
  Bytes in = {0xFF, 0xEE, 0xDD};  // junk preamble
  in.insert(in.end(), kBinSof.begin(), kBinSof.end());
  in.push_back(0x42);
  Bytes expected(in.begin() + 3, in.end());
  CHECK_EQ(extractT4BinPayload(in), expected);
}

T4_TEST(payload_picks_earliest_signature) {
  // Bin SOF appears before a later aggr SOF -> slice from the bin SOF.
  Bytes in = {0x00};
  in.insert(in.end(), kBinSof.begin(), kBinSof.end());
  in.insert(in.end(), kAggrSof.begin(), kAggrSof.end());
  Bytes expected(in.begin() + 1, in.end());
  CHECK_EQ(extractT4BinPayload(in), expected);
}

T4_TEST(payload_throws_without_signature) {
  bool threw = false;
  try {
    extractT4BinPayload(Bytes{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07});
  } catch (const std::runtime_error&) {
    threw = true;
  }
  CHECK(threw);
}
