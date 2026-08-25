"""Port of ``com.t4login.util.EncodingUtil``.

Provides variable-length 7-bit encoding/decoding for integers, longs, and
decimals, mirroring the Java implementation byte-for-byte.

Encoding scheme (7-bit variable-length integer):
- Each byte uses 7 bits for data and the MSB as a continuation flag.
- If the MSB is set (0x80), more bytes follow; if clear, it's the last byte.
- Positive values encode in 1-5 bytes (int) or 1-9 bytes (long).
- Negative values always use the maximum size (5 bytes for int, 10 for long)
  to preserve two's complement sign semantics from Java's arithmetic right-shift.

Decimal encoding:
- A 96-bit unscaled integer is split into three 32-bit chunks (low, mid, high)
  plus a 4th chunk encoding the scale and sign.
- A 1-byte header uses 2 bits per chunk to indicate zero/positive/negative/MIN.
- Non-zero chunks are then 7-bit-encoded with their absolute values.
"""

from __future__ import annotations

import struct
from decimal import ROUND_HALF_EVEN, Decimal
from io import BytesIO
from typing import BinaryIO, TYPE_CHECKING

if TYPE_CHECKING:
    from t4login.definitions.priceconversion.price import Price

# Java int/long boundaries
_INT32_MIN = -(1 << 31)
_INT32_MAX = (1 << 31) - 1
_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MASK = 0xFFFF_FFFF
_UINT64_MASK = 0xFFFF_FFFF_FFFF_FFFF


# ---------------------------------------------------------------------------
# 7-bit integer encoding (mirrors Java's signed 32-bit behavior)
# ---------------------------------------------------------------------------


def encode_7bit_int(value: int) -> bytes:
    """Encode a signed 32-bit integer using variable-length 7-bit encoding.

    Positive values use 1–5 bytes (variable). Negative values always use 5 bytes
    (matching Java's arithmetic-shift behavior).
    """
    # Mask to 32-bit two's complement
    value = value & _UINT32_MASK

    if value <= _INT32_MAX:
        # Positive path: variable length
        buf = bytearray()
        while value >= 0x80:
            buf.append((value & 0xFF) | 0x80)
            value >>= 7
        buf.append(value & 0xFF)
        return bytes(buf)
    else:
        # Negative path (bit 31 set): fixed 5 bytes using arithmetic shift
        # Simulate Java's signed >> on 32-bit int
        sval = value if value < (1 << 31) else value - (1 << 32)
        buf = bytearray(5)
        buf[0] = (sval & 0xFF) | 0x80
        sval >>= 7
        buf[1] = (sval & 0xFF) | 0x80
        sval >>= 7
        buf[2] = (sval & 0xFF) | 0x80
        sval >>= 7
        buf[3] = (sval & 0xFF) | 0x80
        sval >>= 7
        buf[4] = sval & 0x0F
        return bytes(buf)


def encode_7bit_int_to_stream(value: int, out: BinaryIO) -> None:
    """Encode a signed 32-bit integer directly to a stream."""
    out.write(encode_7bit_int(value))


def decode_7bit_int(stream: BinaryIO) -> int:
    """Decode a 7-bit encoded signed 32-bit integer from a stream."""
    count = 0
    shift = 0

    while True:
        b = stream.read(1)
        if not b:
            raise EOFError("Unexpected end of stream in decode_7bit_int")
        byte_val = b[0]
        count |= (byte_val & 0x7F) << shift
        shift += 7
        if (byte_val & 0x80) == 0:
            break

    # Sign-extend from 32-bit two's complement
    if count >= (1 << 31):
        count -= 1 << 32
    return count


def decode_7bit_int_from_bytes(data: bytes) -> int:
    """Decode a 7-bit encoded integer from a byte sequence."""
    return decode_7bit_int(BytesIO(data))


# ---------------------------------------------------------------------------
# 7-bit long encoding (mirrors Java's signed 64-bit behavior)
# ---------------------------------------------------------------------------


def encode_7bit_long(value: int) -> bytes:
    """Encode a signed 64-bit integer using variable-length 7-bit encoding.

    Positive values use 1–9 bytes (variable). Negative values always use 10 bytes.
    """
    # Mask to 64-bit two's complement
    value = value & _UINT64_MASK

    if value <= _INT64_MAX:
        # Positive path: variable length
        buf = bytearray()
        while value >= 0x80:
            buf.append((value & 0xFF) | 0x80)
            value >>= 7
        buf.append(value & 0xFF)
        return bytes(buf)
    else:
        # Negative path (bit 63 set): fixed 10 bytes
        sval = value if value < (1 << 63) else value - (1 << 64)
        buf = bytearray(10)
        for i in range(9):
            buf[i] = (sval & 0xFF) | 0x80
            sval >>= 7
        buf[9] = sval & 0x0F
        return bytes(buf)


def encode_7bit_long_to_stream(value: int, out: BinaryIO) -> None:
    """Encode a signed 64-bit integer directly to a stream."""
    out.write(encode_7bit_long(value))


def decode_7bit_long(stream: BinaryIO) -> int:
    """Decode a 7-bit encoded signed 64-bit integer from a stream."""
    count = 0
    shift = 0

    while True:
        b = stream.read(1)
        if not b:
            raise EOFError("Unexpected end of stream in decode_7bit_long")
        byte_val = b[0]
        count |= (byte_val & 0x7F) << shift
        shift += 7
        if (byte_val & 0x80) == 0:
            break

    # Mask to 64 bits (Python ints are arbitrary precision; Java truncates on shift)
    count = count & _UINT64_MASK
    # Sign-extend from 64-bit two's complement
    if count >= (1 << 63):
        count -= 1 << 64
    return count


def decode_7bit_long_from_bytes(data: bytes) -> int:
    """Decode a 7-bit encoded long from a byte sequence."""
    return decode_7bit_long(BytesIO(data))


# ---------------------------------------------------------------------------
# Decimal encoding (mirrors Java's BigDecimal 96-bit split)
# ---------------------------------------------------------------------------

_INT32_MIN_VALUE = -(1 << 31)  # -2147483648


def encode_decimal(value: Decimal) -> bytes:
    """Encode a Decimal using the T4 binary format (header + 7-bit encoded chunks)."""
    out = BytesIO()
    encode_decimal_to_stream(value, out)
    return out.getvalue()


def encode_decimal_to_stream(value: Decimal, out: BinaryIO) -> None:
    """Encode a Decimal directly to a stream."""
    sign, digits, exponent = value.as_tuple()
    scale = -exponent if exponent < 0 else 0

    # Reconstruct unscaled value as positive integer (apply positive exponent as a left shift)
    unscaled = int("".join(str(d) for d in digits)) if digits else 0
    if exponent > 0:
        unscaled *= 10**exponent

    # Split into three 32-bit chunks (little-endian order: low, mid, high)
    price_bits = [0, 0, 0, 0]
    price_bits[0] = unscaled & _UINT32_MASK
    price_bits[1] = (unscaled >> 32) & _UINT32_MASK
    price_bits[2] = (unscaled >> 64) & _UINT32_MASK

    # priceBits[3] = scale << 16 | sign flag
    price_bits[3] = scale << 16
    if sign == 1:  # negative
        price_bits[3] = price_bits[3] | 0x8000_0000

    # Interpret as signed int32 for header classification
    def _as_signed32(v: int) -> int:
        v = v & _UINT32_MASK
        return v if v < (1 << 31) else v - (1 << 32)

    signed_bits = [_as_signed32(b) for b in price_bits]

    # Build header byte (2 bits per chunk)
    hdr = 0
    for i, (mask_hi, mask_lo) in enumerate([(0xC0, 6), (0x30, 4), (0x0C, 2), (0x03, 0)]):
        sv = signed_bits[i]
        if sv == _INT32_MIN_VALUE:
            bits = 0x03  # MIN_VALUE marker
        elif sv < 0:
            bits = 0x02  # negative
        elif sv > 0:
            bits = 0x01  # positive
        else:
            bits = 0x00  # zero
        hdr |= bits << mask_lo

    out.write(struct.pack("B", hdr))

    # Write non-zero, non-MIN_VALUE chunks as 7-bit encoded absolute values
    for i in range(4):
        sv = signed_bits[i]
        if sv != 0 and sv != _INT32_MIN_VALUE:
            encode_7bit_int_to_stream(abs(sv), out)


def decode_decimal(stream: BinaryIO) -> Decimal:
    """Decode a T4 binary-encoded Decimal from a stream."""
    hdr_bytes = stream.read(1)
    if not hdr_bytes:
        raise EOFError("Unexpected end of stream in decode_decimal")
    hdr = hdr_bytes[0]

    price_bits = [0, 0, 0, 0]

    # Chunk 0: bits 7-6
    tag0 = hdr & 0xC0
    if tag0 == 0xC0:
        price_bits[0] = _INT32_MIN_VALUE
    elif tag0 == 0x80:
        price_bits[0] = -1 * decode_7bit_int(stream)
    elif tag0 == 0x40:
        price_bits[0] = decode_7bit_int(stream)

    # Chunk 1: bits 5-4
    tag1 = hdr & 0x30
    if tag1 == 0x30:
        price_bits[1] = _INT32_MIN_VALUE
    elif tag1 == 0x20:
        price_bits[1] = -1 * decode_7bit_int(stream)
    elif tag1 == 0x10:
        price_bits[1] = decode_7bit_int(stream)

    # Chunk 2: bits 3-2
    tag2 = hdr & 0x0C
    if tag2 == 0x0C:
        price_bits[2] = _INT32_MIN_VALUE
    elif tag2 == 0x08:
        price_bits[2] = -1 * decode_7bit_int(stream)
    elif tag2 == 0x04:
        price_bits[2] = decode_7bit_int(stream)

    # Chunk 3: bits 1-0
    tag3 = hdr & 0x03
    if tag3 == 0x03:
        price_bits[3] = _INT32_MIN_VALUE
    elif tag3 == 0x02:
        price_bits[3] = -1 * decode_7bit_int(stream)
    elif tag3 == 0x01:
        price_bits[3] = decode_7bit_int(stream)

    # Reconstruct 96-bit unscaled integer from three unsigned 32-bit chunks
    int2 = (price_bits[2] & _UINT32_MASK) << 32
    int1 = (int2 + (price_bits[1] & _UINT32_MASK)) << 32
    integer = int1 + (price_bits[0] & _UINT32_MASK)

    # Extract scale from chunk 3 (bits 16-23)
    scale = (price_bits[3] & 0xFF0000) >> 16

    # Build decimal
    result = Decimal(integer) / Decimal(10 ** scale) if scale > 0 else Decimal(integer)

    # Negate if bit 31 of priceBits[3] is set
    if price_bits[3] < 0:  # signed interpretation — bit 31 set means negative
        result = -result

    return result


def decode_decimal_from_bytes(data: bytes) -> Decimal:
    """Decode a T4 binary-encoded Decimal from a byte sequence."""
    return decode_decimal(BytesIO(data))


# ---------------------------------------------------------------------------
# Price decoding helpers
# ---------------------------------------------------------------------------


def decode_price(stream: BinaryIO) -> "Price":
    """Decode a Price from a stream (wraps decode_decimal in a Price object)."""
    from t4login.definitions.priceconversion.price import Price

    return Price(decode_decimal(stream))


def decode_price_n(stream: BinaryIO) -> "Price | None":
    """Decode a nullable Price from a stream.

    Reads 1 header byte; returns None if bit 0 is clear, otherwise decodes
    the decimal and quantizes to scale 18 with HALF_EVEN rounding.
    """
    from t4login.definitions.priceconversion.price import Price, Scale

    hdr_bytes = stream.read(1)
    if not hdr_bytes:
        raise EOFError("Unexpected end of stream in decode_price_n")
    hdr = hdr_bytes[0]

    if (hdr & 0x01) == 0x01:
        dec = decode_decimal(stream)
        quantum = Decimal(10) ** -Scale
        dec = dec.quantize(quantum, rounding=ROUND_HALF_EVEN)
        return Price(dec)
    else:
        return None
