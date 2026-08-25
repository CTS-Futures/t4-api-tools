// Port of com.t4login.util.EncodingUtil (JS: src/util/encoding.js,
// Python: t4login/util/encoding.py).
//
// Variable-length 7-bit codec for signed 32/64-bit integers, plus the 96-bit
// unscaled-decimal format. Sign semantics mirror the Java/C# original
// byte-for-byte:
//   - positive ints  -> 1..5 bytes
//   - negative ints  -> always 5 bytes (final byte masked & 0x0F)
//   - positive longs -> 1..9 bytes
//   - negative longs -> always 10 bytes
#pragma once

#include <cstdint>
#include <vector>

#include "t4decoder/byte_stream.hpp"
#include "t4decoder/decimal.hpp"

namespace t4 {

std::int32_t decode7BitInt(InputStream& in);
std::int64_t decode7BitLong(InputStream& in);
std::vector<std::uint8_t> encode7BitInt(std::int32_t value);
std::vector<std::uint8_t> encode7BitLong(std::int64_t value);

// 96-bit unscaled decimal: 1 header byte (2 bits per 32-bit chunk) followed by
// up to four 7-bit-encoded magnitudes.
Decimal decodeDecimal(InputStream& in);
std::vector<std::uint8_t> encodeDecimal(const Decimal& value);

}  // namespace t4
