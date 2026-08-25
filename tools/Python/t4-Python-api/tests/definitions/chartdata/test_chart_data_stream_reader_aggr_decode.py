"""Integration tests for ChartDataStreamReaderAggr decode path.

Builds synthetic binary buffers with CTAG_SOF + CTAG_MARKET_DEFINITION + CTAG_BAR
and verifies the handler receives expected records.
"""

from __future__ import annotations

import struct
from decimal import ROUND_HALF_EVEN, Decimal
from io import BytesIO

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataStreamReaderAggr,
)
from t4login.definitions.chartdata.chart_format_aggr import (
    Bar,
    CTAG_BAR,
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
from t4login.util.encoding import (
    encode_7bit_int,
    encode_7bit_long,
    encode_decimal,
)


def _write_string(s: str) -> bytes:
    """Encode a 7-bit-length-prefixed UTF-8 string."""
    b = s.encode("utf-8")
    return encode_7bit_int(len(b)) + b


def _write_record(tag: int, payload: bytes) -> bytes:
    """Wrap payload in a record: length varint + tag varint + payload."""
    tag_bytes = encode_7bit_int(tag)
    body = tag_bytes + payload
    return encode_7bit_int(len(body)) + body


def _encode_price_n(price: Price | None) -> bytes:
    """Encode a nullable price (header + decimal)."""
    if price is None:
        return b"\x00"
    return b"\x01" + encode_decimal(price.value)


class RecordingHandler:
    """Captures all handler calls for assertion."""

    def __init__(self) -> None:
        self.market_definitions: list[MarketDefinition] = []
        self.bars: list[Bar] = []
        self.mode_changes: list[tuple] = []
        self.settlements: list[tuple] = []
        self.open_interests: list[tuple] = []

    def on_market_definition(self, market_definition: MarketDefinition) -> None:
        self.market_definitions.append(market_definition)

    def on_bar(self, bar: Bar) -> None:
        self.bars.append(bar)

    def on_mode_change(
        self, market_id: str, trade_date: NDateTime, time: NDateTime, mode: MarketMode
    ) -> None:
        self.mode_changes.append((market_id, trade_date, time, mode))

    def on_settlement(
        self,
        market_id: str,
        trade_date: NDateTime,
        time: NDateTime,
        settlement_price: Price,
        held: bool,
    ) -> None:
        self.settlements.append((market_id, trade_date, time, settlement_price, held))

    def on_open_interest(
        self, market_id: str, trade_date: NDateTime, time: NDateTime, open_interest: int
    ) -> None:
        self.open_interests.append((market_id, trade_date, time, open_interest))


class TestChartDataStreamReaderAggrDecode:
    def _build_sof_record(self) -> bytes:
        """SOF record: tag=1 + version (4 bytes LE int)."""
        payload = struct.pack("<i", 1)  # version 1
        return _write_record(CTAG_SOF, payload)

    def _build_market_definition_record(self) -> bytes:
        """Market definition record with test values."""
        payload = BytesIO()
        payload.write(_write_string("ESM25"))  # marketID
        payload.write(encode_7bit_int(1))  # numerator
        payload.write(encode_7bit_int(4))  # denominator
        payload.write(_write_string("0.25"))  # priceCode
        # tickValue as decimal
        tick_val = Decimal("12.50").quantize(Decimal("1E-18"), rounding=ROUND_HALF_EVEN)
        payload.write(encode_decimal(tick_val))
        payload.write(_write_string(""))  # vpt (empty)
        payload.write(b"\x00")  # minCabPrice = None
        return _write_record(CTAG_MARKET_DEFINITION, payload.getvalue())

    def _build_tradedate_record(self, ticks: int) -> bytes:
        """Trade date switch record."""
        return _write_record(CTAG_TRADEDATE_SWITCH, encode_7bit_long(ticks))

    def _build_market_switch_record(self, market_id: str) -> bytes:
        """Market switch record."""
        return _write_record(CTAG_MARKET_SWITCH, _write_string(market_id))

    def _build_bar_record(
        self,
        time_ticks: int,
        close_delta: int,
        open_price: Decimal,
        high_price: Decimal,
        low_price: Decimal,
        close_price: Decimal,
        volume: int = 100,
    ) -> bytes:
        """BAR record with absolute prices."""
        payload = BytesIO()
        payload.write(encode_7bit_long(time_ticks))  # time
        payload.write(encode_7bit_long(close_delta))  # closeTime delta from time
        # 4 prices (absolute, no header byte — direct decimal encoding)
        for p in (open_price, high_price, low_price, close_price):
            payload.write(encode_decimal(p))
        # 6 volume fields
        payload.write(encode_7bit_int(volume))  # volume
        payload.write(encode_7bit_int(volume // 2))  # volumeAtBid
        payload.write(encode_7bit_int(volume // 2))  # volumeAtOffer
        payload.write(encode_7bit_int(10))  # trades
        payload.write(encode_7bit_int(5))  # tradesAtBid
        payload.write(encode_7bit_int(5))  # tradesAtOffer
        return _write_record(CTAG_BAR, payload.getvalue())

    def test_full_decode_sof_market_bar(self) -> None:
        """End-to-end: SOF + MARKET_DEFINITION + TRADEDATE + MARKET_SWITCH + BAR."""
        trade_date_ticks = 638000000000000000
        time_ticks = 638000100000000000
        close_delta = 60_000_000_0  # 60 seconds in 100ns ticks

        q18 = Decimal("1E-18")
        open_p = Decimal("5000.25").quantize(q18, rounding=ROUND_HALF_EVEN)
        high_p = Decimal("5005.50").quantize(q18, rounding=ROUND_HALF_EVEN)
        low_p = Decimal("4998.00").quantize(q18, rounding=ROUND_HALF_EVEN)
        close_p = Decimal("5003.75").quantize(q18, rounding=ROUND_HALF_EVEN)

        # Build the full stream
        stream_data = (
            self._build_sof_record()
            + self._build_market_definition_record()
            + self._build_tradedate_record(trade_date_ticks)
            + self._build_market_switch_record("ESM25")
            + self._build_bar_record(time_ticks, close_delta, open_p, high_p, low_p, close_p)
        )

        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(stream_data, handler)

        # Verify market definition
        assert len(handler.market_definitions) == 1
        mkt = handler.market_definitions[0]
        assert mkt.MarketID == "ESM25"
        assert mkt.Numerator == 1
        assert mkt.Denominator == 4

        # Verify bar
        assert len(handler.bars) == 1
        bar = handler.bars[0]
        assert bar.MarketID == "ESM25"
        assert bar.TradeDate.ticks == trade_date_ticks
        assert bar.Time.ticks == time_ticks
        assert bar.CloseTime.ticks == time_ticks + close_delta
        assert bar.OpenPrice == Price(open_p)
        assert bar.HighPrice == Price(high_p)
        assert bar.LowPrice == Price(low_p)
        assert bar.ClosePrice == Price(close_p)
        assert bar.Volume == 100
        assert bar.VolumeAtBid == 50
        assert bar.VolumeAtOffer == 50
        assert bar.Trades == 10

    def test_null_stream(self) -> None:
        """Passing None as stream should not raise."""
        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read_stream(None, handler)

    def test_null_handler(self) -> None:
        """Passing None as handler should not raise."""
        ChartDataStreamReaderAggr.read_stream(BytesIO(b""), None)

    def test_empty_stream(self) -> None:
        """Empty data should produce no events."""
        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(b"", handler)
        assert handler.bars == []
        assert handler.market_definitions == []

    def test_market_mode_record(self) -> None:
        """MARKET_MODE tag dispatches to on_mode_change."""
        trade_date_ticks = 638000000000000000
        mode_time_ticks = 638000100000000000

        payload = BytesIO()
        payload.write(encode_7bit_long(mode_time_ticks))
        payload.write(encode_7bit_int(MarketMode.Open))

        stream_data = (
            self._build_sof_record()
            + self._build_tradedate_record(trade_date_ticks)
            + self._build_market_switch_record("ESM25")
            + _write_record(CTAG_MARKET_MODE, payload.getvalue())
        )

        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(stream_data, handler)

        assert len(handler.mode_changes) == 1
        market_id, trade_date, time, mode = handler.mode_changes[0]
        assert market_id == "ESM25"
        assert time.ticks == mode_time_ticks
        assert mode == MarketMode.Open

    def test_settlement_price_record(self) -> None:
        """SETTLEMENT_PRICE tag dispatches to on_settlement."""
        trade_date_ticks = 638000000000000000
        settle_time_ticks = 638000200000000000

        q18 = Decimal("1E-18")
        settle_price = Decimal("5010.00").quantize(q18, rounding=ROUND_HALF_EVEN)

        payload = BytesIO()
        payload.write(encode_7bit_long(settle_time_ticks))
        payload.write(encode_decimal(settle_price))
        payload.write(b"\x01")  # held = true

        stream_data = (
            self._build_sof_record()
            + self._build_tradedate_record(trade_date_ticks)
            + self._build_market_switch_record("ESM25")
            + _write_record(CTAG_SETTLEMENT_PRICE, payload.getvalue())
        )

        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(stream_data, handler)

        assert len(handler.settlements) == 1
        market_id, trade_date, time, price, held = handler.settlements[0]
        assert market_id == "ESM25"
        assert price == Price(settle_price)
        assert held is True

    def test_open_interest_record(self) -> None:
        """OPEN_INTEREST tag dispatches to on_open_interest."""
        trade_date_ticks = 638000000000000000
        oi_time_ticks = 638000300000000000

        payload = BytesIO()
        payload.write(encode_7bit_long(oi_time_ticks))
        payload.write(encode_7bit_int(42000))

        stream_data = (
            self._build_sof_record()
            + self._build_tradedate_record(trade_date_ticks)
            + self._build_market_switch_record("ESM25")
            + _write_record(CTAG_OPEN_INTEREST, payload.getvalue())
        )

        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(stream_data, handler)

        assert len(handler.open_interests) == 1
        market_id, trade_date, time, oi = handler.open_interests[0]
        assert market_id == "ESM25"
        assert oi == 42000

    def test_unknown_tag_skipped(self) -> None:
        """Unknown tags should be skipped gracefully via leftover-byte logic."""
        # Use a fake tag number 99 with some payload
        fake_payload = b"\x01\x02\x03\x04\x05"
        stream_data = (
            self._build_sof_record()
            + _write_record(99, fake_payload)
        )

        handler = RecordingHandler()
        # Should not raise
        ChartDataStreamReaderAggr.read(stream_data, handler)
        assert handler.bars == []
