"""Tests for ChartDataType — verifies well-known instances and dynamic registration."""

from t4login.definitions.chartdata.chart_data_type import (
    TPO,
    ChartDataType,
    Day,
    Hour,
    Minute,
    Second,
    Tick,
    TickChange,
)


def test_well_known_count() -> None:
    assert len(ChartDataType.values()) == 7


def test_well_known_values() -> None:
    assert Tick.value == 0
    assert Second.value == 1
    assert Minute.value == 2
    assert Hour.value == 3
    assert Day.value == 4
    assert TPO.value == 5
    assert TickChange.value == 6


def test_get_known_returns_same_instance() -> None:
    assert ChartDataType.get(0) is Tick
    assert ChartDataType.get(5) is TPO


def test_get_unknown_registers_dynamically() -> None:
    initial_count = len(ChartDataType.values())
    new_val = ChartDataType.get(99)
    assert new_val.value == 99
    assert str(new_val) == "99"
    assert len(ChartDataType.values()) == initial_count + 1
    # Subsequent get returns same instance
    assert ChartDataType.get(99) is new_val


def test_str_returns_name() -> None:
    assert str(Tick) == "Tick"
    assert str(Day) == "Day"


def test_equality_and_hash() -> None:
    assert Tick == ChartDataType.get(0)
    assert hash(Tick) == hash(ChartDataType.get(0))
    assert Tick != Second
