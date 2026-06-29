from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata import chart_format as cf
from t4login.definitions.chartdata.chart_data_type import (
    TPO,
    Day,
    Hour,
    Minute,
    Second,
    Tick,
)
from t4login.definitions.chartdata.chart_format import get_bar_start_time

# --- Constants match Java values ---


def test_trade_flags() -> None:
    assert cf.NONE == 0
    assert cf.TRADE_DUE_TO_SPREAD == 1
    assert cf.TRADE_AT_BID == 2
    assert cf.TRADE_AT_OFFER == 4


def test_binary_version() -> None:
    assert cf.CVAL_T4BIN_VERSION == 1


def test_selected_ctags() -> None:
    assert cf.CTAG_SOF == 1
    assert cf.CTAG_MARKET_DEFINITION == 2
    assert cf.CTAG_TICKDATAPOINT_7BIT == 11
    assert cf.CTAG_BARDATAPOINT_7BIT_DELTA_LOW == 21
    assert cf.CTAG_QUOTE_7BIT == 50
    assert cf.CTAG_TRADE_PRICE == 60
    assert cf.CTAG_BAR_PRICE == 65
    assert cf.CTAG_MARKET_MODE == 100
    assert cf.CTAG_SETTLEMENT_PRICE == 107
    assert cf.CTAG_PRICE_CHANGE == 140
    assert cf.CTAG_TPO_START_PRICE == 190


# --- get_bar_start_time with NDateTime ---


def test_bar_start_second() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time, td, Second)
    assert isinstance(result, NDateTime)
    assert result.year == 2024
    assert result.month == 3
    assert result.day == 15
    assert result.hour == 10
    assert result.minute == 30
    assert result.second == 45
    assert result.millisecond == 0


def test_bar_start_minute() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time, td, Minute)
    assert isinstance(result, NDateTime)
    assert result.minute == 30
    assert result.second == 0
    assert result.millisecond == 0


def test_bar_start_tpo_same_as_minute() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    assert get_bar_start_time(time, td, TPO) == get_bar_start_time(time, td, Minute)


def test_bar_start_hour() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time, td, Hour)
    assert isinstance(result, NDateTime)
    assert result.hour == 10
    assert result.minute == 0
    assert result.second == 0


def test_bar_start_day_returns_trade_date() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time, td, Day)
    assert result == td


def test_bar_start_tick_returns_time_unchanged() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time, td, Tick)
    assert result == time


# --- get_bar_start_time with raw ticks ---


def test_bar_start_ticks_second() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time.ticks, td.ticks, Second)
    expected = NDateTime(2024, 3, 15, 10, 30, 45, 0).ticks
    assert result == expected


def test_bar_start_ticks_day() -> None:
    time = NDateTime(2024, 3, 15, 10, 30, 45, 123)
    td = NDateTime(2024, 3, 15)
    result = get_bar_start_time(time.ticks, td.ticks, Day)
    assert result == td.ticks
