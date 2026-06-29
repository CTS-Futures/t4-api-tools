"""Shim port of `com.t4login.definitions.MarketMode`.

The Java original uses the `@AsEnum` runtime-extensible pattern. For phase 1
this is reduced to an `IntEnum` covering the 16 stable values. Localization
(`descr_loc`) and icon (`ico_res`) metadata are dropped \u2014 unused by chartdata.
"""

from __future__ import annotations

from enum import IntEnum


class MarketMode(IntEnum):
    """Exchange session state for a market.

    Represents the lifecycle of a trading session. The stream readers emit a
    ``ChartDataChange.MarketMode`` event each time the exchange transitions
    between states (e.g. PreOpen → Open → Closed).
    """

    Undefined = 0
    PreOpen = 1
    Open = 2
    RestrictedOpen = 3
    PreClosed = 4
    Closed = 5
    Suspended = 6
    Halted = 7
    Failed = 8
    PreCross = 9
    Cross = 10
    Expired = 11
    Rejected = 12
    Unavailable = 13
    NoPermission = 14
    TrialExpired = 15

    @classmethod
    def get(cls, value: int) -> MarketMode:
        try:
            return cls(value)
        except ValueError:
            return cls.Undefined
