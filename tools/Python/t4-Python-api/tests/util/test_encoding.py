"""Tests for t4login.util.encoding — ported from Java EncodingUtilTests."""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal
from io import BytesIO

import pytest

from t4login.util.encoding import (
    decode_7bit_int,
    decode_7bit_int_from_bytes,
    decode_7bit_long,
    decode_7bit_long_from_bytes,
    decode_decimal,
    decode_decimal_from_bytes,
    decode_price,
    decode_price_n,
    encode_7bit_int,
    encode_7bit_long,
    encode_decimal,
)


# ---------------------------------------------------------------------------
# 7-bit int round-trip tests
# ---------------------------------------------------------------------------


class TestEncode7BitInt:
    def test_positive(self) -> None:
        val = 109050
        encoded = encode_7bit_int(val)
        decoded = decode_7bit_int_from_bytes(encoded)
        assert decoded == val

    def test_negative(self) -> None:
        val = -109050
        encoded = encode_7bit_int(val)
        decoded = decode_7bit_int_from_bytes(encoded)
        assert decoded == val

    def test_zero(self) -> None:
        encoded = encode_7bit_int(0)
        assert len(encoded) == 1
        assert decode_7bit_int_from_bytes(encoded) == 0

    def test_max_value(self) -> None:
        val = 2**31 - 1  # INT32_MAX
        encoded = encode_7bit_int(val)
        assert len(encoded) == 5
        assert decode_7bit_int_from_bytes(encoded) == val

    def test_min_value(self) -> None:
        val = -(2**31)  # INT32_MIN
        encoded = encode_7bit_int(val)
        assert len(encoded) == 5
        assert decode_7bit_int_from_bytes(encoded) == val

    def test_small_positive_one_byte(self) -> None:
        for v in (1, 0x7F):
            encoded = encode_7bit_int(v)
            assert len(encoded) == 1
            assert decode_7bit_int_from_bytes(encoded) == v

    def test_boundary_0x80(self) -> None:
        encoded = encode_7bit_int(0x80)
        assert len(encoded) == 2
        assert decode_7bit_int_from_bytes(encoded) == 0x80

    def test_negative_one(self) -> None:
        val = -1
        encoded = encode_7bit_int(val)
        assert len(encoded) == 5
        assert decode_7bit_int_from_bytes(encoded) == val


# ---------------------------------------------------------------------------
# 7-bit long round-trip tests
# ---------------------------------------------------------------------------


class TestEncode7BitLong:
    def test_positive(self) -> None:
        val = 109050
        encoded = encode_7bit_long(val)
        decoded = decode_7bit_long_from_bytes(encoded)
        assert decoded == val

    def test_negative(self) -> None:
        val = -109050
        encoded = encode_7bit_long(val)
        decoded = decode_7bit_long_from_bytes(encoded)
        assert decoded == val

    def test_zero(self) -> None:
        encoded = encode_7bit_long(0)
        assert len(encoded) == 1
        assert decode_7bit_long_from_bytes(encoded) == 0

    def test_max_value(self) -> None:
        val = 2**63 - 1  # INT64_MAX
        encoded = encode_7bit_long(val)
        assert len(encoded) == 9
        assert decode_7bit_long_from_bytes(encoded) == val

    def test_min_value(self) -> None:
        val = -(2**63)  # INT64_MIN
        encoded = encode_7bit_long(val)
        assert len(encoded) == 10
        assert decode_7bit_long_from_bytes(encoded) == val

    def test_negative_one(self) -> None:
        val = -1
        encoded = encode_7bit_long(val)
        assert len(encoded) == 10
        assert decode_7bit_long_from_bytes(encoded) == val


# ---------------------------------------------------------------------------
# Decimal round-trip tests
# ---------------------------------------------------------------------------

# Comprehensive set of values from Java's test_Should_Encode_Decode_BigDecimal_3
_DECIMAL_TEST_VALUES = [
    "0", "0.000000000001", "0.00000000001", "0.0000000001", "0.000000001",
    "0.00000001", "0.00000005", "0.0000001", "0.00000015", "0.00000025",
    "0.0000005", "0.000001", "0.00000105", "0.0000015", "0.0000025",
    "0.000005", "0.00001", "0.000025", "0.00005", "0.0001", "0.00025",
    "0.0005", "0.001", "0.00125", "0.0025", "0.00390625", "0.005",
    "0.0078125", "0.01", "0.015625", "0.02", "0.025", "0.03125", "0.05",
    "0.1", "0.10000000000000001", "0.125", "0.2", "0.25", "0.5",
    "1", "10", "100", "125", "2", "2.5", "20", "200", "25", "250",
    "400", "5", "50", "500",
]


class TestEncodeDecimal:
    def test_positive_1(self) -> None:
        val = Decimal("1")
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val

    def test_negative_1(self) -> None:
        val = Decimal("-1")
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val

    def test_positive_109_050(self) -> None:
        val = Decimal("109.050")
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val

    def test_negative_109_050(self) -> None:
        val = Decimal("-109.050")
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val

    def test_zero(self) -> None:
        val = Decimal("0")
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val

    @pytest.mark.parametrize("str_val", _DECIMAL_TEST_VALUES)
    def test_scale18_round_trip(self, str_val: str) -> None:
        """Round-trip at scale 18 (mirrors Java's testEncodeDecode helper)."""
        val = Decimal(str_val).quantize(Decimal("1E-18"), rounding=ROUND_HALF_EVEN)
        encoded = encode_decimal(val)
        decoded = decode_decimal_from_bytes(encoded)
        assert decoded == val, f"Failed for {str_val}: got {decoded}"


# ---------------------------------------------------------------------------
# Price decode tests
# ---------------------------------------------------------------------------


class TestDecodePrice:
    def test_decode_price(self) -> None:
        val = Decimal("109.050000000000000000")
        encoded = encode_decimal(val)
        stream = BytesIO(encoded)
        price = decode_price(stream)
        assert price.value == val

    def test_decode_price_n_null(self) -> None:
        """Header byte with bit 0 clear → returns None."""
        stream = BytesIO(b"\x00")
        result = decode_price_n(stream)
        assert result is None

    def test_decode_price_n_present(self) -> None:
        """Header byte with bit 0 set → decodes decimal."""
        val = Decimal("25").quantize(Decimal("1E-18"), rounding=ROUND_HALF_EVEN)
        payload = encode_decimal(val)
        stream = BytesIO(b"\x01" + payload)
        result = decode_price_n(stream)
        assert result is not None
        assert result.value == val


# ---------------------------------------------------------------------------
# Known byte-vector tests (binary parity with Java)
# ---------------------------------------------------------------------------


class TestKnownByteVectors:
    """Inline (value, expected_bytes) vectors for cross-platform parity."""

    def test_int_zero(self) -> None:
        assert encode_7bit_int(0) == b"\x00"

    def test_int_one(self) -> None:
        assert encode_7bit_int(1) == b"\x01"

    def test_int_127(self) -> None:
        assert encode_7bit_int(127) == b"\x7F"

    def test_int_128(self) -> None:
        assert encode_7bit_int(128) == b"\x80\x01"

    def test_int_16383(self) -> None:
        # 0x3FFF = 16383 → 2 bytes: 0xFF 0x7F
        assert encode_7bit_int(16383) == b"\xFF\x7F"

    def test_int_16384(self) -> None:
        # 0x4000 = 16384 → 3 bytes: 0x80 0x80 0x01
        assert encode_7bit_int(16384) == b"\x80\x80\x01"

    def test_long_zero(self) -> None:
        assert encode_7bit_long(0) == b"\x00"

    def test_long_one(self) -> None:
        assert encode_7bit_long(1) == b"\x01"

    def test_long_128(self) -> None:
        assert encode_7bit_long(128) == b"\x80\x01"

    def test_decimal_zero(self) -> None:
        # Zero decimal: header=0x00, no payload
        assert encode_decimal(Decimal("0")) == b"\x00"


# ---------------------------------------------------------------------------
# EOF handling
# ---------------------------------------------------------------------------


class TestEOFErrors:
    def test_decode_7bit_int_eof(self) -> None:
        with pytest.raises(EOFError):
            decode_7bit_int(BytesIO(b""))

    def test_decode_7bit_long_eof(self) -> None:
        with pytest.raises(EOFError):
            decode_7bit_long(BytesIO(b""))

    def test_decode_decimal_eof(self) -> None:
        with pytest.raises(EOFError):
            decode_decimal(BytesIO(b""))
