"""Port of `com.t4login.definitions.priceconversion.Price`.

Java's `BigDecimal` maps to Python's `decimal.Decimal`. The Java `Scale = 18`
(half-even rounding) is enforced via `Decimal.quantize`.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_EVEN, Decimal
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from t4login.definitions.priceconversion.i_market_conversion import IMarketConversion

Scale: int = 18

_QUANTUM: Decimal = Decimal(1).scaleb(-Scale)

# Sentinel values mirroring Java's Price.MaxValue / MinValue
_MAX_DECIMAL = Decimal("79228162514264337593543950335")
_MIN_DECIMAL = Decimal("-79228162514264337593543950335")


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(_QUANTUM, rounding=ROUND_HALF_EVEN)


class RoundingDirection:
    Up = "Up"
    Down = "Down"


class Price:
    __slots__ = ("_value",)

    _value: Decimal

    def __init__(self, value: int | float | str | Decimal) -> None:
        if isinstance(value, Decimal):
            d = value
        elif isinstance(value, (int, float)):
            d = Decimal(str(value))
        else:
            d = Decimal(value)
        object.__setattr__(self, "_value", _quantize(d))

    @property
    def value(self) -> Decimal:
        return self._value

    @classmethod
    def of(cls, value: int | float | str) -> Price:
        return cls(value)

    # --- Decode classmethods (Phase 2) ------------------------------------

    @classmethod
    def decode(cls, stream: Any) -> Price:
        """Decode a Price from a binary stream (delegates to util.encoding)."""
        from t4login.util.encoding import decode_price

        return decode_price(stream)

    @classmethod
    def decode_n(cls, stream: Any) -> Price | None:
        """Decode a nullable Price from a binary stream (delegates to util.encoding)."""
        from t4login.util.encoding import decode_price_n

        return decode_price_n(stream)

    # --- Static factory methods -------------------------------------------

    @classmethod
    def from_ticks(cls, mkt: IMarketConversion, ticks: int) -> Price:
        """Convert a tick value to a Price using the market denominator."""
        decimal_ticks = Decimal(ticks)
        decimal_denom = Decimal(mkt.get_denominator())
        return cls(decimal_ticks / decimal_denom)

    @classmethod
    def from_increments(cls, mkt: IMarketConversion, increments: int | Decimal) -> Price:
        """Convert a count of price increments to a Price."""
        vpt = mkt.get_vpt()
        if vpt is None or not vpt.get_is_valid():
            inc_dec = Decimal(increments) if not isinstance(increments, Decimal) else increments
            return cls(inc_dec * mkt.get_min_price_increment().value)
        else:
            return vpt.increments_to_price(
                Decimal(increments) if not isinstance(increments, Decimal) else increments
            )

    @classmethod
    def from_cash(cls, mkt: IMarketConversion, cash_value: Decimal) -> Price:
        """Convert a cash value to Price using the market point value."""
        return cls(cash_value / mkt.get_point_value())

    # --- Arithmetic -------------------------------------------------------

    def add(self, other: Price | Decimal) -> Price:
        """Return a new Price representing self + other."""
        if isinstance(other, Price):
            return Price(self._value + other._value)
        return Price(self._value + other)

    def subtract(self, other: Price | Decimal) -> Price:
        """Return a new Price representing self - other."""
        if isinstance(other, Price):
            return Price(self._value - other._value)
        return Price(self._value - other)

    def multiply(self, other: Price | Decimal | float | int) -> Price:
        """Return a new Price representing self * other."""
        if isinstance(other, Price):
            return Price(self._value * other._value)
        if isinstance(other, Decimal):
            return Price(self._value * other)
        return Price(self._value * Decimal(str(other)))

    def divide(self, other: Price | Decimal | float | int) -> Price:
        """Return a new Price representing self / other (Scale=18, HALF_EVEN)."""
        if isinstance(other, Price):
            divisor = other._value
        elif isinstance(other, Decimal):
            divisor = other
        else:
            divisor = Decimal(str(other))
        return Price(self._value / divisor)

    def abs(self) -> Price:
        """Return the absolute value of this price."""
        if self._value < 0:
            return Price(self._value.copy_abs())
        return self

    def negated(self) -> Price:
        """Return the negated value of this price."""
        return Price(self._value.copy_negate())

    # --- Market-aware methods ---------------------------------------------

    def to_ticks(self, mkt: IMarketConversion) -> int:
        """Convert this price to a tick value."""
        return int(self._value * Decimal(mkt.get_denominator()))

    def to_increments(self, mkt: IMarketConversion) -> Decimal:
        """Convert this price to a count of price increments."""
        vpt = mkt.get_vpt()
        if vpt is None or not vpt.get_is_valid():
            return self._value / mkt.get_min_price_increment().value
        else:
            return vpt.price_to_increments(self)

    def to_whole_increments(self, mkt: IMarketConversion, direction: str | None = None) -> int:
        """Convert this price to a whole number of increments."""
        vpt = mkt.get_vpt()
        if vpt is None or not vpt.get_is_valid():
            incr_dec = self._value / mkt.get_min_price_increment().value
        else:
            incr_dec = vpt.price_to_increments(self)

        if direction is None:
            return int(incr_dec.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
        elif direction == RoundingDirection.Down:
            return int(incr_dec.quantize(Decimal(1), rounding=ROUND_FLOOR))
        else:
            return int(incr_dec.quantize(Decimal(1), rounding=ROUND_CEILING))

    def add_increments(self, mkt: IMarketConversion, increments: int | Decimal) -> Price:
        """Add *increments* tick-steps to this price using the market conversion rules.

        When the market has a valid Variable Price Tick (VPT) specification the
        increment size varies by price level, so the operation is delegated to
        ``vpt.add_increments``.  When there is no VPT, or the VPT spec could not
        be parsed (``get_is_valid()`` returns ``False``), a uniform increment is
        used: ``price + increments * market.min_price_increment``.
        """
        vpt = mkt.get_vpt()
        inc_dec = Decimal(increments) if not isinstance(increments, Decimal) else increments
        if vpt is None or not vpt.get_is_valid():
            return self.add(mkt.get_min_price_increment().multiply(inc_dec))
        else:
            return vpt.add_increments(self, inc_dec)

    def is_whole_increment(self, mkt: IMarketConversion) -> bool:
        """Check whether this price is an exact multiple of the market increment."""
        vpt = mkt.get_vpt()
        if vpt is None or not vpt.get_is_valid():
            return self._value % mkt.get_min_price_increment().value == 0
        else:
            return vpt.is_whole_increment(self)

    def round(self, mkt: IMarketConversion, direction: str | None = None) -> Price:
        """Round this price to the nearest market increment."""
        if direction is None:
            increments = self.to_increments(mkt)
            whole = int(increments.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
            return Price.from_increments(mkt, whole)
        elif direction == RoundingDirection.Down:
            return self.round_down(mkt)
        else:
            return self.round_up(mkt)

    def round_up(self, mkt: IMarketConversion) -> Price:
        """Round this price up (ceiling) to the next market increment."""
        increments = self.to_increments(mkt)
        if increments % 1 != 0:
            rounded = int(increments.quantize(Decimal(1), rounding=ROUND_CEILING))
            return Price.from_increments(mkt, rounded)
        return self

    def round_down(self, mkt: IMarketConversion) -> Price:
        """Round this price down (floor) to the previous market increment."""
        increments = self.to_increments(mkt)
        if increments % 1 != 0:
            rounded = int(increments.quantize(Decimal(1), rounding=ROUND_FLOOR))
            return Price.from_increments(mkt, rounded)
        return self

    def round_to_nearest(self, mkt: IMarketConversion) -> Price:
        """Round to whichever of round_up/round_down is closer."""
        up = self.round_up(mkt)
        down = self.round_down(mkt)
        if up.subtract(self).abs().value < down.subtract(self).abs().value:
            return up
        return down

    def to_cash(self, mkt: IMarketConversion) -> Decimal:
        """Convert this price to a cash value."""
        return self._value * mkt.get_point_value()

    # --- Comparison -------------------------------------------------------

    def compare_to(self, other: Price | None) -> int:
        """Compare to another Price. Returns -1, 0, or 1."""
        if other is None:
            return 1
        if self._value < other._value:
            return -1
        elif self._value > other._value:
            return 1
        return 0

    def __lt__(self, other: Price) -> bool:
        if not isinstance(other, Price):
            return NotImplemented
        return self._value < other._value

    def __le__(self, other: Price) -> bool:
        if not isinstance(other, Price):
            return NotImplemented
        return self._value <= other._value

    def __gt__(self, other: Price) -> bool:
        if not isinstance(other, Price):
            return NotImplemented
        return self._value > other._value

    def __ge__(self, other: Price) -> bool:
        if not isinstance(other, Price):
            return NotImplemented
        return self._value >= other._value

    # --- Equality / repr --------------------------------------------------

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Price):
            return NotImplemented
        return self._value == other._value

    def __hash__(self) -> int:
        return hash(self._value)

    def __repr__(self) -> str:
        return f"Price({self._value})"

    def __str__(self) -> str:
        if self._value == 0:
            return "0"
        return self._value.normalize().to_eng_string()


Zero: Price = Price(0)
"""Singleton zero price (mirrors Java `Price.Zero`)."""

# MaxValue/MinValue use object.__setattr__ directly to bypass _quantize
# (which would overflow the default decimal context for these huge sentinels).
MaxValue: Price = object.__new__(Price)
object.__setattr__(MaxValue, "_value", _MAX_DECIMAL)

MinValue: Price = object.__new__(Price)
object.__setattr__(MinValue, "_value", _MIN_DECIMAL)
