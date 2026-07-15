#include "t4decoder/message_reader.hpp"

#include <cstring>

#include "t4decoder/encoding.hpp"

namespace t4 {

namespace {
// Assemble n little-endian bytes into an unsigned value.
std::uint64_t readLE(InputStream& in, int n) {
  auto bytes = in.readExact(static_cast<std::size_t>(n));
  std::uint64_t v = 0;
  for (int i = n - 1; i >= 0; --i) v = (v << 8) | bytes[static_cast<std::size_t>(i)];
  return v;
}
}  // namespace

std::int32_t readInteger(InputStream& in) {
  return static_cast<std::int32_t>(static_cast<std::uint32_t>(readLE(in, 4)));
}

std::int64_t readLong(InputStream& in) {
  return static_cast<std::int64_t>(readLE(in, 8));
}

double readDouble(InputStream& in) {
  std::uint64_t bits = readLE(in, 8);
  double d;
  std::memcpy(&d, &bits, sizeof(d));  // host is little-endian (x86/ARM)
  return d;
}

bool readBoolean(InputStream& in) { return in.readByte() != 0; }

std::string readString(InputStream& in) {
  std::int32_t length = decode7BitInt(in);
  if (length <= 0) return std::string();
  auto bytes = in.readExact(static_cast<std::size_t>(length));
  return std::string(bytes.begin(), bytes.end());
}

std::string readShortString(InputStream& in) {
  std::uint8_t length = in.readByte();
  if (length == 0) return std::string();
  auto bytes = in.readExact(length);
  return std::string(bytes.begin(), bytes.end());
}

NDateTime readDatetime(InputStream& in) { return NDateTime(readLong(in)); }

NDateTime read7BitDatetime(InputStream& in) {
  return NDateTime(decode7BitLong(in));
}

NDateTime read7BitDatetimeDelta(InputStream& in, const NDateTime& ref) {
  return NDateTime(decode7BitLong(in) + ref.ticks());
}

std::optional<Price> readPrice(InputStream& in) {
  std::string s = readShortString(in);
  if (s.empty()) return std::nullopt;
  return Price(Decimal::fromString(s));
}

Price decodePrice(InputStream& in) { return Price(decodeDecimal(in)); }

std::optional<Price> decodePriceN(InputStream& in) {
  std::uint8_t hdr = in.readByte();
  if ((hdr & 0x01) == 0x01) return Price(decodeDecimal(in));
  return std::nullopt;
}

}  // namespace t4
