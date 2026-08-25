"""Regression test: decode sample.bin and compare against sample_expected.csv.

This verifies that the Python decoder produces exactly the same records as
the committed reference CSV.  If a decode change breaks parity, the test
provides a clear row-by-row diff.

To regenerate the fixtures after an intentional change::

    python tests/fixtures/generate_fixtures.py

Then review the updated CSV before committing.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataStreamReaderAggr,
)
from t4login.definitions.chartdata.chart_format_aggr import Bar, MarketDefinition
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price

from tests.definitions.chartdata.csv_binary_helpers import (
    handler_to_rows,
    parse_csv,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
BIN_PATH = FIXTURES_DIR / "sample.bin"
CSV_PATH = FIXTURES_DIR / "sample_expected.csv"


# ---------------------------------------------------------------------------
# Handler implementation
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
# Tests
# ---------------------------------------------------------------------------


class TestCsvBinaryComparison(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        data = BIN_PATH.read_bytes()
        handler = RecordingHandler()
        ChartDataStreamReaderAggr.read(data, handler)
        cls.decoded_rows = handler_to_rows(
            handler.bars,
            handler.market_definitions,
            handler.mode_changes,
            handler.settlements,
            handler.open_interests,
        )
        cls.expected_rows = parse_csv(CSV_PATH)

    def test_row_count_matches(self) -> None:
        self.assertEqual(
            len(self.decoded_rows),
            len(self.expected_rows),
            f"Decoded {len(self.decoded_rows)} rows but CSV has {len(self.expected_rows)} rows",
        )

    def test_all_rows_match(self) -> None:
        for i, (actual, expected) in enumerate(zip(self.decoded_rows, self.expected_rows)):
            mismatches = {
                col: (actual[col], expected[col])
                for col in expected
                if actual.get(col, "") != expected[col]
            }
            self.assertFalse(
                mismatches,
                f"Row {i} (type={expected['type']!r}) field mismatches:\n"
                + "\n".join(
                    f"  {col}: decoded={v_act!r}  expected={v_exp!r}"
                    for col, (v_act, v_exp) in mismatches.items()
                ),
            )

    def test_record_types_present(self) -> None:
        types = {row["type"] for row in self.decoded_rows}
        self.assertIn("market_definition", types)
        self.assertIn("bar", types)
        self.assertIn("mode_change", types)
        self.assertIn("settlement", types)
        self.assertIn("open_interest", types)

    def test_market_definition_fields(self) -> None:
        md = next(r for r in self.decoded_rows if r["type"] == "market_definition")
        self.assertEqual(md["market_id"], "ESM25")
        self.assertEqual(md["numerator"], "1")
        self.assertEqual(md["denominator"], "4")
        self.assertEqual(md["price_code"], "0.25")

    def test_bar_prices(self) -> None:
        bar = next(r for r in self.decoded_rows if r["type"] == "bar")
        self.assertEqual(bar["market_id"], "ESM25")
        self.assertTrue(bar["open"].startswith("5000.25"))
        self.assertTrue(bar["high"].startswith("5005.5"))
        self.assertTrue(bar["low"].startswith("4998.0"))
        self.assertTrue(bar["close"].startswith("5003.75"))
        self.assertEqual(bar["volume"], "100")
        self.assertEqual(bar["trades"], "10")

    def test_settlement_held_flag(self) -> None:
        settle = next(r for r in self.decoded_rows if r["type"] == "settlement")
        self.assertEqual(settle["held"], "true")
        self.assertTrue(settle["settlement_price"].startswith("5010.0"))

    def test_open_interest_value(self) -> None:
        oi = next(r for r in self.decoded_rows if r["type"] == "open_interest")
        self.assertEqual(oi["open_interest"], "42000")


if __name__ == "__main__":
    unittest.main()
