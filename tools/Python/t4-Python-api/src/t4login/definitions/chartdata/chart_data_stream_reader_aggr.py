"""Port of `com.t4login.definitions.chartdata.ChartDataStreamReaderAggr`.

Reads aggregated chart data from a binary stream (T4BinAggr format),
dispatching decoded records to a handler implementing the ChartDataHandler
protocol.

The T4BinAggr format is used by the ``/chart/barchart`` endpoint when
``Accept: application/octet-stream`` is requested. It encodes a sequence of
OHLCV bars, market definitions, mode changes, settlements, and open interest
events in a compact binary representation.

The reader processes the stream record-by-record, decoding each tag and its
payload, then dispatching the resulting typed object to the appropriate handler
callback (``on_bar``, ``on_market_definition``, etc.).
"""

from __future__ import annotations

from io import BytesIO
from typing import BinaryIO, Protocol

from t4login.connection.counting_stream import CountingInputStream
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_format_aggr import (
    Bar,
    CTAG_BAR,
    CTAG_BAR_DELTA,
    CTAG_MARKET_DEFINITION,
    CTAG_MARKET_MODE,
    CTAG_MARKET_SWITCH,
    CTAG_OPEN_INTEREST,
    CTAG_SETTLEMENT_PRICE,
    CTAG_SOF,
    CTAG_TRADEDATE_SWITCH,
    MarketDefinition,
)
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price
from t4login.message.reader import (
    read_boolean,
    read_integer,
    read_string,
    read_7bit_datetime,
)
from t4login.util.encoding import (
    decode_7bit_int,
    decode_7bit_long,
    decode_decimal,
    decode_price,
    decode_price_n,
)


class ChartDataHandler(Protocol):
    """Callback protocol for aggregated chart data events."""

    def on_market_definition(self, market_definition: MarketDefinition) -> None: ...

    def on_bar(self, bar: Bar) -> None: ...

    def on_mode_change(
        self,
        market_id: str,
        trade_date: NDateTime,
        time: NDateTime,
        mode: MarketMode,
    ) -> None: ...

    def on_settlement(
        self,
        market_id: str,
        trade_date: NDateTime,
        time: NDateTime,
        settlement_price: Price,
        held: bool,
    ) -> None: ...

    def on_open_interest(
        self,
        market_id: str,
        trade_date: NDateTime,
        time: NDateTime,
        open_interest: int,
    ) -> None: ...


class ChartDataStreamReaderAggr:
    """Reads aggregated chart data from a binary stream (T4BinAggr format).

    This is a utility class with only static methods (mirrors Java's private constructor pattern).
    """

    TAG: str = "ChartDataStreamReaderAggr"

    def __init__(self) -> None:
        raise TypeError("ChartDataStreamReaderAggr is a utility class and cannot be instantiated")

    @staticmethod
    def read(data: bytes, handler: ChartDataHandler) -> None:
        """Read aggregated chart data from *data* bytes, dispatching events to *handler*."""
        ChartDataStreamReaderAggr.read_stream(BytesIO(data), handler)

    @staticmethod
    def read_stream(stream: BinaryIO | None, handler: ChartDataHandler | None) -> None:
        """Read aggregated chart data from a binary *stream*, dispatching events to *handler*."""
        if stream is None:
            return
        if handler is None:
            return

        # Wrap the stream so we can count bytes (supports version-forward skipping)
        cin = CountingInputStream(stream)

        market: MarketDefinition | None = None
        trade_date: NDateTime = NDateTime(0)
        market_id: str = ""

        while True:
            try:
                length = decode_7bit_int(cin)
            except EOFError:
                break
            cin.reset_count()

            if length > 0:
                tag = decode_7bit_int(cin)

                if tag == CTAG_SOF:
                    # Read the binary format version (not used yet)
                    _bin_version = read_integer(cin)
                    # Clear reader state
                    trade_date = NDateTime(0)
                    market_id = ""

                elif tag == CTAG_MARKET_DEFINITION:
                    mkt_id = read_string(cin)
                    numerator = decode_7bit_int(cin)
                    denominator = decode_7bit_int(cin)
                    price_code = read_string(cin)
                    tick_value = decode_decimal(cin)
                    vpt = read_string(cin)
                    min_cab_price = decode_price_n(cin)

                    market = MarketDefinition(
                        MarketID=mkt_id,
                        Numerator=numerator,
                        Denominator=denominator,
                        PriceCode=price_code,
                        TickValue=tick_value,
                        VPT_str=vpt,
                        MinCabPrice=min_cab_price,
                    )
                    handler.on_market_definition(market)

                elif tag == CTAG_TRADEDATE_SWITCH:
                    trade_date = read_7bit_datetime(cin)

                elif tag == CTAG_MARKET_SWITCH:
                    market_id = read_string(cin)

                elif tag == CTAG_BAR_DELTA:
                    time = read_7bit_datetime(cin)
                    close_time = NDateTime(time.ticks + decode_7bit_long(cin))

                    bar_open_increments = decode_7bit_int(cin)
                    bar_high_increments = decode_7bit_int(cin)
                    bar_low_increments = decode_7bit_int(cin)
                    bar_close_increments = decode_7bit_int(cin)

                    volume = decode_7bit_int(cin)
                    volume_at_bid = decode_7bit_int(cin)
                    volume_at_offer = decode_7bit_int(cin)
                    trades = decode_7bit_int(cin)
                    trades_at_bid = decode_7bit_int(cin)
                    trades_at_offer = decode_7bit_int(cin)

                    if market is None:
                        raise ValueError("CTAG_BAR_DELTA encountered before CTAG_MARKET_DEFINITION")

                    bar = Bar(
                        TradeDate=trade_date,
                        Time=time,
                        CloseTime=close_time,
                        MarketID=market_id,
                        OpenPrice=Price.from_increments(market, bar_open_increments + bar_low_increments),
                        HighPrice=Price.from_increments(market, bar_high_increments + bar_low_increments),
                        LowPrice=Price.from_increments(market, bar_low_increments),
                        ClosePrice=Price.from_increments(market, bar_close_increments + bar_low_increments),
                        Volume=volume,
                        VolumeAtBid=volume_at_bid,
                        VolumeAtOffer=volume_at_offer,
                        Trades=trades,
                        TradesAtBid=trades_at_bid,
                        TradesAtOffer=trades_at_offer,
                    )
                    handler.on_bar(bar)

                elif tag == CTAG_BAR:
                    time = read_7bit_datetime(cin)
                    close_time = NDateTime(time.ticks + decode_7bit_long(cin))

                    open_price = decode_price(cin)
                    high_price = decode_price(cin)
                    low_price = decode_price(cin)
                    close_price = decode_price(cin)

                    volume = decode_7bit_int(cin)
                    volume_at_bid = decode_7bit_int(cin)
                    volume_at_offer = decode_7bit_int(cin)
                    trades = decode_7bit_int(cin)
                    trades_at_bid = decode_7bit_int(cin)
                    trades_at_offer = decode_7bit_int(cin)

                    bar = Bar(
                        TradeDate=trade_date,
                        Time=time,
                        CloseTime=close_time,
                        MarketID=market_id,
                        OpenPrice=open_price,
                        HighPrice=high_price,
                        LowPrice=low_price,
                        ClosePrice=close_price,
                        Volume=volume,
                        VolumeAtBid=volume_at_bid,
                        VolumeAtOffer=volume_at_offer,
                        Trades=trades,
                        TradesAtBid=trades_at_bid,
                        TradesAtOffer=trades_at_offer,
                    )
                    handler.on_bar(bar)

                elif tag == CTAG_MARKET_MODE:
                    time = read_7bit_datetime(cin)
                    mode = MarketMode(decode_7bit_int(cin))
                    handler.on_mode_change(market_id, trade_date, time, mode)

                elif tag == CTAG_SETTLEMENT_PRICE:
                    time = read_7bit_datetime(cin)
                    settlement_price = decode_price(cin)
                    held = read_boolean(cin)
                    handler.on_settlement(market_id, trade_date, time, settlement_price, held)

                elif tag == CTAG_OPEN_INTEREST:
                    time = read_7bit_datetime(cin)
                    open_interest = decode_7bit_int(cin)
                    handler.on_open_interest(market_id, trade_date, time, open_interest)

            # Ensure we read the full record (skip unknown/extra bytes)
            n_read = cin.get_count()
            if n_read < length:
                cin.skip(length - n_read)
