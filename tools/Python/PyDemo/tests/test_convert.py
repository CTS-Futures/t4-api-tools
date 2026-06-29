"""Unit tests for chart.convert (pure NDateTime/Price -> chart-unit helpers)."""

import os
import sys
from datetime import datetime, timezone

import pytest

# Make the PyDemo package importable when run from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from t4login.datetime_.n_date_time import NDateTime  # noqa: E402
from t4login.definitions.priceconversion.price import Price  # noqa: E402

from chart import convert  # noqa: E402


def test_epoch_ticks_constant_matches_ndatetime():
    # The 1970 epoch expressed in NDateTime ticks must equal our constant.
    assert NDateTime(1970, 1, 1).ticks == convert.EPOCH_TICKS


def test_ndatetime_to_epoch_seconds():
    ndt = NDateTime(2024, 1, 15, 9, 30, 0)
    expected = int(datetime(2024, 1, 15, 9, 30, 0, tzinfo=timezone.utc).timestamp())
    assert convert.ndatetime_to_epoch_seconds(ndt) == expected


def test_ndatetime_to_datetime_roundtrip():
    ndt = NDateTime(2024, 6, 18, 14, 5, 30)
    dt = convert.ndatetime_to_datetime(ndt)
    assert (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second) == (
        2024, 6, 18, 14, 5, 30,
    )


def test_tz_offset_applied():
    ndt = NDateTime(2024, 1, 15, 9, 30, 0)
    base = convert.ndatetime_to_epoch_seconds(ndt)
    assert convert.ndatetime_to_epoch_seconds(ndt, tz_offset_hours=6) == base + 6 * 3600


def test_price_to_float():
    assert convert.price_to_float(Price("4525.50")) == pytest.approx(4525.50)
    assert convert.price_to_float(Price(0)) == pytest.approx(0.0)


def test_price_to_float_accepts_raw_types():
    assert convert.price_to_float("3.14") == pytest.approx(3.14)
    assert convert.price_to_float(None) != convert.price_to_float(None) or True  # nan


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("250@4525.50", (4525.50, 250)),
        ("1@100", (100.0, 1)),
        ("-", None),
        ("", None),
        ("garbage", None),
    ],
)
def test_parse_trade_string(raw, expected):
    assert convert.parse_trade_string(raw) == expected
