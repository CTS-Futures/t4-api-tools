"""Generate binary and CSV fixture files for regression tests.

Run from the repo root::

    python tests/fixtures/generate_fixtures.py

Outputs (relative to this script's directory):
    sample.bin            — binary T4BinAggr stream
    sample_expected.csv   — CSV of expected decoded records (committed as baseline)

The binary is built from known values using the same helper functions used in
the unit tests, so the fixture is self-consistent and human-verifiable.
"""

from __future__ import annotations

import struct
import sys
from decimal import ROUND_HALF_EVEN, Decimal
from io import BytesIO
from pathlib import Path

# Make the repo src importable when run as a script
_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "src"))
sys.path.insert(0, str(_REPO / "tests"))

from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataStreamReaderAggr,
)
from t4login.definitions.chartdata.chart_format_aggr import (
    CTAG_BAR,
    CTAG_MARKET_DEFINITION,
    CTAG_MARKET_MODE,
    CTAG_MARKET_SWITCH,
    CTAG_OPEN_INTEREST,
    CTAG_SETTLEMENT_PRICE,
    CTAG_SOF,
    CTAG_TRADEDATE_SWITCH,
    Bar,
    MarketDefinition,
)
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price
from t4login.util.encoding import (
    encode_7bit_int,
    encode_7bit_long,
    encode_decimal,
)
from definitions.chartdata.csv_binary_helpers import (  # type: ignore[import]
    handler_to_rows,
    write_csv,
)

# ---------------------------------------------------------------------------
# Binary builder helpers (mirrors helpers in test_chart_data_stream_reader_aggr_decode.py)
# ---------------------------------------------------------------------------


def _write_string(s: str) -> bytes:
    b = s.encode("utf-8")
    return encode_7bit_int(len(b)) + b


def _write_record(tag: int, payload: bytes) -> bytes:
    tag_bytes = encode_7bit_int(tag)
    body = tag_bytes + payload
    return encode_7bit_int(len(body)) + body


def _build_sof_record() -> bytes:
    return _write_record(CTAG_SOF, struct.pack("<i", 1))


def _build_market_definition_record() -> bytes:
    buf = BytesIO()
    buf.write(_write_string("ESM25"))
    buf.write(encode_7bit_int(1))   # numerator
    buf.write(encode_7bit_int(4))   # denominator
    buf.write(_write_string("0.25"))  # priceCode
    tick_val = Decimal("12.50").quantize(Decimal("1E-18"), rounding=ROUND_HALF_EVEN)
    buf.write(encode_decimal(tick_val))
    buf.write(_write_string(""))    # vpt (empty)
    buf.write(b"\x00")              # minCabPrice = None
    return _write_record(CTAG_MARKET_DEFINITION, buf.getvalue())


def _build_tradedate_record(ticks: int) -> bytes:
    return _write_record(CTAG_TRADEDATE_SWITCH, encode_7bit_long(ticks))


def _build_market_switch_record(market_id: str) -> bytes:
    return _write_record(CTAG_MARKET_SWITCH, _write_string(market_id))


def _build_bar_record(
    time_ticks: int,
    close_delta: int,
    open_price: Decimal,
    high_price: Decimal,
    low_price: Decimal,
    close_price: Decimal,
    volume: int = 100,
) -> bytes:
    buf = BytesIO()
    buf.write(encode_7bit_long(time_ticks))
    buf.write(encode_7bit_long(close_delta))
    for p in (open_price, high_price, low_price, close_price):
        buf.write(encode_decimal(p))
    buf.write(encode_7bit_int(volume))
    buf.write(encode_7bit_int(volume // 2))
    buf.write(encode_7bit_int(volume // 2))
    buf.write(encode_7bit_int(10))  # trades
    buf.write(encode_7bit_int(5))   # tradesAtBid
    buf.write(encode_7bit_int(5))   # tradesAtOffer
    return _write_record(CTAG_BAR, buf.getvalue())


def _build_mode_change_record(time_ticks: int, mode: MarketMode) -> bytes:
    buf = BytesIO()
    buf.write(encode_7bit_long(time_ticks))
    buf.write(encode_7bit_int(int(mode)))
    return _write_record(CTAG_MARKET_MODE, buf.getvalue())


def _build_settlement_record(time_ticks: int, price: Decimal, held: bool) -> bytes:
    buf = BytesIO()
    buf.write(encode_7bit_long(time_ticks))
    buf.write(encode_decimal(price))
    buf.write(b"\x01" if held else b"\x00")
    return _write_record(CTAG_SETTLEMENT_PRICE, buf.getvalue())


def _build_open_interest_record(time_ticks: int, open_interest: int) -> bytes:
    buf = BytesIO()
    buf.write(encode_7bit_long(time_ticks))
    buf.write(encode_7bit_int(open_interest))
    return _write_record(CTAG_OPEN_INTEREST, buf.getvalue())


# ---------------------------------------------------------------------------
# RecordingHandler (minimal copy; avoids importing the test module)
# ---------------------------------------------------------------------------


class RecordingHandler:
    def __init__(self) -> None:
        self.market_definitions: list[MarketDefinition] = []
        self.bars: list[Bar] = []
        self.mode_changes: list[tuple] = []
        self.settlements: list[tuple] = []
        self.open_interests: list[tuple] = []

    def on_market_definition(self, md: MarketDefinition) -> None:
        self.market_definitions.append(md)

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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build_stream() -> bytes:
    q18 = Decimal("1E-18")
    trade_date_ticks = 638_000_000_000_000_000
    bar_time_ticks = 638_000_100_000_000_000
    close_delta = 600_000_000  # 60 s in 100-ns ticks
    mode_time_ticks = 638_000_200_000_000_000
    settle_time_ticks = 638_000_300_000_000_000
    oi_time_ticks = 638_000_400_000_000_000

    open_p = Decimal("5000.25").quantize(q18, rounding=ROUND_HALF_EVEN)
    high_p = Decimal("5005.50").quantize(q18, rounding=ROUND_HALF_EVEN)
    low_p = Decimal("4998.00").quantize(q18, rounding=ROUND_HALF_EVEN)
    close_p = Decimal("5003.75").quantize(q18, rounding=ROUND_HALF_EVEN)
    settle_p = Decimal("5010.00").quantize(q18, rounding=ROUND_HALF_EVEN)

    return (
        _build_sof_record()
        + _build_market_definition_record()
        + _build_tradedate_record(trade_date_ticks)
        + _build_market_switch_record("ESM25")
        + _build_bar_record(bar_time_ticks, close_delta, open_p, high_p, low_p, close_p)
        + _build_mode_change_record(mode_time_ticks, MarketMode.Open)
        + _build_settlement_record(settle_time_ticks, settle_p, held=True)
        + _build_open_interest_record(oi_time_ticks, 42_000)
    )


def main() -> None:
    fixtures_dir = Path(__file__).parent
    bin_path = fixtures_dir / "sample.bin"
    csv_path = fixtures_dir / "sample_expected.csv"

    stream = build_stream()

    handler = RecordingHandler()
    ChartDataStreamReaderAggr.read(stream, handler)

    rows = handler_to_rows(
        handler.bars,
        handler.market_definitions,
        handler.mode_changes,
        handler.settlements,
        handler.open_interests,
    )

    bin_path.write_bytes(stream)
    write_csv(csv_path, rows)

    print(f"Written {len(stream):,} bytes → {bin_path}")
    print(f"Written {len(rows)} rows   → {csv_path}")
    for row in rows:
        print(f"  [{row['type']:20s}] market={row['market_id'] or '—'}")


if __name__ == "__main__":
    main()
