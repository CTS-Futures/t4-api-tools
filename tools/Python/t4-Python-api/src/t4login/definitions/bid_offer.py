"""Shim port of `com.t4login.definitions.BidOffer`.

The Java original uses the `@AsEnum` runtime-extensible pattern (mirrors
`ChartDataType`). For phase 1 this is reduced to an `IntEnum` with the three
stable constants chartdata actually consumes. A full plain-class port can
replace this later if/when extensibility is exercised.
"""

from __future__ import annotations

from enum import IntEnum


class BidOffer(IntEnum):
    """Indicates which side of the market a trade was executed against.

    Used by the chart data readers to classify each trade as hitting the
    bid (sell aggressor), lifting the offer (buy aggressor), or undefined
    (e.g. auction/cross trades where aggressor side is not determined).
    """

    Undefined = 0
    Bid = 1
    Offer = -1

    @classmethod
    def get(cls, value: int) -> BidOffer:
        try:
            return cls(value)
        except ValueError:
            return cls.Undefined
