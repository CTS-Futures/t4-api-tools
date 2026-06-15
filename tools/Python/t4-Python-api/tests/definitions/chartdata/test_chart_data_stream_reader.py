"""Tests for ChartDataStreamReader — construction, state management, and helpers."""

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_data_state import ChartDataState
from t4login.definitions.chartdata.chart_data_stream_reader import ChartDataStreamReader
from t4login.definitions.chartdata.chart_data_type import Tick


def _make_reader() -> ChartDataStreamReader:
    td = NDateTime(2024, 1, 15)
    return ChartDataStreamReader(stream=None, trade_date=td, market_id="ESM4", data_type=Tick)


def test_construction_initialises_state() -> None:
    r = _make_reader()
    assert isinstance(r.state, ChartDataState)
    assert r.state.MarketID == "ESM4"
    assert r.state.TradeDate == NDateTime(2024, 1, 15)


def test_read_returns_false_on_none_stream() -> None:
    r = _make_reader()
    assert r.read() is False


def test_close_on_none_stream() -> None:
    r = _make_reader()
    r.close()  # should not raise


def test_get_incremental_time_absolute() -> None:
    # Value above threshold => treat as absolute
    result = ChartDataStreamReader._get_incremental_time(100, 599_266_080_000_000_001)
    assert result == 599_266_080_000_000_001


def test_get_incremental_time_relative() -> None:
    result = ChartDataStreamReader._get_incremental_time(1000, 500)
    assert result == 1500


def test_market_state_reuse() -> None:
    r = _make_reader()
    # Same market ID should return same state object
    s1 = r._get_market_state("ESM4")
    s2 = r._get_market_state("ESM4")
    assert s1 is s2


def test_market_state_different_market() -> None:
    r = _make_reader()
    s1 = r._get_market_state("ESM4")
    s2 = r._get_market_state("NQM4")
    assert s1 is not s2
    assert s2.MarketID == "NQM4"
