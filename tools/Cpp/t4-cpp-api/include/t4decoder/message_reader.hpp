// Port of the static Message.read* helpers (JS: message/reader.js), mirroring
// .NET BinaryWriter conventions. Plus decodePrice / decodePriceN from
// EncodingUtil (kept here because they construct a Price).
#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "t4decoder/byte_stream.hpp"
#include "t4decoder/n_date_time.hpp"
#include "t4decoder/price.hpp"

namespace t4 {

std::int32_t readInteger(InputStream& in);   // 4-byte little-endian
std::int64_t readLong(InputStream& in);       // 8-byte little-endian
double readDouble(InputStream& in);            // 8-byte little-endian IEEE-754
bool readBoolean(InputStream& in);

std::string readString(InputStream& in);       // 7-bit length prefix + UTF-8
std::string readShortString(InputStream& in);  // 1-byte length prefix + UTF-8

NDateTime readDatetime(InputStream& in);        // 8-byte tick long
NDateTime read7BitDatetime(InputStream& in);    // 7-bit tick long
NDateTime read7BitDatetimeDelta(InputStream& in, const NDateTime& ref);

// Short-string price; nullopt when the string is empty.
std::optional<Price> readPrice(InputStream& in);
// 96-bit decimal -> Price.
Price decodePrice(InputStream& in);
// Header byte; if bit 0 set, decode a decimal Price, else nullopt.
std::optional<Price> decodePriceN(InputStream& in);

}  // namespace t4
