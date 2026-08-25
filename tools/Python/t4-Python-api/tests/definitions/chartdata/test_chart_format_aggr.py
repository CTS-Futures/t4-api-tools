"""Tests for ChartFormatAggr — Bar dataclass, MarketDefinition, and CTAG constants."""

from decimal import Decimal

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_format_aggr import (
    CTAG_BAR,
    CTAG_BAR_DELTA,
    CTAG_MARKET_DEFINITION,
    CTAG_MARKET_MODE,
    CTAG_MARKET_SWITCH,
    CTAG_OPEN_INTEREST,
    CTAG_SETTLEMENT_PRICE,
    CTAG_SOF,
    CTAG_TRADEDATE_SWITCH,
    CVAL_T4BINAGGR_VERSION,
    Bar,
    MarketDefinition,
)
from t4login.definitions.priceconversion.price import Price

# --- CTAG constants ---


def test_ctag_values() -> None:
    assert CVAL_T4BINAGGR_VERSION == 1
    assert CTAG_SOF == 1
    assert CTAG_MARKET_DEFINITION == 2
    assert CTAG_MARKET_SWITCH == 3
    assert CTAG_TRADEDATE_SWITCH == 4
    assert CTAG_BAR_DELTA == 10
    assert CTAG_BAR == 11
    assert CTAG_MARKET_MODE == 20
    assert CTAG_OPEN_INTEREST == 21
    assert CTAG_SETTLEMENT_PRICE == 22


# --- Bar ---


def test_bar_construction() -> None:
    td = NDateTime(2024, 3, 15)
    t = NDateTime(2024, 3, 15, 10, 30, 0)
    ct = NDateTime(2024, 3, 15, 10, 31, 0)
    bar = Bar(
        TradeDate=td,
        Time=t,
        CloseTime=ct,
        MarketID="ESM6",
        OpenPrice=Price("100.25"),
        HighPrice=Price("101.00"),
        LowPrice=Price("99.50"),
        ClosePrice=Price("100.75"),
        Volume=1000,
        VolumeAtBid=400,
        VolumeAtOffer=600,
        Trades=50,
        TradesAtBid=20,
        TradesAtOffer=30,
    )
    assert bar.MarketID == "ESM6"
    assert bar.Volume == 1000
    assert bar.OpenPrice == Price("100.25")


# --- MarketDefinition ---


def test_market_definition_min_price_increment() -> None:
    md = MarketDefinition(
        MarketID="ESM6",
        Numerator=1,
        Denominator=4,
        PriceCode="A",
        TickValue=Decimal("12.50"),
        VPT_str="",
        MinCabPrice=None,
    )
    assert md.get_market_id() == "ESM6"
    assert md.get_denominator() == 4
    # 1/4 = 0.25
    assert md.get_min_price_increment() == Price("0.25")
    assert md.get_vpt() is None
    assert md.get_min_cab_price() is None


def test_market_definition_with_vpt() -> None:
    cab = Price("0.01")
    md = MarketDefinition(
        MarketID="CLM6",
        Numerator=1,
        Denominator=100,
        PriceCode="B",
        TickValue=Decimal("10.00"),
        VPT_str="1=0.01",
        MinCabPrice=cab,
    )
    vpt = md.get_vpt()
    assert vpt is not None
    assert vpt.vpt == "1=0.01"
    assert vpt.market_id == "CLM6"
    assert vpt.min_cab_price == cab


def test_market_definition_protocol_defaults() -> None:
    md = MarketDefinition(
        MarketID="X",
        Numerator=1,
        Denominator=1,
        PriceCode="",
        TickValue=Decimal(0),
    )
    assert md.get_real_decimals() == 0
    assert md.get_clearing_decimals() == 0
    assert md.get_point_value() == Decimal(0)
    assert md.get_yield_years() == 0
    assert md.get_yield_par_value() == 0.0
    assert md.get_yield_rate() == 0.0
    assert md.get_yield_value_denominator() == 0
    assert md.get_yield_redemption() == 0.0
    assert md.get_yield_payments_per_year() == 0.0
    assert md.get_yield_basis() == 0
