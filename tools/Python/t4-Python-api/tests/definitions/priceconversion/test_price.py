"""Tests for Price — construction, arithmetic, comparisons, and market-aware operations."""

from decimal import Decimal


from t4login.definitions.priceconversion.price import Price, Scale, Zero
from t4login.definitions.priceconversion.vpt import VPT


def test_scale_constant() -> None:
    assert Scale == 18


def test_zero_singleton() -> None:
    assert Zero == Price(0)
    assert Zero == Price(Decimal("0"))


def test_construct_from_int_float_str_decimal() -> None:
    assert Price(1) == Price(Decimal("1"))
    assert Price(1.5) == Price(Decimal("1.5"))
    assert Price("2.25") == Price(Decimal("2.25"))


def test_value_quantized_to_scale() -> None:
    # Decimal carries trailing zeros after quantize
    assert Price(1).value == Decimal("1").quantize(Decimal(1).scaleb(-Scale))


def test_equality_only_against_price() -> None:
    assert Price(1) != 1
    assert Price(1) != "1"
    assert Price(1) == Price(1)


def test_hash_matches_equality() -> None:
    assert hash(Price(3)) == hash(Price(3))


def test_arithmetic_methods() -> None:
    assert Price(1).add(Price(2)) == Price(3)
    assert Price(5).subtract(Price(2)) == Price(3)
    assert Price(3).multiply(Price(2)) == Price(6)
    assert Price(6).divide(Price(2)) == Price(3)
    assert Price(10).multiply(Decimal("0.5")) == Price(5)
    assert Price(10).divide(4) == Price("2.5")


def test_abs_and_negated() -> None:
    assert Price(-5).abs() == Price(5)
    assert Price(5).abs() == Price(5)
    assert Price(3).negated() == Price(-3)


def test_comparison_operators() -> None:
    assert Price(1) < Price(2)
    assert Price(2) > Price(1)
    assert Price(1) <= Price(1)
    assert Price(1) >= Price(1)
    assert Price(1).compare_to(Price(2)) == -1
    assert Price(2).compare_to(Price(1)) == 1
    assert Price(1).compare_to(Price(1)) == 0
    assert Price(1).compare_to(None) == 1


# ---------------------------------------------------------------------------
# add_increments — VPT routing
# ---------------------------------------------------------------------------
# The critical invariant: when the market has a *valid* VPT specification,
# add_increments must delegate to the VPT tree (non-uniform ticks).  When
# there is no VPT, or the spec is invalid, it falls back to uniform
# min_price_increment arithmetic.  The test below verifies both paths using
# a real ChartDataState (which implements IMarketConversion).


class _FakeMkt:
    """Minimal IMarketConversion stub for add_increments tests."""

    def __init__(self, numerator: int, denominator: int, vpt_spec: str = "") -> None:
        self._num = numerator
        self._den = denominator
        self._vpt = VPT(vpt_spec, base_increment=Price(Decimal(numerator) / Decimal(denominator))) if vpt_spec else None

    def get_market_id(self) -> str:
        return ""

    def get_denominator(self) -> int:
        return self._den

    def get_price_code(self) -> str:
        return ""

    def get_min_price_increment(self) -> Price:
        from decimal import ROUND_HALF_EVEN
        incr = (Decimal(self._num) / Decimal(self._den)).quantize(
            Decimal(1).scaleb(-Scale), rounding=ROUND_HALF_EVEN
        )
        return Price(incr)

    def get_vpt(self) -> VPT | None:
        return self._vpt

    def get_min_cab_price(self) -> Price | None:
        return None

    def get_real_decimals(self) -> int:
        return 0

    def get_clearing_decimals(self) -> int:
        return 0

    def get_point_value(self) -> Decimal:
        return Decimal(1)

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


def test_add_increments_no_vpt_uses_uniform_tick() -> None:
    """Without a VPT, each increment step equals min_price_increment."""
    mkt = _FakeMkt(numerator=25, denominator=1)  # tick = 25
    # 100 + 3*25 = 175
    assert Price(100).add_increments(mkt, 3) == Price(175)


def test_add_increments_invalid_vpt_falls_back_to_uniform() -> None:
    """An unparseable VPT spec produces is_valid=False → uniform fallback."""
    mkt = _FakeMkt(numerator=25, denominator=1, vpt_spec="GARBAGE;NOT=VALID")
    assert VPT("GARBAGE;NOT=VALID", base_increment=Price(25)).get_is_valid() is False
    # Should not crash; should use uniform increment of 25
    assert Price(100).add_increments(mkt, 2) == Price(150)


def test_add_increments_valid_vpt_delegates_to_vpt_tree() -> None:
    """A valid VPT with a non-uniform tier must produce a VPT-routed result.

    Spec ``"25;P>200=50"`` means:
      - default tick = 25
      - for prices > 200, tick = 50
    So from 175 + 2 increments:
      - first increment: 175→200 (step 25)
      - second increment: 200→250 (step 50)
    Result = 250.
    """
    spec = "25;P>200=50"
    vpt = VPT(spec, base_increment=Price(25))
    assert vpt.get_is_valid() is True

    mkt = _FakeMkt(numerator=25, denominator=1, vpt_spec=spec)
    result = Price(175).add_increments(mkt, 2)
    assert result == Price(250)
