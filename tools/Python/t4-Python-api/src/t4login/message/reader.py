"""Port of the ``Message.read*`` static methods from ``com.t4login.messages.Message``.

Module-level functions for reading typed values from a binary stream in the T4
wire format (.NET BinaryWriter compatible encoding).

These functions are the building blocks used by the chart data stream readers to
extract individual fields from each binary record. The encoding conventions match
.NET's BinaryWriter:
- Integers/longs: fixed-width little-endian.
- Strings: 7-bit-length-prefixed UTF-8 (or 1-byte-length for short strings).
- DateTimes: 8-byte ticks (100-ns units since 0001-01-01), or 7-bit encoded.
- Prices: short-string-encoded decimal, or 7-bit-encoded with header byte.
"""

from __future__ import annotations

import struct
from decimal import ROUND_HALF_EVEN, Decimal
from typing import BinaryIO

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.priceconversion.price import Price, Scale
from t4login.util.encoding import decode_7bit_int, decode_7bit_long


def _read_exact(stream: BinaryIO, n: int) -> bytes:
    """Read exactly *n* bytes from *stream*, raising EOFError on short read."""
    data = stream.read(n)
    if not data or len(data) < n:
        raise EOFError(f"Expected {n} bytes, got {len(data) if data else 0}")
    return data


# ---------------------------------------------------------------------------
# Fixed-width primitives (little-endian)
# ---------------------------------------------------------------------------


def read_integer(stream: BinaryIO) -> int:
    """Read a 4-byte little-endian signed integer."""
    return struct.unpack("<i", _read_exact(stream, 4))[0]


def read_long(stream: BinaryIO) -> int:
    """Read an 8-byte little-endian signed long."""
    return struct.unpack("<q", _read_exact(stream, 8))[0]


def read_double(stream: BinaryIO) -> float:
    """Read an 8-byte little-endian IEEE 754 double."""
    return struct.unpack("<d", _read_exact(stream, 8))[0]


def read_boolean(stream: BinaryIO) -> bool:
    """Read a single byte; True if non-zero (.NET BinaryWriter convention)."""
    return _read_exact(stream, 1)[0] != 0


# ---------------------------------------------------------------------------
# String
# ---------------------------------------------------------------------------


def read_string(stream: BinaryIO) -> str:
    """Read a 7-bit-length-prefixed UTF-8 string."""
    length = decode_7bit_int(stream)
    if length == 0:
        return ""
    data = _read_exact(stream, length)
    return data.decode("utf-8")


def read_short_string(stream: BinaryIO) -> str:
    """Read a 1-byte-length-prefixed UTF-8 string (max 255 chars)."""
    length = _read_exact(stream, 1)[0]
    if length == 0:
        return ""
    data = _read_exact(stream, length)
    return data.decode("utf-8")


# ---------------------------------------------------------------------------
# DateTime
# ---------------------------------------------------------------------------


def read_datetime(stream: BinaryIO) -> NDateTime:
    """Read a date/time as 8-byte LE ticks."""
    ticks = read_long(stream)
    return NDateTime(ticks)


def read_7bit_datetime(stream: BinaryIO) -> NDateTime:
    """Read a 7-bit encoded date/time (absolute ticks)."""
    ticks = decode_7bit_long(stream)
    return NDateTime(ticks)


def read_7bit_datetime_delta(stream: BinaryIO, ref: NDateTime) -> NDateTime:
    """Read a 7-bit encoded date/time as a delta from *ref*."""
    ticks = decode_7bit_long(stream)
    return NDateTime(ticks + ref.ticks)


# ---------------------------------------------------------------------------
# 7-bit encoded integers/longs (delegates to EncodingUtil)
# ---------------------------------------------------------------------------


def read_7bit_integer(stream: BinaryIO) -> int:
    """Read a 7-bit encoded integer."""
    return decode_7bit_int(stream)


def read_7bit_long(stream: BinaryIO) -> int:
    """Read a 7-bit encoded long."""
    return decode_7bit_long(stream)


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------


def read_price(stream: BinaryIO) -> Price | None:
    """Read a string-encoded price (short-string format).

    Returns None if the string is empty.
    """
    string_value = read_short_string(stream)
    if not string_value:
        return None
    dec_value = Decimal(string_value).quantize(
        Decimal(10) ** -Scale, rounding=ROUND_HALF_EVEN
    )
    return Price(dec_value)


def read_7bit_price_n(stream: BinaryIO) -> Price | None:
    """Read a 7-bit encoded nullable price (header + decimal encoding)."""
    from t4login.util.encoding import decode_price_n

    return decode_price_n(stream)
