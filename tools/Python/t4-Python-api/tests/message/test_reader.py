"""Tests for t4login.message.reader."""

from __future__ import annotations

import struct
from io import BytesIO

import pytest

from t4login.message.reader import (
    read_7bit_datetime,
    read_7bit_datetime_delta,
    read_7bit_integer,
    read_7bit_long,
    read_7bit_price_n,
    read_boolean,
    read_datetime,
    read_double,
    read_integer,
    read_long,
    read_price,
    read_short_string,
    read_string,
)
from t4login.datetime_.n_date_time import NDateTime
from t4login.util.encoding import encode_7bit_int, encode_7bit_long


class TestReadInteger:
    def test_positive(self) -> None:
        buf = struct.pack("<i", 42)
        assert read_integer(BytesIO(buf)) == 42

    def test_negative(self) -> None:
        buf = struct.pack("<i", -1000)
        assert read_integer(BytesIO(buf)) == -1000

    def test_zero(self) -> None:
        buf = struct.pack("<i", 0)
        assert read_integer(BytesIO(buf)) == 0

    def test_eof(self) -> None:
        with pytest.raises(EOFError):
            read_integer(BytesIO(b"\x00\x00"))


class TestReadLong:
    def test_positive(self) -> None:
        buf = struct.pack("<q", 123456789012345)
        assert read_long(BytesIO(buf)) == 123456789012345

    def test_negative(self) -> None:
        buf = struct.pack("<q", -99999)
        assert read_long(BytesIO(buf)) == -99999


class TestReadDouble:
    def test_value(self) -> None:
        buf = struct.pack("<d", 3.14159)
        result = read_double(BytesIO(buf))
        assert abs(result - 3.14159) < 1e-10


class TestReadBoolean:
    def test_true(self) -> None:
        assert read_boolean(BytesIO(b"\x01")) is True

    def test_false(self) -> None:
        assert read_boolean(BytesIO(b"\x00")) is False

    def test_nonzero_is_true(self) -> None:
        assert read_boolean(BytesIO(b"\xFF")) is True


class TestReadString:
    def test_empty(self) -> None:
        buf = encode_7bit_int(0)
        assert read_string(BytesIO(buf)) == ""

    def test_ascii(self) -> None:
        text = "hello"
        encoded = encode_7bit_int(len(text)) + text.encode("utf-8")
        assert read_string(BytesIO(encoded)) == "hello"

    def test_utf8(self) -> None:
        text = "café"
        text_bytes = text.encode("utf-8")
        encoded = encode_7bit_int(len(text_bytes)) + text_bytes
        assert read_string(BytesIO(encoded)) == "café"


class TestReadShortString:
    def test_empty(self) -> None:
        assert read_short_string(BytesIO(b"\x00")) == ""

    def test_basic(self) -> None:
        text = "hi"
        encoded = bytes([len(text)]) + text.encode("utf-8")
        assert read_short_string(BytesIO(encoded)) == "hi"


class TestReadDateTime:
    def test_from_ticks(self) -> None:
        ticks = 637500000000000000
        buf = struct.pack("<q", ticks)
        dt = read_datetime(BytesIO(buf))
        assert dt.ticks == ticks


class TestRead7BitDateTime:
    def test_absolute(self) -> None:
        ticks = 637500000000000000
        buf = encode_7bit_long(ticks)
        dt = read_7bit_datetime(BytesIO(buf))
        assert dt.ticks == ticks

    def test_delta(self) -> None:
        ref = NDateTime(1000000)
        delta = 500000
        buf = encode_7bit_long(delta)
        dt = read_7bit_datetime_delta(BytesIO(buf), ref)
        assert dt.ticks == 1500000


class TestRead7BitInteger:
    def test_value(self) -> None:
        buf = encode_7bit_int(12345)
        assert read_7bit_integer(BytesIO(buf)) == 12345


class TestRead7BitLong:
    def test_value(self) -> None:
        buf = encode_7bit_long(9876543210)
        assert read_7bit_long(BytesIO(buf)) == 9876543210


class TestReadPrice:
    def test_value(self) -> None:
        text = "25.5"
        encoded = bytes([len(text)]) + text.encode("utf-8")
        price = read_price(BytesIO(encoded))
        assert price is not None
        from decimal import Decimal
        assert price.value == Decimal("25.5").quantize(Decimal("1E-18"))

    def test_empty_returns_none(self) -> None:
        encoded = b"\x00"
        assert read_price(BytesIO(encoded)) is None


class TestRead7BitPriceN:
    def test_null(self) -> None:
        # Header byte with bit 0 clear
        assert read_7bit_price_n(BytesIO(b"\x00")) is None

    def test_present(self) -> None:
        from decimal import Decimal, ROUND_HALF_EVEN
        from t4login.util.encoding import encode_decimal

        val = Decimal("50").quantize(Decimal("1E-18"), rounding=ROUND_HALF_EVEN)
        payload = b"\x01" + encode_decimal(val)
        price = read_7bit_price_n(BytesIO(payload))
        assert price is not None
        assert price.value == val
