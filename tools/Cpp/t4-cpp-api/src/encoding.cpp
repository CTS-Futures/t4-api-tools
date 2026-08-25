#include "t4decoder/encoding.hpp"

#include <cstdint>

namespace t4 {

namespace {
constexpr std::int32_t kInt32Min = INT32_MIN;  // 0x80000000 sentinel
constexpr std::uint64_t kTwo32 = 4294967296ull;
}  // namespace

std::int32_t decode7BitInt(InputStream& in) {
  // Reconstruct in unsigned space (matches Java's int wrap), then reinterpret.
  std::uint32_t count = 0;
  int shift = 0;
  std::uint8_t b;
  do {
    b = in.readByte();
    count |= static_cast<std::uint32_t>(b & 0x7F) << shift;
    shift += 7;
  } while ((b & 0x80) != 0);
  return static_cast<std::int32_t>(count);
}

std::int64_t decode7BitLong(InputStream& in) {
  std::uint64_t count = 0;
  int shift = 0;
  std::uint8_t b;
  do {
    b = in.readByte();
    count |= static_cast<std::uint64_t>(b & 0x7F) << shift;
    shift += 7;
  } while ((b & 0x80) != 0);
  return static_cast<std::int64_t>(count);
}

std::vector<std::uint8_t> encode7BitInt(std::int32_t value) {
  std::vector<std::uint8_t> out;
  if (value >= 0) {
    std::uint32_t v = static_cast<std::uint32_t>(value);
    while (v >= 0x80) {
      out.push_back(static_cast<std::uint8_t>(v | 0x80));
      v >>= 7;
    }
    out.push_back(static_cast<std::uint8_t>(v));
  } else {
    // Fixed 5 bytes, arithmetic right shift (sign-preserving) like Java `>>`.
    std::int32_t v = value;
    for (int i = 0; i < 4; ++i) {
      out.push_back(static_cast<std::uint8_t>(v | 0x80));
      v >>= 7;
    }
    out.push_back(static_cast<std::uint8_t>(v & 0x0F));
  }
  return out;
}

std::vector<std::uint8_t> encode7BitLong(std::int64_t value) {
  std::vector<std::uint8_t> out;
  if (value >= 0) {
    std::uint64_t v = static_cast<std::uint64_t>(value);
    while (v >= 0x80) {
      out.push_back(static_cast<std::uint8_t>(v | 0x80));
      v >>= 7;
    }
    out.push_back(static_cast<std::uint8_t>(v));
  } else {
    std::int64_t v = value;
    for (int i = 0; i < 9; ++i) {
      out.push_back(static_cast<std::uint8_t>(v | 0x80));
      v >>= 7;
    }
    out.push_back(static_cast<std::uint8_t>(v & 0x0F));
  }
  return out;
}

Decimal decodeDecimal(InputStream& in) {
  std::uint8_t hdr = in.readByte();

  auto decodeChunk = [&in](int tag2) -> std::int32_t {
    if (tag2 == 0x03) return kInt32Min;
    if (tag2 == 0x02) return -decode7BitInt(in);
    if (tag2 == 0x01) return decode7BitInt(in);
    return 0;
  };

  std::int32_t b0 = decodeChunk((hdr & 0xC0) >> 6);
  std::int32_t b1 = decodeChunk((hdr & 0x30) >> 4);
  std::int32_t b2 = decodeChunk((hdr & 0x0C) >> 2);
  std::int32_t b3 = decodeChunk(hdr & 0x03);

  // 96-bit unsigned magnitude from the three low chunks (little-endian).
  BigInt two32 = BigInt::fromU64(kTwo32);
  BigInt two64 = two32.mul(two32);
  BigInt mag = BigInt::fromU64(static_cast<std::uint32_t>(b2)).mul(two64)
                   .add(BigInt::fromU64(static_cast<std::uint32_t>(b1)).mul(two32))
                   .add(BigInt::fromU64(static_cast<std::uint32_t>(b0)));

  int scale = (b3 & 0x00FF0000) >> 16;
  if (b3 < 0) mag = mag.negated();  // bit 31 of chunk 3 => negative
  // Normalize like Python's `Decimal(unscaled) / 10^scale` (drops trailing
  // zeros) so values such as tick_value render minimally (12.5, not 12.500…).
  return Decimal(std::move(mag), scale).stripTrailingZeros();
}

std::vector<std::uint8_t> encodeDecimal(const Decimal& value) {
  // Decompose into sign, |unscaled|, scale, then emit the 4-chunk header form.
  std::int32_t priceBits[4];

  // chunk 3: scale in bits 16.. plus sign bit 31.
  std::uint32_t bits3 = static_cast<std::uint32_t>(value.scale()) << 16;
  if (value.sign() < 0) bits3 |= 0x80000000u;
  priceBits[3] = static_cast<std::int32_t>(bits3);

  // chunks 0..2: low 96 bits of |unscaled|, extracted as 32-bit limbs.
  BigInt mag = value.unscaled().abs();
  std::uint64_t r0, r1, r2;
  BigInt q1 = mag.divModScalar(kTwo32, r0);
  BigInt q2 = q1.divModScalar(kTwo32, r1);
  q2.divModScalar(kTwo32, r2);
  priceBits[0] = static_cast<std::int32_t>(static_cast<std::uint32_t>(r0));
  priceBits[1] = static_cast<std::int32_t>(static_cast<std::uint32_t>(r1));
  priceBits[2] = static_cast<std::int32_t>(static_cast<std::uint32_t>(r2));

  auto tag = [](std::int32_t v) -> int {
    if (v == kInt32Min) return 0x03;
    if (v < 0) return 0x02;
    if (v > 0) return 0x01;
    return 0x00;
  };

  std::uint8_t hdr = static_cast<std::uint8_t>(
      (tag(priceBits[0]) << 6) | (tag(priceBits[1]) << 4) |
      (tag(priceBits[2]) << 2) | tag(priceBits[3]));

  std::vector<std::uint8_t> out;
  out.push_back(hdr);
  for (int i = 0; i < 4; ++i) {
    std::int32_t v = priceBits[i];
    if (v != 0 && v != kInt32Min) {
      // |v| as a positive int32 (v == kInt32Min already excluded).
      std::int32_t absv = v < 0 ? static_cast<std::int32_t>(0u -
                                       static_cast<std::uint32_t>(v))
                                : v;
      auto enc = encode7BitInt(absv);
      out.insert(out.end(), enc.begin(), enc.end());
    }
  }
  return out;
}

}  // namespace t4
