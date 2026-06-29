"""Port of ``com.t4login.definitions.priceconversion.VPT``.

Variable Price Tick (VPT) allows exchanges to define *non-uniform* minimum
price increments: different tick sizes depending on the current price level.

Spec format
-----------
A VPT spec is a semicolon-delimited string::

    "<base_increment>[;P><limit>=<increment>][;P<<limit>=<increment>]..."

Examples::

    "25"                    # uniform 25-unit tick
    "25;P>100=50"           # tick = 25 below 100, tick = 50 above 100
    "5;P<-100=25;P>100=25" # tick = 5 between -100 and 100, 25 outside

Implementation
--------------
The spec is compiled into a binary tree of ``_VPTLimit`` nodes.  Each node
covers a price range and stores the tick size for that range; left/right
children handle prices below/above the node's limit.  Traversal starts at
the root and recurses until the price falls within the current node's range.

If the spec cannot be parsed (empty spec or unknown prefix), the tree falls
back to a single root node with ``Price(1)`` as the tick size and
``get_is_valid()`` returns ``False``.  Callers should check ``get_is_valid()``
before using VPT results and fall back to the market's
``min_price_increment`` when the spec is invalid.
"""

from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from t4login.definitions.priceconversion.price import MaxValue, MinValue, Price


class _LimitDir:
    GreaterThan = "GreaterThan"
    LessThan = "LessThan"


class _VPTLimit:
    """Internal binary tree node for VPT price-tier traversal.

    Each node represents a price range [left_limit, right_limit].  ``left``
    and ``right`` children handle prices outside that range:

    * ``right`` child — prices *above* ``right_limit``.
    * ``left``  child — prices *below* ``left_limit``.

    ``left_nums`` and ``right_nums`` cache the accumulated increment counts at
    the boundary prices so traversal can avoid recomputing them on every call.
    """

    __slots__ = (
        "min_price_increment",
        "left_limit",
        "right_limit",
        "left_nums",
        "right_nums",
        "left",
        "right",
    )

    def __init__(self, min_price_increment: Price, direction: str | None = None) -> None:
        self.min_price_increment = min_price_increment
        self.left: _VPTLimit | None = None
        self.right: _VPTLimit | None = None

        if direction is None:
            # Root node
            self.left_limit: Price | None = MinValue
            self.right_limit: Price | None = MaxValue
            self.left_nums: Decimal = MinValue.value
            self.right_nums: Decimal = MaxValue.value
        elif direction == _LimitDir.GreaterThan:
            self.left_limit = None
            self.right_limit = MaxValue
            self.left_nums = Decimal(1)
            self.right_nums = MaxValue.value
        else:  # LessThan
            self.left_limit = MinValue
            self.right_limit = None
            self.left_nums = MinValue.value
            self.right_nums = Decimal(1)

    def add_limit(self, direction: str, limit: Price, num: Price) -> None:
        if direction == _LimitDir.GreaterThan:
            if self.right_limit is not None and self.right_limit == MaxValue:
                self.right_limit = limit
                self.right_nums = self.right_limit.value / self.min_price_increment.value
                self.right = _VPTLimit(num, direction)
            elif self.right_limit is not None and limit > self.right_limit:
                assert self.right is not None
                self.right.add_limit(direction, limit.subtract(self.right_limit), num)
            else:
                temp = self.right
                self.right = _VPTLimit(num, direction)
                assert self.right_limit is not None
                self.right.right_limit = self.right_limit.subtract(limit)
                self.right.right_nums = self.right.right_limit.value / self.right.min_price_increment.value
                self.right_limit = limit
                self.right_nums = self.right_limit.value / self.min_price_increment.value
                self.right.right = temp
        else:  # LessThan
            if self.left_limit is not None and self.left_limit == MinValue:
                self.left_limit = limit
                self.left_nums = self.left_limit.value / self.min_price_increment.value
                self.left = _VPTLimit(num, direction)
            elif self.left_limit is not None and limit < self.left_limit:
                assert self.left is not None
                self.left.add_limit(direction, limit.subtract(self.left_limit), num)
            else:
                temp = self.left
                self.left = _VPTLimit(num, direction)
                assert self.left_limit is not None
                self.left.left_limit = self.left_limit.subtract(limit)
                self.left.left_nums = self.left_limit.value / self.left.min_price_increment.value
                self.left_limit = limit
                self.left_nums = self.left_limit.value / self.min_price_increment.value
                self.left.left = temp

    def get_increments(self, price: Price) -> Decimal:
        if self.right_limit is not None and price > self.right_limit:
            assert self.right is not None
            return self.right_nums + self.right.get_increments(price.subtract(self.right_limit))
        elif self.left_limit is not None and price < self.left_limit:
            assert self.left is not None
            return self.left_nums + self.left.get_increments(price.subtract(self.left_limit))
        else:
            return price.value / self.min_price_increment.value

    def get_price(self, increments: Decimal) -> Price:
        if increments > self.right_nums:
            assert self.right is not None and self.right_limit is not None
            return self.right_limit.add(self.right.get_price(increments - self.right_nums))
        elif increments < self.left_nums:
            assert self.left is not None and self.left_limit is not None
            return self.left_limit.add(self.left.get_price(increments - self.left_nums))
        else:
            return Price(increments * self.min_price_increment.value)

    def get_increment_for_price(self, price: Price) -> Decimal:
        if self.right_limit is not None and price > self.right_limit:
            assert self.right is not None
            return self.right.get_increment_for_price(price.subtract(self.right_limit))
        elif self.left_limit is not None and price < self.left_limit:
            assert self.left is not None
            return self.left.get_increment_for_price(price.subtract(self.left_limit))
        else:
            return self.min_price_increment.value

    def get_increment_for_increments(self, increments: Decimal) -> Decimal:
        if increments > self.right_nums:
            assert self.right is not None
            return self.right.get_increment_for_increments(increments - self.right_nums)
        elif increments < self.left_nums:
            assert self.left is not None
            return self.left.get_increment_for_increments(increments - self.left_nums)
        else:
            return self.min_price_increment.value

    def is_whole_increment(self, price: Price) -> bool:
        if self.right is not None and self.right_limit is not None and price > self.right_limit:
            return self.right.is_whole_increment(price.subtract(self.right_limit))
        elif self.left is not None and self.left_limit is not None and price < self.left_limit:
            return self.left.is_whole_increment(price.subtract(self.left_limit))
        else:
            return price.value % self.min_price_increment.value == 0


class VPT:
    """Variable Price Tick tree.

    Parses a VPT specification string (see module docstring for the format)
    and builds a ``_VPTLimit`` binary tree that maps between absolute prices
    and increment counts.

    Usage::

        vpt = VPT("25;P>100=50", base_increment=Price(25))
        if vpt.get_is_valid():
            result = vpt.add_increments(Price(90), Decimal(3))  # 90 + 3 steps

    Attributes:
        spec:            The original spec string.
        market_id:       Optional market identifier for diagnostics.
        base_increment:  The fallback tick size (equals the first spec token).
        min_cab_price:   Optional cab (minimum cabinet) price for options markets.
    """

    __slots__ = ("spec", "market_id", "base_increment", "min_cab_price", "_is_valid", "_vpt")

    def __init__(
        self,
        vpt_spec: str,
        market_id: str = "",
        base_increment: Price | None = None,
        min_cab_price: Price | None = None,
    ) -> None:
        self.spec = vpt_spec if vpt_spec is not None else ""
        self.market_id = market_id
        self.base_increment = base_increment if base_increment is not None else Price(1)
        self.min_cab_price = min_cab_price
        self._is_valid = False
        self._vpt: _VPTLimit

        try:
            parts = self.spec.split(";")
            if len(parts) == 1 and parts[0] == "":
                parts = []

            # Get the default increment from the spec
            increment = self.base_increment
            if len(parts) > 0:
                increment = Price(Decimal(parts[0]))

            # Create root node
            self._vpt = _VPTLimit(increment)

            # Min cab price handling
            if min_cab_price is not None and min_cab_price < increment:
                self._vpt.add_limit(_LimitDir.GreaterThan, Price(0), min_cab_price)
                self._vpt.add_limit(_LimitDir.GreaterThan, min_cab_price, increment.subtract(min_cab_price))
                self._vpt.add_limit(_LimitDir.GreaterThan, increment, increment)

            # Process remaining limit rules
            for i in range(1, len(parts)):
                lim_parts = parts[i].split("=")
                if len(lim_parts) == 2:
                    limit_price = Price(Decimal(lim_parts[0][2:]))
                    limit_increment = Price(Decimal(lim_parts[1]))
                    prefix = lim_parts[0][:2].upper()

                    if prefix == "P>":
                        self._vpt.add_limit(_LimitDir.GreaterThan, limit_price, limit_increment)
                    elif prefix == "P<":
                        self._vpt.add_limit(_LimitDir.LessThan, limit_price, limit_increment)
                    else:
                        self._is_valid = False
                        return

            self._is_valid = True

        except Exception:
            self._is_valid = False
            self._vpt = _VPTLimit(Price(1))

    # Keep backward-compatible attribute access for code that used Phase-1 slots
    @property
    def vpt(self) -> str:
        return self.spec

    @property
    def min_price_increment(self) -> Price:
        return self.base_increment

    def get_is_valid(self) -> bool:
        return self._is_valid

    def is_whole_increment(self, price: Price) -> bool:
        return self._vpt.is_whole_increment(price)

    def price_to_increments(self, price: Price) -> Decimal:
        return self._vpt.get_increments(price)

    def increments_to_price(self, increments: int | Decimal) -> Price:
        inc_dec = Decimal(increments) if not isinstance(increments, Decimal) else increments
        return self._vpt.get_price(inc_dec)

    def get_increment_value_for_price(self, price: Price) -> Decimal:
        return self._vpt.get_increment_for_price(price)

    def get_increment_value_for_increments(self, increments: Decimal) -> Decimal:
        return self._vpt.get_increment_for_increments(increments)

    def add_increments(self, price: Price, increments: Decimal) -> Price:
        return self.increments_to_price(self.price_to_increments(price) + increments)

    def __repr__(self) -> str:
        return f"VPT(spec={self.spec!r}, market_id={self.market_id!r})"
