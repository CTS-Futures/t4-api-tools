"""Tests for VPT (Variable Price Tick) tree — ported from VPTTests.java."""

from decimal import Decimal

from t4login.definitions.priceconversion.price import Price
from t4login.definitions.priceconversion.vpt import VPT


def test_should_convert_with_only_default_numerator_base_1() -> None:
    vpt = VPT("1;", "TEST", Price.of(1), None)
    assert vpt.get_is_valid()

    for i in range(-100, 101):
        price = Price.of(i)
        assert Decimal(i) == vpt.price_to_increments(price), f"i={i}"
        assert price == vpt.increments_to_price(i), f"i={i}"


def test_should_convert_with_only_default_numerator_base_5() -> None:
    vpt = VPT("5;", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    for i in range(-100, 101):
        e = 5 * i
        price = Price.of(e)
        assert Decimal(i) == vpt.price_to_increments(price), f"i={i}"
        assert price == vpt.increments_to_price(i), f"i={i}"


def test_should_convert_with_simple_limits() -> None:
    vpt = VPT("5;P<-100=25;P>100=25", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    for i in range(-150, 151):
        if i > 20:
            e = 100 + 25 * (i - 20)
        elif i < -20:
            e = -100 + 25 * (i + 20)
        else:
            e = 5 * i

        price = Price.of(e)
        assert Decimal(i) == vpt.price_to_increments(price), f"i={i}, price={e}"
        assert price == vpt.increments_to_price(i), f"i={i}"


def test_should_convert_with_many_limits() -> None:
    vpt = VPT("5;P<-100=10;P>100=10;P<-200=20;P>200=20;P>300=50; ", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    for i in range(-150, 151):
        if i > 35:
            e = 300 + 50 * (i - 35)
        elif i > 30:
            e = 200 + 20 * (i - 30)
        elif i > 20:
            e = 100 + 10 * (i - 20)
        elif i < -30:
            e = -200 + 20 * (i + 30)
        elif i < -20:
            e = -100 + 10 * (i + 20)
        else:
            e = 5 * i

        price = Price.of(e)
        assert Decimal(i) == vpt.price_to_increments(price), f"i={i}, price={e}"
        assert price == vpt.increments_to_price(i), f"i={i}"


def test_should_return_proper_increment_for_price() -> None:
    vpt = VPT("5;P<-100=10;P>100=10;P<-200=20;P>200=20;P>300=50; ", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    assert Decimal(5) == vpt.get_increment_value_for_price(Price.of(0))
    assert Decimal(5) == vpt.get_increment_value_for_price(Price.of(50))
    assert Decimal(5) == vpt.get_increment_value_for_price(Price.of(-50))
    assert Decimal(5) == vpt.get_increment_value_for_price(Price.of(-100))
    assert Decimal(5) == vpt.get_increment_value_for_price(Price.of(100))

    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(-101))
    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(-110))
    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(-200))
    assert Decimal(20) == vpt.get_increment_value_for_price(Price.of(-20000))
    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(101))
    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(110))
    assert Decimal(10) == vpt.get_increment_value_for_price(Price.of(200))

    assert Decimal(20) == vpt.get_increment_value_for_price(Price.of(201))
    assert Decimal(20) == vpt.get_increment_value_for_price(Price.of(299))
    assert Decimal(20) == vpt.get_increment_value_for_price(Price.of(300))

    assert Decimal(50) == vpt.get_increment_value_for_price(Price.of(301))
    assert Decimal(50) == vpt.get_increment_value_for_price(Price.of(301000))


def test_should_return_proper_increment_for_increments() -> None:
    vpt = VPT("5;P<-100=10;P>100=10;P<-200=20;P>200=20;P>300=50; ", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    assert Decimal(5) == vpt.get_increment_value_for_increments(Decimal(0))
    assert Decimal(5) == vpt.get_increment_value_for_increments(Decimal(-15))
    assert Decimal(5) == vpt.get_increment_value_for_increments(Decimal(15))
    assert Decimal(5) == vpt.get_increment_value_for_increments(Decimal(-20))
    assert Decimal(5) == vpt.get_increment_value_for_increments(Decimal(20))

    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(-21))
    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(-25))
    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(-30))
    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(21))
    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(29))
    assert Decimal(10) == vpt.get_increment_value_for_increments(Decimal(30))

    assert Decimal(20) == vpt.get_increment_value_for_increments(Decimal(31))
    assert Decimal(20) == vpt.get_increment_value_for_increments(Decimal(32))
    assert Decimal(20) == vpt.get_increment_value_for_increments(Decimal(34))
    assert Decimal(20) == vpt.get_increment_value_for_increments(Decimal(35))

    assert Decimal(50) == vpt.get_increment_value_for_increments(Decimal(36))
    assert Decimal(50) == vpt.get_increment_value_for_increments(Decimal(100))


def test_should_properly_add_increments() -> None:
    vpt = VPT("5;P<-100=10;P>100=10;P<-200=20;P>200=20;P>300=50; ", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()

    assert Price.of(0) == vpt.add_increments(Price.of(0), Decimal(0))
    assert Price.of(5) == vpt.add_increments(Price.of(0), Decimal(1))
    assert Price.of(-5) == vpt.add_increments(Price.of(0), Decimal(-1))
    assert Price.of(50) == vpt.add_increments(Price.of(0), Decimal(10))
    assert Price.of(-50) == vpt.add_increments(Price.of(0), Decimal(-10))
    assert Price.of(100) == vpt.add_increments(Price.of(0), Decimal(20))
    assert Price.of(-100) == vpt.add_increments(Price.of(0), Decimal(-20))

    assert Price.of(20) == vpt.add_increments(Price.of(20), Decimal(0))
    assert Price.of(25) == vpt.add_increments(Price.of(20), Decimal(1))
    assert Price.of(15) == vpt.add_increments(Price.of(20), Decimal(-1))
    assert Price.of(70) == vpt.add_increments(Price.of(20), Decimal(10))
    assert Price.of(-30) == vpt.add_increments(Price.of(20), Decimal(-10))
    assert Price.of(140) == vpt.add_increments(Price.of(20), Decimal(20))
    assert Price.of(-80) == vpt.add_increments(Price.of(20), Decimal(-20))

    # Verify add_increments == increments_to_price(price_to_increments(price) + delta)
    expected = vpt.increments_to_price(vpt.price_to_increments(Price.of(450)) - Decimal(100))
    assert expected == vpt.add_increments(Price.of(450), Decimal(-100))


def test_should_properly_subtract_increment() -> None:
    vpt = VPT("5;P<-500=25;P>500=25;", "TEST", Price.of(5), None)
    assert vpt.get_is_valid()
    assert Price.of(625) == vpt.add_increments(Price.of(650), Decimal(-1))


def test_with_min_cab_price() -> None:
    vpt = VPT("", "XCME_FOp OZN (U17C 97)", Price.of(15625).divide(1000000), Price.of("0.007"))

    assert Price.of(0) == vpt.increments_to_price(0)
    assert Price.of("0.007") == vpt.increments_to_price(1)
    assert Price.of("0.015625") == vpt.increments_to_price(2)
    assert Price.of("0.03125") == vpt.increments_to_price(3)
    assert Price.of("0.046875") == vpt.increments_to_price(4)
    assert Price.of("0.0625") == vpt.increments_to_price(5)

    vpt2 = VPT("", "XCME_AgOp CB (Q17C 114000)", Price.of(25).divide(1), Price.of("12.5"))

    assert Price.of(0) == vpt2.increments_to_price(0)
    assert Price.of("12.5") == vpt2.increments_to_price(1)
    assert Price.of(25) == vpt2.increments_to_price(2)
    assert Price.of(50) == vpt2.increments_to_price(3)
    assert Price.of(75) == vpt2.increments_to_price(4)
    assert Price.of(100) == vpt2.increments_to_price(5)
