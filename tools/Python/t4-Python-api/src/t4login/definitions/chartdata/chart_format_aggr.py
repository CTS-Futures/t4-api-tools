"""Port of `com.t4login.definitions.chartdata.ChartFormatAggr`.

Contains:
- `Bar` dataclass (14 fields) representing a single aggregated bar.
- `MarketDefinition` dataclass implementing the `IMarketConversion` protocol,
  with lazy-computed `min_price_increment` and `vpt`.
- Module-level CTAG constants for the aggregated binary format.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, Decimal

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.priceconversion.price import Price, Scale
from t4login.definitions.priceconversion.vpt import VPT

# --- Binary format version / tags for the aggregated (T4BinAggr) format -------
CVAL_T4BINAGGR_VERSION: int = 1

CTAG_SOF: int = 1                # Start of file: format version
CTAG_MARKET_DEFINITION: int = 2  # Market instrument metadata
CTAG_MARKET_SWITCH: int = 3      # Switch active market (multi-market streams)
CTAG_TRADEDATE_SWITCH: int = 4   # Switch to a new trade date
CTAG_BAR_DELTA: int = 10         # Bar record with prices as delta increments from low
CTAG_BAR: int = 11               # Bar record with absolute decimal prices
CTAG_MARKET_MODE: int = 20       # Market mode change event
CTAG_OPEN_INTEREST: int = 21     # Open interest update
CTAG_SETTLEMENT_PRICE: int = 22  # Settlement price event


# --- Bar ----------------------------------------------------------------------


@dataclass
class Bar:
    """Aggregated OHLCV bar (mirrors Java `ChartFormatAggr.Bar`)."""

    TradeDate: NDateTime
    Time: NDateTime
    CloseTime: NDateTime
    MarketID: str
    OpenPrice: Price
    HighPrice: Price
    LowPrice: Price
    ClosePrice: Price
    Volume: int
    VolumeAtBid: int
    VolumeAtOffer: int
    Trades: int
    TradesAtBid: int
    TradesAtOffer: int


# --- MarketDefinition ---------------------------------------------------------


@dataclass
class MarketDefinition:
    """Market parameters for price conversion (mirrors Java inner class).

    Implements the ``IMarketConversion`` protocol via explicit getter methods.
    ``min_price_increment`` and ``vpt_obj`` are lazily derived from the
    constructor args.
    """

    MarketID: str
    Numerator: int
    Denominator: int
    PriceCode: str
    TickValue: Decimal
    VPT_str: str = ""
    MinCabPrice: Price | None = None

    # Private cached derived fields (excluded from __init__ positional args)
    _min_price_increment: Price = field(init=False, repr=False)
    _vpt: VPT | None = field(init=False, repr=False)

    def __post_init__(self) -> None:
        num_dec = Decimal(self.Numerator)
        den_dec = Decimal(self.Denominator)
        incr = num_dec / den_dec
        incr = incr.quantize(Decimal(1).scaleb(-Scale), rounding=ROUND_HALF_EVEN)
        self._min_price_increment = Price(incr)

        if (self.VPT_str and len(self.VPT_str) > 0) or self.MinCabPrice is not None:
            self._vpt = VPT(
                self.VPT_str, self.MarketID, self._min_price_increment, self.MinCabPrice
            )
        else:
            self._vpt = None

    # --- IMarketConversion protocol methods -----------------------------------

    def get_market_id(self) -> str:
        return self.MarketID

    def get_denominator(self) -> int:
        return self.Denominator

    def get_price_code(self) -> str:
        return self.PriceCode

    def get_min_price_increment(self) -> Price:
        return self._min_price_increment

    def get_vpt(self) -> VPT | None:
        return self._vpt

    def get_min_cab_price(self) -> Price | None:
        return self.MinCabPrice

    def get_real_decimals(self) -> int:
        return 0

    def get_clearing_decimals(self) -> int:
        return 0

    def get_point_value(self) -> Decimal:
        return Decimal(0)

    def get_yield_years(self) -> int | None:
        return 0

    def get_yield_par_value(self) -> float | None:
        return 0.0

    def get_yield_rate(self) -> float | None:
        return 0.0

    def get_yield_value_denominator(self) -> int | None:
        return 0

    def get_yield_redemption(self) -> float | None:
        return 0.0

    def get_yield_payments_per_year(self) -> float | None:
        return 0.0

    def get_yield_basis(self) -> int | None:
        return 0
