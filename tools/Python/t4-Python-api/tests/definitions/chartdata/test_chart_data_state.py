"""Tests for ChartDataState — verifies defaults, IMarketConversion, and module empty."""

from decimal import Decimal

from t4login.datetime_.n_date_time import MinValue as NDT_MinValue
from t4login.definitions.bid_offer import BidOffer
from t4login.definitions.chartdata.chart_data_change import ChartDataChange
from t4login.definitions.chartdata.chart_data_state import ChartDataState, empty
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price
from t4login.definitions.priceconversion.price import Zero as PriceZero


def test_default_construction() -> None:
    s = ChartDataState()
    assert s.Change is ChartDataChange.NONE
    assert s.TradeDate == NDT_MinValue
    assert s.TradeDateTicks == 0
    assert s.MarketDefined is False
    assert s.MarketID == ""
    assert s.Numerator == 0
    assert s.Denominator == 0
    assert s.LastTradePrice == PriceZero
    assert s.AtBidOrOffer is BidOffer.Undefined
    assert s.Mode is MarketMode.Undefined
    assert s.OrderVolumes == []


def test_bar_defaults_are_price_zero() -> None:
    s = ChartDataState()
    assert s.BarOpenPrice == PriceZero
    assert s.BarHighPrice == PriceZero
    assert s.BarLowPrice == PriceZero
    assert s.BarClosePrice == PriceZero


def test_empty_singleton() -> None:
    assert empty.Change is ChartDataChange.NONE
    assert empty.MarketID == ""


def test_get_min_price_increment_computes_lazily() -> None:
    s = ChartDataState()
    s.Numerator = 1
    s.Denominator = 4
    mpi = s.get_min_price_increment()
    assert mpi == Price("0.25")
    # Second call returns cached value
    assert s.get_min_price_increment() is mpi


def test_get_point_value_computes_lazily() -> None:
    s = ChartDataState()
    s.Numerator = 1
    s.Denominator = 4
    s.TickValue = 12.50
    pv = s.get_point_value()
    # TickValue / Numerator * Denominator = 12.50 / 1 * 4 = 50
    assert pv == Decimal("50")


def test_protocol_null_methods() -> None:
    s = ChartDataState()
    assert s.get_vpt() is None
    assert s.get_min_cab_price() is None
    assert s.get_yield_years() is None
    assert s.get_yield_par_value() is None
    assert s.get_yield_rate() is None
    assert s.get_yield_value_denominator() is None
    assert s.get_yield_redemption() is None
    assert s.get_yield_payments_per_year() is None
    assert s.get_yield_basis() is None


def test_mutability() -> None:
    s = ChartDataState()
    s.Change = ChartDataChange.Trade
    s.MarketID = "ESM6"
    s.LastTradePrice = Price("100.25")
    assert s.Change is ChartDataChange.Trade
    assert s.MarketID == "ESM6"
    assert s.LastTradePrice == Price("100.25")
