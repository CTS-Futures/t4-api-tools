"""Shared pytest fixtures and helpers for ChartClient tests.

This conftest is loaded automatically for every test under ``tests/client/``.
It provides:

* The ``--token`` CLI option / ``T4_API_TOKEN`` env var fixture used by the
  live integration tests.
* A ready-to-use authenticated ``ChartClient`` fixture for integration tests.
* ``CollectingHandler`` — a ``ChartDataHandler`` implementation that records
  every callback into typed lists so tests can assert on what was decoded.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest

from t4login.client.chart_client import ChartClient
from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_format_aggr import Bar, MarketDefinition
from t4login.definitions.market_mode import MarketMode
from t4login.definitions.priceconversion.price import Price


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--token",
        action="store",
        default=None,
        help="Bearer token for T4 API integration tests.",
    )


@pytest.fixture
def api_token(request: pytest.FixtureRequest) -> str:
    """Resolve the bearer token from --token CLI flag or T4_API_TOKEN env var."""
    token = request.config.getoption("--token") or os.environ.get("T4_API_TOKEN")
    if not token:
        pytest.skip("No API token provided (use --token or T4_API_TOKEN env var)")
    return token


@pytest.fixture
def client(api_token: str) -> Iterator[ChartClient]:
    """Authenticated ChartClient bound to the default (sim) base URL."""
    with ChartClient(token=api_token) as c:
        yield c


@dataclass
class CollectingHandler:
    """A ``ChartDataHandler`` that appends every decoded record into lists.

    Used by both unit and integration tests to capture the stream of callbacks
    produced by ``ChartDataStreamReaderAggr.read`` and then assert on the
    collected output.
    """

    bars: list[Bar] = field(default_factory=list)
    market_definitions: list[MarketDefinition] = field(default_factory=list)
    mode_changes: list[tuple] = field(default_factory=list)
    settlements: list[tuple] = field(default_factory=list)
    open_interests: list[tuple] = field(default_factory=list)

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
