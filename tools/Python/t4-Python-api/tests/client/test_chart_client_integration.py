"""Live integration tests for the T4 Chart API.

These tests hit the real sim endpoint at ``https://api-sim.t4login.com/chart``
through the :class:`ChartClient` and verify that:

1. JSON responses are parsed and contain the expected top-level keys.
2. Binary (``application/octet-stream``) responses are decoded by the
   ``ChartDataStreamReaderAggr`` / ``ChartDataStreamReader`` pipeline into
   typed records (bars, market definitions, ticks).

The ``integration`` marker excludes these tests from the default run defined
in ``pyproject.toml`` (``addopts = -m 'not integration'``). To execute them
you must explicitly opt in and supply a bearer token::

    pytest -m integration --token=YOUR_BEARER_TOKEN
    # or:  $env:T4_API_TOKEN = "..." ; pytest -m integration

The ``client`` fixture and the ``CollectingHandler`` helper are provided by
``tests/client/conftest.py``.
"""

from __future__ import annotations

import datetime

import pytest

from t4login.client.chart_client import ChartClient

from .conftest import CollectingHandler

# Apply the integration marker to every test in this module so they are
# skipped unless the user explicitly runs `pytest -m integration`.
pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Shared request parameters
# ---------------------------------------------------------------------------
# YM (E-mini Dow) on the CME sim feed.  MARKET_ID pins a specific front-month
# contract; refresh this when the contract rolls (roughly every quarter).
# TRADE_DATE_* are computed dynamically to stay within the sim's retention
# window: we request the most recently completed Mon–Fri trading week so the
# tests remain valid without manual maintenance.

EXCHANGE_ID = "CME_E"
CONTRACT_ID = "YM"
MARKET_ID = "XCME_E YM (M26)"  # Refresh when YM rolls to the next contract month


def _last_completed_week() -> tuple[str, str]:
    """Return (start, end) ISO dates for the most recently completed Mon–Fri week.

    'Completed' means the week ended at least one full day ago so the sim feed
    has had time to persist all ticks.  If today is Monday we step back two
    weeks to avoid partial data from the current week.
    """
    today = datetime.date.today()
    # Monday of the current week (weekday 0 = Monday)
    current_monday = today - datetime.timedelta(days=today.weekday())
    # Last completed Friday = Monday of last week + 4 days
    last_friday = current_monday - datetime.timedelta(days=3)
    last_monday = last_friday - datetime.timedelta(days=4)
    return last_monday.isoformat(), last_friday.isoformat()


TRADE_DATE_START, TRADE_DATE_END = _last_completed_week()


# ---------------------------------------------------------------------------
# /chart/barchart
# ---------------------------------------------------------------------------


class TestBarchartIntegration:
    """End-to-end coverage for the ``/chart/barchart`` endpoint."""

    def test_json_response_has_bars(self, client: ChartClient) -> None:
        """JSON response shape: top-level ``bars`` and ``marketDefinitions`` lists."""
        result = client.get_barchart_json(
            exchange_id=EXCHANGE_ID,
            contract_id=CONTRACT_ID,
            chart_type="Bar",
            bar_interval="Day",
            bar_period=1,
            market_id=MARKET_ID,
            trade_date_start=TRADE_DATE_START,
            trade_date_end=TRADE_DATE_END,
        )

        assert "bars" in result
        assert "marketDefinitions" in result
        assert isinstance(result["bars"], list)

    def test_binary_response_decodes_bars(self, client: ChartClient) -> None:
        """Binary response is decoded into Bar + MarketDefinition records.

        The client strips the HTTP envelope, locates the T4BinAggr SOF marker,
        and feeds the embedded payload into ``ChartDataStreamReaderAggr.read``,
        which dispatches callbacks on the supplied handler.
        """
        handler = CollectingHandler()
        client.get_barchart_binary(
            exchange_id=EXCHANGE_ID,
            contract_id=CONTRACT_ID,
            chart_type="Bar",
            bar_interval="Day",
            bar_period=1,
            market_id=MARKET_ID,
            trade_date_start=TRADE_DATE_START,
            trade_date_end=TRADE_DATE_END,
            handler=handler,
        )

        assert len(handler.market_definitions) > 0
        assert len(handler.bars) > 0
        bar = handler.bars[0]
        assert bar.MarketID != ""
        assert bar.Volume > 0


# ---------------------------------------------------------------------------
# /chart/tradehistory
# ---------------------------------------------------------------------------


class TestTradehistoryIntegration:
    """End-to-end coverage for the ``/chart/tradehistory`` endpoint."""

    def test_json_response_has_trades(self, client: ChartClient) -> None:
        """JSON response contains a non-empty ``trades`` list for an active contract."""
        result = client.get_tradehistory_json(
            exchange_id=EXCHANGE_ID,
            contract_id=CONTRACT_ID,
            market_id=MARKET_ID,
            trade_date_start=TRADE_DATE_START,
            trade_date_end=TRADE_DATE_END,
        )

        assert "trades" in result
        assert isinstance(result["trades"], list)
        assert len(result["trades"]) > 0

    def test_binary_response_produces_reader(self, client: ChartClient) -> None:
        """Binary response yields a stream reader that decodes at least one tick.

        Unlike the aggregated barchart endpoint, tradehistory returns
        non-aggregated T4Bin tick records, so the client hands back a
        ``ChartDataStreamReader`` that the caller pulls from with ``read()``.
        """
        reader = client.get_tradehistory_binary(
            exchange_id=EXCHANGE_ID,
            contract_id=CONTRACT_ID,
            market_id=MARKET_ID,
            trade_date_start=TRADE_DATE_START,
            trade_date_end=TRADE_DATE_END,
        )

        found_market = False
        while reader.read():
            if reader.state.MarketID != "":
                found_market = True
                break
        assert found_market, "Expected at least one record with a non-empty MarketID"
