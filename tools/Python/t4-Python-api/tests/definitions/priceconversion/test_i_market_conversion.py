"""Test that a concrete class satisfying IMarketConversion is recognised."""

from decimal import Decimal

from t4login.definitions.priceconversion.i_market_conversion import IMarketConversion
from t4login.definitions.priceconversion.price import Price
from t4login.definitions.priceconversion.vpt import VPT


class _FakeMarket:
    """Minimal concrete satisfying the Protocol."""

    def get_market_id(self) -> str:
        return "ESM6"

    def get_denominator(self) -> int:
        return 100

    def get_price_code(self) -> str:
        return "A"

    def get_min_price_increment(self) -> Price:
        return Price("0.25")

    def get_vpt(self) -> VPT | None:
        return None

    def get_min_cab_price(self) -> Price | None:
        return None

    def get_real_decimals(self) -> int:
        return 2

    def get_clearing_decimals(self) -> int:
        return 2

    def get_point_value(self) -> Decimal:
        return Decimal("50")

    def get_yield_years(self) -> int | None:
        return None

    def get_yield_par_value(self) -> float | None:
        return None

    def get_yield_rate(self) -> float | None:
        return None

    def get_yield_value_denominator(self) -> int | None:
        return None

    def get_yield_redemption(self) -> float | None:
        return None

    def get_yield_payments_per_year(self) -> float | None:
        return None

    def get_yield_basis(self) -> int | None:
        return None


def _assert_protocol(obj: IMarketConversion) -> None:
    """Helper that type-checks but also runs at runtime."""
    assert obj.get_market_id() == "ESM6"


def test_fake_satisfies_protocol() -> None:
    _assert_protocol(_FakeMarket())
