"""Tests for NDateTime — construction, date-part extraction, tick round-trips, and comparison."""

import pytest

from t4login.datetime_.n_date_time import (
    MAX_TICKS,
    MIN_TICKS,
    TICKS_PER_DAY,
    TICKS_PER_HOUR,
    TICKS_PER_MILLISECOND,
    TICKS_PER_MINUTE,
    TICKS_PER_SECOND,
    MaxValue,
    MinValue,
    NDateTime,
)


def test_min_max_values() -> None:
    assert MinValue.ticks == 0
    assert MaxValue.ticks == MAX_TICKS


def test_construct_from_ticks() -> None:
    dt = NDateTime(0)
    assert dt.year == 1
    assert dt.month == 1
    assert dt.day == 1


def test_construct_from_date() -> None:
    dt = NDateTime(2024, 6, 15)
    assert dt.year == 2024
    assert dt.month == 6
    assert dt.day == 15
    assert dt.hour == 0
    assert dt.minute == 0
    assert dt.second == 0


def test_construct_from_datetime() -> None:
    dt = NDateTime(2024, 3, 14, 9, 26, 53)
    assert dt.year == 2024
    assert dt.month == 3
    assert dt.day == 14
    assert dt.hour == 9
    assert dt.minute == 26
    assert dt.second == 53


def test_construct_with_millisecond() -> None:
    dt = NDateTime(2000, 1, 1, 12, 30, 45, 123)
    assert dt.millisecond == 123


def test_roundtrip_ticks_to_date_parts() -> None:
    """Construct from parts, take ticks, reconstruct, verify parts match."""
    original = NDateTime(1999, 12, 31, 23, 59, 59, 999)
    reconstructed = NDateTime(original.ticks)
    assert reconstructed.year == 1999
    assert reconstructed.month == 12
    assert reconstructed.day == 31
    assert reconstructed.hour == 23
    assert reconstructed.minute == 59
    assert reconstructed.second == 59
    assert reconstructed.millisecond == 999


def test_known_epoch_ticks() -> None:
    """1970-01-01 is day 719162 from 0001-01-01."""
    epoch = NDateTime(1970, 1, 1)
    assert epoch.ticks == 719162 * TICKS_PER_DAY


def test_leap_year_feb_29() -> None:
    dt = NDateTime(2000, 2, 29)
    assert dt.month == 2
    assert dt.day == 29


def test_invalid_date_raises() -> None:
    with pytest.raises(ValueError):
        NDateTime(2001, 2, 29)  # not leap year


def test_ticks_out_of_range_raises() -> None:
    with pytest.raises(ValueError):
        NDateTime(-1)
    with pytest.raises(ValueError):
        NDateTime(MAX_TICKS + 1)


def test_comparison() -> None:
    a = NDateTime(2020, 1, 1)
    b = NDateTime(2020, 1, 2)
    assert a < b
    assert b > a
    assert a <= a
    assert a == NDateTime(a.ticks)
    assert a != b


def test_get_ticks_alias() -> None:
    dt = NDateTime(12345)
    assert dt.get_ticks() == 12345


def test_tick_constants() -> None:
    assert TICKS_PER_SECOND == TICKS_PER_MILLISECOND * 1000
    assert TICKS_PER_MINUTE == TICKS_PER_SECOND * 60
    assert TICKS_PER_HOUR == TICKS_PER_MINUTE * 60
    assert TICKS_PER_DAY == TICKS_PER_HOUR * 24
    assert MIN_TICKS == 0
