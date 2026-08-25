"""Tests for ChartDataStreamReaderAggr — verifies utility class semantics and protocol."""

import pytest

from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataHandler,
    ChartDataStreamReaderAggr,
)


def test_cannot_instantiate() -> None:
    with pytest.raises(TypeError, match="utility class"):
        ChartDataStreamReaderAggr()  # type: ignore[abstract]


def test_read_empty_data_no_error() -> None:
    """read() with empty bytes should not raise (no records to parse)."""
    handler: ChartDataHandler = object()  # type: ignore[assignment]
    # Should not raise — empty stream produces no events
    ChartDataStreamReaderAggr.read(b"", handler)


def test_read_stream_none_no_error() -> None:
    """read_stream() with None stream should not raise."""
    handler: ChartDataHandler = object()  # type: ignore[assignment]
    ChartDataStreamReaderAggr.read_stream(None, handler)


def test_handler_protocol_is_importable() -> None:
    # Ensure the protocol can be imported and referenced
    assert hasattr(ChartDataHandler, "on_bar")
    assert hasattr(ChartDataHandler, "on_market_definition")
    assert hasattr(ChartDataHandler, "on_mode_change")
    assert hasattr(ChartDataHandler, "on_settlement")
    assert hasattr(ChartDataHandler, "on_open_interest")
