"""Tests for t4login.connection.counting_stream."""

from __future__ import annotations

from io import BytesIO

import pytest

from t4login.connection.counting_stream import CountingInputStream


class TestCountingInputStream:
    def test_initial_count_is_zero(self) -> None:
        cin = CountingInputStream(BytesIO(b"hello"))
        assert cin.get_count() == 0

    def test_read_increments_count(self) -> None:
        cin = CountingInputStream(BytesIO(b"hello"))
        cin.read(3)
        assert cin.get_count() == 3

    def test_read_exact_increments_count(self) -> None:
        cin = CountingInputStream(BytesIO(b"hello world"))
        cin.read_exact(5)
        assert cin.get_count() == 5

    def test_reset_count(self) -> None:
        cin = CountingInputStream(BytesIO(b"hello world"))
        cin.read(5)
        assert cin.get_count() == 5
        cin.reset_count()
        assert cin.get_count() == 0
        cin.read(3)
        assert cin.get_count() == 3

    def test_skip_increments_count(self) -> None:
        cin = CountingInputStream(BytesIO(b"abcdefgh"))
        skipped = cin.skip(4)
        assert skipped == 4
        assert cin.get_count() == 4

    def test_read_exact_raises_on_short_read(self) -> None:
        cin = CountingInputStream(BytesIO(b"hi"))
        with pytest.raises(EOFError):
            cin.read_exact(10)

    def test_read_returns_correct_data(self) -> None:
        cin = CountingInputStream(BytesIO(b"abcdef"))
        data = cin.read(3)
        assert data == b"abc"
        data = cin.read(3)
        assert data == b"def"

    def test_available_on_seekable_stream(self) -> None:
        cin = CountingInputStream(BytesIO(b"twelve chars"))
        assert cin.available() == 12
        cin.read(5)
        assert cin.available() == 7

    def test_multiple_operations_cumulative(self) -> None:
        cin = CountingInputStream(BytesIO(b"0123456789"))
        cin.read(2)
        cin.read_exact(3)
        cin.skip(2)
        assert cin.get_count() == 7
