"""Port of `com.t4login.definitions.chartdata.ChartDataState`.

Mutable read-state object populated by the chart data stream readers.
Keeps Java PascalCase field names for 1:1 parity with the deferred readers.
Implements the ``IMarketConversion`` protocol.

This dataclass accumulates decoded field values as the stream readers iterate
through a binary chart data payload. Each time a new record is consumed, the
reader updates the relevant fields on this state object and sets ``Change`` to
indicate what kind of data was just decoded (trade, quote, bar, TPO, etc.).

Consumers can inspect the state after each ``reader.read()`` call to collect
the decoded values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, Decimal

from t4login.datetime_.n_date_time import MinValue as _NDT_MinValue
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.bid_offer import BidOffer
from t4login.definitions.chartdata.chart_data_change import ChartDataChange
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price
from t4login.definitions.priceconversion.price import Scale as _Scale
from t4login.definitions.priceconversion.price import Zero as _PriceZero
from t4login.definitions.priceconversion.vpt import VPT as VPTClass


@dataclass
class ChartDataState:
    """Read state for chart data (mirrors Java class, all fields mutable).

    Groups of fields:
    - **Change type**: Which kind of data was last decoded.
    - **Trade date**: Session date context for the current stream segment.
    - **Market definition**: Instrument metadata (numerator/denominator, tick value, VPT).
    - **Last trade**: Most recent trade price, volume, and attributes.
    - **Bar details**: OHLCV bar data for aggregated time periods.
    - **TPO**: Time-Price Opportunity profile data.
    - **Quote (BBO)**: Best bid/offer prices and depths.
    - **Market mode**: Current session state (pre-open, open, closed, etc.).
    - **Settlement / OI / VWAP**: End-of-day settlement and statistics.
    - **RFQ**: Request-for-quote events.
    - **Incremental state**: Running delta accumulators used by the reader internally.
    """

    # --- Change type ----------------------------------------------------------
    Change: ChartDataChange = ChartDataChange.NONE

    # --- Trade date -----------------------------------------------------------
    TradeDate: NDateTime = field(default_factory=lambda: _NDT_MinValue)
    TradeDateTicks: int = 0

    # --- Market definition ----------------------------------------------------
    MarketDefined: bool = False
    MarketID: str = ""
    Numerator: int = 0
    Denominator: int = 0
    PriceCode: str = ""
    TickValue: float = 0.0
    VPT: str = ""
    MinCabPrice: Price | None = None

    MinPriceIncrement: Price | None = None
    PointValue: Decimal | None = None

    # --- Last trade -----------------------------------------------------------
    LastTTV: int = 0
    LastTimeTicks: int = 0
    # Initialised to zero so delta-tick tags (add/subtract) can be applied
    # safely before the first absolute price tag is seen in the stream.
    LastTradePrice: Price = field(default_factory=lambda: _PriceZero)
    LastPriceIncrements: Decimal = field(default_factory=lambda: Decimal(0))

    TradeVolume: int = 0
    AtBidOrOffer: BidOffer = BidOffer.Undefined
    OrderVolumes: list[int] = field(default_factory=list)
    DueToSpread: bool = False
    OrderVolumeIndex: int = 0

    # --- Bar details ----------------------------------------------------------
    BarStartTime: int = 0
    BarCloseTime: int = 0
    BarOpenPrice: Price = field(default_factory=lambda: _PriceZero)
    BarHighPrice: Price = field(default_factory=lambda: _PriceZero)
    BarLowPrice: Price = field(default_factory=lambda: _PriceZero)
    BarClosePrice: Price = field(default_factory=lambda: _PriceZero)
    BarVolume: int = 0
    BarBidVolume: int = 0
    BarOfferVolume: int = 0
    BarTrades: int = 0
    BarTradesAtBid: int = 0
    BarTradesAtOffer: int = 0

    # --- TPO ------------------------------------------------------------------
    TPOStartTime: int = 0
    TPOBasePrice: Price = field(default_factory=lambda: _PriceZero)
    TPOPrice: Price | None = None
    TPOVolume: int = 0
    TPOVolumeAtBid: int = 0
    TPOVolumeAtOffer: int = 0
    TPOIsOpening: bool = False
    TPOIsClosing: bool = False

    # --- Quote ----------------------------------------------------------------
    # Initialised to zero so delta-quote tags can be applied before the first
    # absolute quote tag arrives in the stream.
    BidPrice: Price = field(default_factory=lambda: _PriceZero)
    BidRealVolume: int = 0
    BidImpliedVolume: int = 0
    OfferPrice: Price = field(default_factory=lambda: _PriceZero)
    OfferRealVolume: int = 0
    OfferImpliedVolume: int = 0

    # --- Market mode ----------------------------------------------------------
    Mode: MarketMode = MarketMode.Undefined

    # --- Settlement / OI / VWAP -----------------------------------------------
    SettlementPrice: Price | None = None
    SettlementHeldPrice: Price | None = None
    ClearedVolume: int = 0
    OpenInterest: int = 0
    VWAP_Price: Price | None = None

    # --- RFQ ------------------------------------------------------------------
    RFQBuySell: BidOffer = BidOffer.Undefined
    RFQVolume: int = 0

    # --- Incremental state (used by readers) ----------------------------------
    LastBarLowPriceIncrements: Decimal = field(default_factory=lambda: Decimal(0))
    LastTPOBasePriceIncrements: Decimal = field(default_factory=lambda: Decimal(0))
    LastBidPriceIncrements: Decimal = field(default_factory=lambda: Decimal(0))

    # --- IMarketConversion protocol methods -----------------------------------

    def get_market_id(self) -> str:
        return self.MarketID

    def get_denominator(self) -> int:
        return self.Denominator

    def get_price_code(self) -> str:
        return self.PriceCode

    def get_min_price_increment(self) -> Price:
        if self.MinPriceIncrement is None or self.MinPriceIncrement == _PriceZero:
            num = Decimal(self.Numerator)
            den = Decimal(self.Denominator)
            incr = num / den
            incr = incr.quantize(Decimal(1).scaleb(-_Scale), rounding=ROUND_HALF_EVEN)
            self.MinPriceIncrement = Price(incr)
        return self.MinPriceIncrement

    def get_vpt(self) -> VPTClass | None:
        return None

    def get_min_cab_price(self) -> Price | None:
        return None

    def get_real_decimals(self) -> int:
        return 0

    def get_clearing_decimals(self) -> int:
        return 0

    def get_point_value(self) -> Decimal:
        if self.PointValue is None or self.PointValue == Decimal(0):
            num = Decimal(self.Numerator)
            tv = Decimal(str(self.TickValue))
            den = Decimal(self.Denominator)
            self.PointValue = (
                tv / num
            ).quantize(Decimal(1).scaleb(-_Scale), rounding=ROUND_HALF_EVEN) * den
        return self.PointValue

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


# Module-level empty instance (mirrors Java `ChartDataState.empty`)
empty: ChartDataState = ChartDataState()
