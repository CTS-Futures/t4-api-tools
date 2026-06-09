"""Port of `com.t4login.definitions.chartdata.ChartDataType`.

Ported as a plain class (not IntEnum) to preserve the Java `@AsEnum` runtime
extensibility: `get(value)` dynamically registers unknown values with a logged
warning, and `values()` returns the live list.

Represents the time-aggregation level of chart data:
- Tick (0)   — individual trades, no time aggregation.
- Second (1) — bars aggregated to 1-second boundaries.
- Minute (2) — bars aggregated to 1-minute boundaries.
- Hour (3)   — bars aggregated to 1-hour boundaries.
- Day (4)    — daily bars (one per trade date).
- TPO (5)    — Time-Price Opportunity (market profile) data.
- TickChange (6) — price-change records (tick-level, no volume).

The stream readers use these values to determine how to truncate bar start
times (via ``get_bar_start_time``) and to select which decode path to follow.
"""

from __future__ import annotations

import logging

_log = logging.getLogger(__name__)

_map: dict[int, ChartDataType] = {}
_values: list[ChartDataType] = []


class ChartDataType:
    """Chart data aggregation type (mirrors Java's `@AsEnum` pattern)."""

    __slots__ = ("_name", "_value")

    _name: str
    _value: int

    def __init__(self, value: int, name: str) -> None:
        self._value = value
        self._name = name

    @property
    def value(self) -> int:
        return self._value

    @property
    def name(self) -> str:
        return self._name

    def get_value(self) -> int:
        """Java-style getter alias."""
        return self._value

    @staticmethod
    def get(value: int) -> ChartDataType:
        """Lookup by int value; dynamically registers unknown values (mirrors Java)."""
        val = _map.get(value)
        if val is None:
            _log.warning(
                "ChartDataType.get(): non-existent value %d created and added without name.",
                value,
            )
            val = ChartDataType(value, str(value))
            _map[value] = val
            _values.append(val)
        return val

    @staticmethod
    def values() -> list[ChartDataType]:
        """Returns the live list of all known instances."""
        return list(_values)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ChartDataType):
            return NotImplemented
        return self._value == other._value

    def __hash__(self) -> int:
        return hash(self._value)

    def __repr__(self) -> str:
        return f"ChartDataType({self._value}, {self._name!r})"

    def __str__(self) -> str:
        return self._name


def _register(value: int, name: str) -> ChartDataType:
    inst = ChartDataType(value, name)
    _map[value] = inst
    _values.append(inst)
    return inst


# --- Well-known instances (mirrors Java static block) -------------------------
Tick: ChartDataType = _register(0, "Tick")
Second: ChartDataType = _register(1, "Second")
Minute: ChartDataType = _register(2, "Minute")
Hour: ChartDataType = _register(3, "Hour")
Day: ChartDataType = _register(4, "Day")
TPO: ChartDataType = _register(5, "TPO")
TickChange: ChartDataType = _register(6, "TickChange")
