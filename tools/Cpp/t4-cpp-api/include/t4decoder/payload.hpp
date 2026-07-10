// Port of ChartClient.extractT4BinPayload (JS/Python).
//
// HTTP chart responses may carry the binary stream after some preamble; this
// locates the embedded T4Bin/T4BinAggr payload by scanning for either SOF
// record signature and returns the slice from there. Pure, transport-free.
#pragma once

#include <cstdint>
#include <vector>

namespace t4 {

// Returns the payload starting at the first T4Bin or T4BinAggr SOF signature.
// Empty input returns empty. Throws std::runtime_error if a non-empty input
// contains no SOF signature (error body / unrecognised format).
std::vector<std::uint8_t> extractT4BinPayload(const std::vector<std::uint8_t>& content);

}  // namespace t4
