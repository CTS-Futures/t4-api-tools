"""Port of `com.t4login.definitions.chartdata.ChartDataStreamReader`.

Reads non-aggregated chart data from a binary stream (T4Bin format),
updating a mutable `ChartDataState` object on each `read()` call.

The T4Bin format is used by the ``/chart/tradehistory`` endpoint when
``Accept: application/octet-stream`` is requested. It encodes individual
tick-level events (trades, quotes, mode changes, TPO, settlements) in a
compact binary representation where prices are stored as deltas from
previously decoded values to minimize payload size.

Usage pattern::

    reader = ChartDataStreamReader(stream, trade_date, market_id, data_type)
    while reader.read():
        state = reader.state
        if state.Change == ChartDataChange.Trade:
            # Process trade: state.LastTradePrice, state.TradeVolume, etc.
        elif state.Change == ChartDataChange.Quote:
            # Process BBO update: state.BidPrice, state.OfferPrice, etc.
"""

from __future__ import annotations

from typing import BinaryIO

from t4login.connection.counting_stream import CountingInputStream
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.bid_offer import BidOffer
from t4login.definitions.chartdata.chart_data_change import ChartDataChange
from t4login.definitions.chartdata.chart_data_state import ChartDataState
from t4login.definitions.chartdata.chart_data_type import ChartDataType
from t4login.definitions.chartdata.chart_format import (
    CVAL_T4BIN_VERSION,
    CTAG_BAR_PRICE,
    CTAG_BAR_PRICE_DEC,
    CTAG_BARDATAPOINT_7BIT_DELTA_LOW,
    CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW,
    CTAG_CONSOLIDATED,
    CTAG_HELD_SETTLEMENT_PRICE,
    CTAG_MARKET_CLEARED_VOLUME,
    CTAG_MARKET_DEFINITION,
    CTAG_MARKET_HELD_SETTLEMENT,
    CTAG_MARKET_KEY,
    CTAG_MARKET_MODE,
    CTAG_MARKET_OPEN_INTEREST,
    CTAG_MARKET_RFQ,
    CTAG_MARKET_SETTLEMENT,
    CTAG_MARKET_SWITCH,
    CTAG_MARKET_VWAP,
    CTAG_PRICE_CHANGE,
    CTAG_PRICE_CHANGE_DEC,
    CTAG_QUOTE_7BIT,
    CTAG_QUOTE_NEG_7BIT,
    CTAG_QUOTE_PRICE,
    CTAG_QUOTE_PRICE_DEC,
    CTAG_QUOTE_VOLUME_DELTA,
    CTAG_SETTLEMENT_PRICE,
    CTAG_SOF,
    CTAG_TICKCHANGEDATAPOINT_7BIT,
    CTAG_TICKCHANGEDATAPOINT_NEG_7BIT,
    CTAG_TICKDATAPOINT_7BIT,
    CTAG_TICKDATAPOINT_ALT_7BIT,
    CTAG_TICKDATAPOINT_ALT_NEG_7BIT,
    CTAG_TICKDATAPOINT_NEG_7BIT,
    CTAG_TPO_CLOSE_PRICE,
    CTAG_TPO_DATAPOINT,
    CTAG_TPO_DATAPOINT_CLOSE,
    CTAG_TPO_DATAPOINT_OPEN,
    CTAG_TPO_DATAPOINT_OPENCLOSE,
    CTAG_TPO_OPEN_PRICE,
    CTAG_TPO_OPENCLOSE_PRICE,
    CTAG_TPO_PRICE,
    CTAG_TPO_START,
    CTAG_TPO_START_NEGBASE,
    CTAG_TPO_START_PRICE,
    CTAG_TPO_START_PRICE_DEC,
    CTAG_TRADE_PRICE,
    CTAG_TRADE_PRICE_ALT,
    CTAG_TRADE_PRICE_DEC,
    CTAG_TRADE_PRICE_DEC_ALT,
    CTAG_VWAP_PRICE,
    TRADE_AT_BID,
    TRADE_AT_OFFER,
    TRADE_DUE_TO_SPREAD,
    get_bar_start_time,
)
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price
from t4login.message.reader import (
    read_datetime,
    read_double,
    read_integer,
    read_price,
    read_string,
)
from t4login.util.encoding import (
    decode_7bit_int,
    decode_7bit_long,
    decode_decimal,
)


class ChartDataStreamReader:
    """Reads non-aggregated chart data from a binary T4Bin stream.

    Each call to :meth:`read` consumes one record from the underlying stream
    and updates the mutable :attr:`state` object with the decoded values.
    Returns ``True`` while records remain, ``False`` at end-of-stream.

    Tag categories handled by the internal ``_read_t4bin`` dispatch:

    * **Stream framing** — ``CTAG_SOF``, ``CTAG_CONSOLIDATED``.
    * **Market setup** — ``CTAG_MARKET_SWITCH``, ``CTAG_MARKET_KEY``,
      ``CTAG_MARKET_DEFINITION``.
    * **Ticks / trades** — ``CTAG_TICKDATAPOINT_*`` (7-bit, alt, neg variants),
      ``CTAG_TICKCHANGEDATAPOINT_*``, ``CTAG_TRADE_PRICE*``, ``CTAG_PRICE_CHANGE*``.
    * **Bars** — ``CTAG_BAR_PRICE*``, ``CTAG_BARDATAPOINT_*_DELTA_LOW``.
    * **Quotes (BBO)** — ``CTAG_QUOTE_*``.
    * **TPO (Time-Price Opportunity)** — ``CTAG_TPO_*``.
    * **Market mode** — ``CTAG_MARKET_MODE``.
    * **Settlement / OI / VWAP** — ``CTAG_MARKET_SETTLEMENT*``,
      ``CTAG_SETTLEMENT_PRICE*``, ``CTAG_MARKET_OPEN_INTEREST``,
      ``CTAG_MARKET_CLEARED_VOLUME``, ``CTAG_MARKET_VWAP``, ``CTAG_VWAP_PRICE``.
    * **RFQ** — ``CTAG_MARKET_RFQ``.

    The dispatch is intentionally monolithic (mirroring the Java source 1:1)
    to minimise the risk of behavioural drift during the port.
    """

    TAG: str = "ChartDataStreamReader"

    def __init__(
        self,
        stream: BinaryIO | None,
        trade_date: NDateTime,
        market_id: str,
        data_type: ChartDataType,
    ) -> None:
        if stream is not None:
            self._in = CountingInputStream(stream)
        else:
            self._in: CountingInputStream | None = None

        self._data_type = data_type
        self._market_states: dict[str, ChartDataState] = {}
        self._market_keys: dict[int, str] = {}
        self._is_consolidated: bool = False
        self._eof: bool = False
        self._bin_version: int = CVAL_T4BIN_VERSION

        self._state = self._get_market_state(market_id)
        self._state.TradeDate = trade_date
        self._state.TradeDateTicks = trade_date.ticks
        self._state.MarketID = market_id

    @property
    def state(self) -> ChartDataState:
        return self._state

    def close(self) -> None:
        """Close the underlying stream (no-op if already None)."""
        self._in = None

    def read(self) -> bool:
        """Read the next chart data record.

        Returns True if a record was read, False at end-of-stream.
        """
        return self._read_t4bin()

    # ------------------------------------------------------------------
    # Private: main read loop
    # ------------------------------------------------------------------

    def _read_t4bin(self) -> bool:
        if self._eof or self._in is None:
            return False

        try:
            length = decode_7bit_int(self._in)
        except EOFError:
            self._eof = True
            return False
        self._in.reset_count()

        if length > 0:
            tag = decode_7bit_int(self._in)

            if tag == CTAG_CONSOLIDATED:
                self._is_consolidated = True

            elif tag == CTAG_SOF:
                if length > 12:
                    self._bin_version = read_integer(self._in)
                    self._state.TradeDate = read_datetime(self._in)
                    self._state.TradeDateTicks = self._state.TradeDate.ticks
                else:
                    self._bin_version = 0
                    self._state.TradeDate = read_datetime(self._in)
                    self._state.TradeDateTicks = self._state.TradeDate.ticks

                self._market_states.clear()
                new_state = ChartDataState()
                new_state.MarketID = self._state.MarketID
                new_state.TradeDate = self._state.TradeDate
                new_state.TradeDateTicks = self._state.TradeDateTicks
                self._state = new_state
                self._market_states[self._state.MarketID] = self._state
                self._state.Change = ChartDataChange.TradeDate

            elif tag == CTAG_MARKET_KEY:
                mkt_key = decode_7bit_int(self._in)
                mkt_id = read_string(self._in)
                self._market_keys[mkt_key] = mkt_id
                self._get_market_state(mkt_id)
                self._state.Change = ChartDataChange.NONE

            elif tag == CTAG_MARKET_SWITCH:
                mkt_key = decode_7bit_int(self._in)
                mkt_id = self._market_keys.get(mkt_key, "")
                self._get_market_state(mkt_id)
                self._state.Change = ChartDataChange.MarketSwitch

            elif tag == CTAG_MARKET_DEFINITION:
                mkt_id = read_string(self._in)
                self._get_market_state(mkt_id)
                self._state.MarketDefined = True
                self._state.Numerator = decode_7bit_int(self._in)
                self._state.Denominator = decode_7bit_int(self._in)
                self._state.PriceCode = read_string(self._in)
                self._state.TickValue = read_double(self._in)

                if self._in.get_count() < length:
                    self._state.VPT = read_string(self._in)
                    self._state.MinCabPrice = read_price(self._in)

                self._state.MinPriceIncrement = None
                self._state.PointValue = None
                self._state.Change = ChartDataChange.MarketDefinition

            elif tag == CTAG_TICKDATAPOINT_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = self._state.LastTradePrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._state.OrderVolumes = []
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TICKDATAPOINT_NEG_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = self._state.LastTradePrice.subtract(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._state.OrderVolumes = []
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TRADE_PRICE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastPriceIncrements = self._state.LastPriceIncrements + decode_decimal(self._in)
                    self._state.LastTradePrice = Price.from_increments(self._state, self._state.LastPriceIncrements)
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._state.OrderVolumes = []
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TRADE_PRICE_DEC:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = Price.from_increments(self._state, decode_decimal(self._in))
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._state.OrderVolumes = []
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TICKDATAPOINT_ALT_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = self._state.LastTradePrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._read_order_volumes()
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TICKDATAPOINT_ALT_NEG_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = self._state.LastTradePrice.subtract(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._read_order_volumes()
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TRADE_PRICE_ALT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastPriceIncrements = self._state.LastPriceIncrements + decode_decimal(self._in)
                    self._state.LastTradePrice = Price.from_increments(self._state, self._state.LastPriceIncrements)
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._read_order_volumes()
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TRADE_PRICE_DEC_ALT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.TradeVolume = decode_7bit_int(self._in)
                    self._state.LastTradePrice = Price.from_increments(self._state, decode_decimal(self._in))
                    self._state.LastTTV += decode_7bit_int(self._in)
                    self._read_trade_attrs()
                    self._read_order_volumes()
                    self._state.Change = ChartDataChange.Trade
                else:
                    self._eof = True

            elif tag == CTAG_TICKCHANGEDATAPOINT_7BIT:
                self._state.BarStartTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarCloseTime = self._state.BarStartTime + decode_7bit_long(self._in)
                self._state.BarClosePrice = self._state.BarClosePrice.add(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TickChange

            elif tag == CTAG_TICKCHANGEDATAPOINT_NEG_7BIT:
                self._state.BarStartTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarCloseTime = self._state.BarStartTime + decode_7bit_long(self._in)
                self._state.BarClosePrice = self._state.BarClosePrice.subtract(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TickChange

            elif tag == CTAG_PRICE_CHANGE:
                self._state.BarStartTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarCloseTime = self._state.BarStartTime + decode_7bit_long(self._in)
                self._state.BarClosePrice = self._state.BarClosePrice.add(decode_decimal(self._in))
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TickChange

            elif tag == CTAG_PRICE_CHANGE_DEC:
                self._state.BarStartTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarCloseTime = self._state.BarStartTime + decode_7bit_long(self._in)
                self._state.BarClosePrice = Price(decode_decimal(self._in))
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TickChange

            elif tag == CTAG_BARDATAPOINT_7BIT_DELTA_LOW:
                self._state.BarCloseTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarStartTime = get_bar_start_time(
                    self._state.BarCloseTime, self._state.TradeDateTicks, self._data_type
                )
                bar_open = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                bar_high = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                self._state.BarLowPrice = self._state.BarLowPrice.add(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                bar_close = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                self._state.BarVolume = decode_7bit_int(self._in)
                self._state.BarOpenPrice = bar_open.add(self._state.BarLowPrice)
                self._state.BarHighPrice = bar_high.add(self._state.BarLowPrice)
                self._state.BarClosePrice = bar_close.add(self._state.BarLowPrice)
                self._state.BarBidVolume = decode_7bit_int(self._in)
                self._state.BarOfferVolume = decode_7bit_int(self._in)
                self._state.BarTrades = decode_7bit_int(self._in)
                self._state.BarTradesAtBid = decode_7bit_int(self._in)
                self._state.BarTradesAtOffer = decode_7bit_int(self._in)
                self._state.Change = ChartDataChange.TradeBar

            elif tag == CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW:
                self._state.BarCloseTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarStartTime = get_bar_start_time(
                    self._state.BarCloseTime, self._state.TradeDateTicks, self._data_type
                )
                bar_open = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                bar_high = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                self._state.BarLowPrice = self._state.BarLowPrice.subtract(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                bar_close = Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                self._state.BarVolume = decode_7bit_int(self._in)
                self._state.BarOpenPrice = bar_open.add(self._state.BarLowPrice)
                self._state.BarHighPrice = bar_high.add(self._state.BarLowPrice)
                self._state.BarClosePrice = bar_close.add(self._state.BarLowPrice)
                self._state.BarBidVolume = decode_7bit_int(self._in)
                self._state.BarOfferVolume = decode_7bit_int(self._in)
                self._state.BarTrades = decode_7bit_int(self._in)
                self._state.BarTradesAtBid = decode_7bit_int(self._in)
                self._state.BarTradesAtOffer = decode_7bit_int(self._in)
                self._state.Change = ChartDataChange.TradeBar

            elif tag == CTAG_BAR_PRICE:
                self._state.BarCloseTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarStartTime = get_bar_start_time(
                    self._state.BarCloseTime, self._state.TradeDateTicks, self._data_type
                )
                bar_open_inc = decode_decimal(self._in)
                bar_high_inc = decode_decimal(self._in)
                bar_low_inc = self._state.LastBarLowPriceIncrements + decode_decimal(self._in)
                self._state.LastBarLowPriceIncrements = bar_low_inc
                bar_close_inc = decode_decimal(self._in)

                self._state.BarOpenPrice = Price.from_increments(self._state, bar_open_inc + bar_low_inc)
                self._state.BarHighPrice = Price.from_increments(self._state, bar_high_inc + bar_low_inc)
                self._state.BarLowPrice = Price.from_increments(self._state, bar_low_inc)
                self._state.BarClosePrice = Price.from_increments(self._state, bar_close_inc + bar_low_inc)
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TradeBar

            elif tag == CTAG_BAR_PRICE_DEC:
                self._state.BarCloseTime = self._get_incremental_time(
                    self._state.BarCloseTime, decode_7bit_long(self._in)
                )
                self._state.BarStartTime = get_bar_start_time(
                    self._state.BarCloseTime, self._state.TradeDateTicks, self._data_type
                )
                bar_open_inc = decode_decimal(self._in)
                bar_high_inc = decode_decimal(self._in)
                bar_low_inc = decode_decimal(self._in)
                bar_close_inc = decode_decimal(self._in)
                self._state.BarOpenPrice = Price.from_increments(self._state, bar_open_inc)
                self._state.BarHighPrice = Price.from_increments(self._state, bar_high_inc)
                self._state.BarLowPrice = Price.from_increments(self._state, bar_low_inc)
                self._state.BarClosePrice = Price.from_increments(self._state, bar_close_inc)
                self._read_bar_volumes()
                self._state.Change = ChartDataChange.TradeBar

            elif tag == CTAG_TPO_START:
                self._state.TPOStartTime = self._get_incremental_time(
                    self._state.TPOStartTime, decode_7bit_long(self._in)
                )
                self._state.TPOBasePrice = self._state.TPOBasePrice.add(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                self._state.Change = ChartDataChange.NONE

            elif tag == CTAG_TPO_START_NEGBASE:
                self._state.TPOStartTime = self._get_incremental_time(
                    self._state.TPOStartTime, decode_7bit_long(self._in)
                )
                self._state.TPOBasePrice = self._state.TPOBasePrice.subtract(
                    Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                )
                self._state.Change = ChartDataChange.NONE

            elif tag == CTAG_TPO_START_PRICE:
                self._state.TPOStartTime = self._get_incremental_time(
                    self._state.TPOStartTime, decode_7bit_long(self._in)
                )
                self._state.LastTPOBasePriceIncrements = self._state.LastTPOBasePriceIncrements + decode_decimal(self._in)
                self._state.TPOBasePrice = Price.from_increments(self._state, self._state.LastTPOBasePriceIncrements)
                self._state.Change = ChartDataChange.NONE

            elif tag == CTAG_TPO_START_PRICE_DEC:
                self._state.TPOStartTime = self._get_incremental_time(
                    self._state.TPOStartTime, decode_7bit_long(self._in)
                )
                self._state.TPOBasePrice = Price.from_increments(self._state, decode_decimal(self._in))
                self._state.Change = ChartDataChange.NONE

            elif tag == CTAG_TPO_DATAPOINT:
                self._read_tpo(is_opening=False, is_closing=False, use_increments=False)

            elif tag == CTAG_TPO_PRICE:
                self._read_tpo_price(is_opening=False, is_closing=False)

            elif tag == CTAG_TPO_DATAPOINT_OPEN:
                self._read_tpo(is_opening=True, is_closing=False, use_increments=False)

            elif tag == CTAG_TPO_OPEN_PRICE:
                self._read_tpo_price(is_opening=True, is_closing=False)

            elif tag == CTAG_TPO_DATAPOINT_CLOSE:
                self._read_tpo(is_opening=False, is_closing=True, use_increments=False)

            elif tag == CTAG_TPO_CLOSE_PRICE:
                self._read_tpo_price(is_opening=False, is_closing=True)

            elif tag == CTAG_TPO_DATAPOINT_OPENCLOSE:
                self._read_tpo(is_opening=True, is_closing=True, use_increments=False)

            elif tag == CTAG_TPO_OPENCLOSE_PRICE:
                self._read_tpo_price(is_opening=True, is_closing=True)

            elif tag == CTAG_QUOTE_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.BidPrice = self._state.BidPrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.BidRealVolume = decode_7bit_int(self._in)
                    self._state.BidImpliedVolume = decode_7bit_int(self._in)
                    self._state.OfferPrice = self._state.BidPrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.OfferRealVolume = decode_7bit_int(self._in)
                    self._state.OfferImpliedVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.Quote
                else:
                    self._eof = True

            elif tag == CTAG_QUOTE_NEG_7BIT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.BidPrice = self._state.BidPrice.subtract(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.BidRealVolume = decode_7bit_int(self._in)
                    self._state.BidImpliedVolume = decode_7bit_int(self._in)
                    self._state.OfferPrice = self._state.BidPrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.OfferRealVolume = decode_7bit_int(self._in)
                    self._state.OfferImpliedVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.Quote
                else:
                    self._eof = True

            elif tag == CTAG_QUOTE_PRICE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.LastBidPriceIncrements = self._state.LastBidPriceIncrements + decode_decimal(self._in)
                    self._state.BidPrice = Price.from_increments(self._state, self._state.LastBidPriceIncrements)
                    self._state.BidRealVolume = decode_7bit_int(self._in)
                    self._state.BidImpliedVolume = decode_7bit_int(self._in)
                    self._state.OfferPrice = self._state.BidPrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.OfferRealVolume = decode_7bit_int(self._in)
                    self._state.OfferImpliedVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.Quote
                else:
                    self._eof = True

            elif tag == CTAG_QUOTE_PRICE_DEC:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.BidPrice = Price.from_increments(self._state, decode_decimal(self._in))
                    self._state.BidRealVolume = decode_7bit_int(self._in)
                    self._state.BidImpliedVolume = decode_7bit_int(self._in)
                    self._state.OfferPrice = self._state.BidPrice.add(
                        Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
                    )
                    self._state.OfferRealVolume = decode_7bit_int(self._in)
                    self._state.OfferImpliedVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.Quote
                else:
                    self._eof = True

            elif tag == CTAG_QUOTE_VOLUME_DELTA:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.BidRealVolume = decode_7bit_int(self._in)
                    self._state.OfferRealVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.Quote
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_MODE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.Mode = MarketMode(decode_7bit_int(self._in))
                    self._state.Change = ChartDataChange.MarketMode
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_SETTLEMENT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.SettlementPrice = Price.from_ticks(
                        self._state, decode_7bit_int(self._in) * self._state.Numerator
                    )
                    self._state.Change = ChartDataChange.Settlement
                else:
                    self._eof = True

            elif tag == CTAG_SETTLEMENT_PRICE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.SettlementPrice = Price.from_increments(self._state, decode_decimal(self._in))
                    self._state.Change = ChartDataChange.Settlement
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_HELD_SETTLEMENT:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.SettlementHeldPrice = Price.from_ticks(
                        self._state, decode_7bit_int(self._in) * self._state.Numerator
                    )
                    self._state.Change = ChartDataChange.HeldSettlement
                else:
                    self._eof = True

            elif tag == CTAG_HELD_SETTLEMENT_PRICE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.SettlementHeldPrice = Price.from_increments(self._state, decode_decimal(self._in))
                    self._state.Change = ChartDataChange.HeldSettlement
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_CLEARED_VOLUME:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.ClearedVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.ClearedVolume
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_OPEN_INTEREST:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    self._state.OpenInterest = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.OpenInterest
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_VWAP:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    price_ticks = decode_7bit_int(self._in)
                    if self._state.MarketDefined:
                        self._state.VWAP_Price = Price.from_ticks(self._state, price_ticks)
                        self._state.Change = ChartDataChange.VWAP
                else:
                    self._eof = True

            elif tag == CTAG_VWAP_PRICE:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    price_inc = decode_decimal(self._in)
                    if self._state.MarketDefined:
                        self._state.VWAP_Price = Price.from_increments(self._state, price_inc)
                        self._state.Change = ChartDataChange.VWAP
                else:
                    self._eof = True

            elif tag == CTAG_MARKET_RFQ:
                if self._increment_time_ticks(decode_7bit_long(self._in)):
                    attr = decode_7bit_int(self._in)
                    if attr & TRADE_AT_BID:
                        self._state.RFQBuySell = BidOffer.Bid
                    elif attr & TRADE_AT_OFFER:
                        self._state.RFQBuySell = BidOffer.Offer
                    else:
                        self._state.RFQBuySell = BidOffer.Undefined
                    self._state.RFQVolume = decode_7bit_int(self._in)
                    self._state.Change = ChartDataChange.RFQ
                else:
                    self._eof = True

            else:
                self._state.Change = ChartDataChange.NONE

        # Ensure we read the full record (skip unknown/extra bytes)
        n_read = self._in.get_count()
        if n_read < length:
            self._in.skip(length - n_read)

        return not self._eof

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _read_trade_attrs(self) -> None:
        attr = decode_7bit_int(self._in)
        self._state.DueToSpread = bool(attr & TRADE_DUE_TO_SPREAD)
        if attr & TRADE_AT_BID:
            self._state.AtBidOrOffer = BidOffer.Bid
        elif attr & TRADE_AT_OFFER:
            self._state.AtBidOrOffer = BidOffer.Offer
        else:
            self._state.AtBidOrOffer = BidOffer.Undefined

    def _read_order_volumes(self) -> None:
        n = decode_7bit_int(self._in)
        self._state.OrderVolumes = [abs(decode_7bit_int(self._in)) for _ in range(n)]

    def _read_bar_volumes(self) -> None:
        self._state.BarVolume = decode_7bit_int(self._in)
        self._state.BarBidVolume = decode_7bit_int(self._in)
        self._state.BarOfferVolume = decode_7bit_int(self._in)
        self._state.BarTrades = decode_7bit_int(self._in)
        self._state.BarTradesAtBid = decode_7bit_int(self._in)
        self._state.BarTradesAtOffer = decode_7bit_int(self._in)

    def _read_tpo(self, *, is_opening: bool, is_closing: bool, use_increments: bool) -> None:
        self._state.TPOPrice = self._state.TPOBasePrice.add(
            Price.from_ticks(self._state, decode_7bit_int(self._in) * self._state.Numerator)
        )
        self._state.TPOVolume = decode_7bit_int(self._in)
        self._state.TPOVolumeAtBid = decode_7bit_int(self._in)
        self._state.TPOVolumeAtOffer = decode_7bit_int(self._in)
        self._state.TPOIsOpening = is_opening
        self._state.TPOIsClosing = is_closing
        self._state.Change = ChartDataChange.TPO

    def _read_tpo_price(self, *, is_opening: bool, is_closing: bool) -> None:
        self._state.TPOPrice = Price.from_increments(
            self._state, self._state.LastTPOBasePriceIncrements + decode_decimal(self._in)
        )
        self._state.TPOVolume = decode_7bit_int(self._in)
        self._state.TPOVolumeAtBid = decode_7bit_int(self._in)
        self._state.TPOVolumeAtOffer = decode_7bit_int(self._in)
        self._state.TPOIsOpening = is_opening
        self._state.TPOIsClosing = is_closing
        self._state.Change = ChartDataChange.TPO

    def _get_market_state(self, market_id: str) -> ChartDataState:
        current: ChartDataState | None = getattr(self, "_state", None)
        if current is not None and current.MarketID == market_id:
            return current

        state = self._market_states.get(market_id)
        if state is None:
            empty_state = self._market_states.get("")
            if empty_state is not None and not self._is_consolidated:
                self._market_states[market_id] = empty_state
                state = empty_state
            elif empty_state is None:
                state = ChartDataState()
                state.MarketID = market_id
                self._market_states[market_id] = state
            else:
                empty_state.MarketID = market_id
                self._market_states[market_id] = empty_state
                state = empty_state

        self._state = state
        return state

    @staticmethod
    def _get_incremental_time(base_ticks: int, ticks: int) -> int:
        if ticks > 599_266_080_000_000_000:
            return ticks
        return base_ticks + ticks

    def _increment_time_ticks(self, ticks: int) -> bool:
        self._state.LastTimeTicks = self._get_incremental_time(
            self._state.LastTimeTicks, ticks
        )
        return True
