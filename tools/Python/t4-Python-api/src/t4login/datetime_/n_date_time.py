"""Shim port of `com.t4login.datetime.NDateTime`.

Faithful reimplementation of the .NET-style ticks-based DateTime used by
the T4 API. A *tick* is 100 nanoseconds since 0001-01-01 00:00:00.

Phase-1 surface:
- Construction from ticks, or from (year, month, day[, hour, minute, second[, millisecond]]).
- `ticks` property (read-only).
- Date-part accessors: `year`, `month`, `day`, `hour`, `minute`, `second`, `millisecond`.
- `MinValue` / `MaxValue` module-level singletons.
- Comparison operators.
"""

from __future__ import annotations

# ----- Tick constants (100-ns units) -----------------------------------------
TICKS_PER_MILLISECOND: int = 10_000
TICKS_PER_SECOND: int = TICKS_PER_MILLISECOND * 1_000
TICKS_PER_MINUTE: int = TICKS_PER_SECOND * 60
TICKS_PER_HOUR: int = TICKS_PER_MINUTE * 60
TICKS_PER_DAY: int = TICKS_PER_HOUR * 24

_DAYS_PER_YEAR: int = 365
_DAYS_PER_4_YEARS: int = _DAYS_PER_YEAR * 4 + 1  # 1461
_DAYS_PER_100_YEARS: int = _DAYS_PER_4_YEARS * 25 - 1  # 36524
_DAYS_PER_400_YEARS: int = _DAYS_PER_100_YEARS * 4 + 1  # 146097
_DAYS_TO_10000: int = _DAYS_PER_400_YEARS * 25 - 366  # 3652059

MIN_TICKS: int = 0
MAX_TICKS: int = _DAYS_TO_10000 * TICKS_PER_DAY - 1

_DAYS_TO_MONTH_365: tuple[int, ...] = (
    0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365
)
_DAYS_TO_MONTH_366: tuple[int, ...] = (
    0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366
)

_DATE_PART_YEAR: int = 0
_DATE_PART_DAY_OF_YEAR: int = 1
_DATE_PART_MONTH: int = 2
_DATE_PART_DAY: int = 3


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _date_to_ticks(year: int, month: int, day: int) -> int:
    if 1 <= year <= 9999 and 1 <= month <= 12:
        days = _DAYS_TO_MONTH_366 if _is_leap_year(year) else _DAYS_TO_MONTH_365
        if 1 <= day <= days[month] - days[month - 1]:
            y = year - 1
            n = y * 365 + y // 4 - y // 100 + y // 400 + days[month - 1] + day - 1
            return n * TICKS_PER_DAY
    raise ValueError(f"Invalid date: {year}-{month}-{day}")


def _time_to_ticks(hour: int, minute: int, second: int) -> int:
    if 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60:
        return hour * TICKS_PER_HOUR + minute * TICKS_PER_MINUTE + second * TICKS_PER_SECOND
    raise ValueError(f"Invalid time: {hour}:{minute}:{second}")


class NDateTime:
    """Immutable .NET-compatible DateTime (ticks since 0001-01-01)."""

    __slots__ = ("_ticks",)

    _ticks: int

    def __init__(
        self,
        ticks_or_year: int,
        month: int | None = None,
        day: int | None = None,
        hour: int = 0,
        minute: int = 0,
        second: int = 0,
        millisecond: int = 0,
    ) -> None:
        if month is None:
            # Single-arg: interpret as raw ticks.
            ticks = ticks_or_year
        else:
            if day is None:
                raise ValueError("day must be provided when month is given")
            ticks = _date_to_ticks(ticks_or_year, month, day) + _time_to_ticks(hour, minute, second)
            ticks += millisecond * TICKS_PER_MILLISECOND
        if ticks < MIN_TICKS or ticks > MAX_TICKS:
            raise ValueError(f"Ticks out of range: {ticks}")
        self._ticks = ticks

    @property
    def ticks(self) -> int:
        return self._ticks

    # Alias matching Java getter name (snake_case)
    def get_ticks(self) -> int:
        return self._ticks

    # ----- Date part extraction (mirrors Java GetDatePart) --------------------

    def _get_date_part(self, part: int) -> int:
        n = self._ticks // TICKS_PER_DAY
        y400 = n // _DAYS_PER_400_YEARS
        n -= y400 * _DAYS_PER_400_YEARS
        y100 = n // _DAYS_PER_100_YEARS
        if y100 == 4:
            y100 = 3
        n -= y100 * _DAYS_PER_100_YEARS
        y4 = n // _DAYS_PER_4_YEARS
        n -= y4 * _DAYS_PER_4_YEARS
        y1 = n // _DAYS_PER_YEAR
        if y1 == 4:
            y1 = 3
        if part == _DATE_PART_YEAR:
            return y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1
        n -= y1 * _DAYS_PER_YEAR
        if part == _DATE_PART_DAY_OF_YEAR:
            return n + 1
        leap = y1 == 3 and (y4 != 24 or y100 == 3)
        days = _DAYS_TO_MONTH_366 if leap else _DAYS_TO_MONTH_365
        m = (n >> 5) + 1
        while n >= days[m]:
            m += 1
        if part == _DATE_PART_MONTH:
            return m
        return n - days[m - 1] + 1

    @property
    def year(self) -> int:
        return self._get_date_part(_DATE_PART_YEAR)

    @property
    def month(self) -> int:
        return self._get_date_part(_DATE_PART_MONTH)

    @property
    def day(self) -> int:
        return self._get_date_part(_DATE_PART_DAY)

    @property
    def hour(self) -> int:
        return (self._ticks // TICKS_PER_HOUR) % 24

    @property
    def minute(self) -> int:
        return (self._ticks // TICKS_PER_MINUTE) % 60

    @property
    def second(self) -> int:
        return (self._ticks // TICKS_PER_SECOND) % 60

    @property
    def millisecond(self) -> int:
        return (self._ticks // TICKS_PER_MILLISECOND) % 1000

    # Compatibility method aliases matching Java getter style
    def get_year(self) -> int:
        return self.year

    def get_month(self) -> int:
        return self.month

    def get_day(self) -> int:
        return self.day

    def get_hour(self) -> int:
        return self.hour

    def get_minute(self) -> int:
        return self.minute

    def get_second(self) -> int:
        return self.second

    # ----- Comparison ---------------------------------------------------------

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, NDateTime):
            return NotImplemented
        return self._ticks == other._ticks

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, NDateTime):
            return NotImplemented
        return self._ticks < other._ticks

    def __le__(self, other: object) -> bool:
        if not isinstance(other, NDateTime):
            return NotImplemented
        return self._ticks <= other._ticks

    def __gt__(self, other: object) -> bool:
        if not isinstance(other, NDateTime):
            return NotImplemented
        return self._ticks > other._ticks

    def __ge__(self, other: object) -> bool:
        if not isinstance(other, NDateTime):
            return NotImplemented
        return self._ticks >= other._ticks

    def __hash__(self) -> int:
        return hash(self._ticks)

    def __repr__(self) -> str:
        return (
            f"NDateTime({self.year:04d}-{self.month:02d}-{self.day:02d} "
            f"{self.hour:02d}:{self.minute:02d}:{self.second:02d}, "
            f"ticks={self._ticks})"
        )


MinValue: NDateTime = NDateTime(MIN_TICKS)
MaxValue: NDateTime = NDateTime(MAX_TICKS)
