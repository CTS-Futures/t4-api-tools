"""``t4login.definitions.chartdata`` - Chart data definitions and stream readers.

This package provides the binary decoding pipeline for T4 chart data:

- **Stream readers**: ``ChartDataStreamReader`` (non-aggregated T4Bin ticks) and
  ``ChartDataStreamReaderAggr`` (aggregated T4BinAggr bars). These consume the
  binary payloads returned by the T4 Chart API and produce typed Python objects.
- **State**: ``ChartDataState`` — mutable accumulator updated by the non-aggregated
  reader as it iterates through tick-level records.
- **Format constants**: Tag values (CTAGs) and helpers defined in ``chart_format``
  and ``chart_format_aggr``.
- **Data types**: ``ChartDataType`` (time aggregation level), ``ChartDataChange``
  (event type indicator), ``Bar`` and ``MarketDefinition`` (aggregated output).
"""

from t4login.definitions.chartdata.chart_data_change import ChartDataChange
from t4login.definitions.chartdata.chart_data_state import ChartDataState
from t4login.definitions.chartdata.chart_data_state import empty as empty_state
from t4login.definitions.chartdata.chart_data_stream_reader import ChartDataStreamReader
from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataHandler,
    ChartDataStreamReaderAggr,
)
from t4login.definitions.chartdata.chart_data_type import (
    TPO,
    ChartDataType,
    Day,
    Hour,
    Minute,
    Second,
    Tick,
    TickChange,
)
from t4login.definitions.chartdata.chart_format import (
    CTAG_CONSOLIDATED,
    CTAG_SOF,
    get_bar_start_time,
)
from t4login.definitions.chartdata.chart_format_aggr import Bar, MarketDefinition

__all__ = [
    "CTAG_CONSOLIDATED",
    "CTAG_SOF",
    "TPO",
    "Bar",
    "ChartDataChange",
    "ChartDataHandler",
    "ChartDataState",
    "ChartDataStreamReader",
    "ChartDataStreamReaderAggr",
    "ChartDataType",
    "Day",
    "Hour",
    "MarketDefinition",
    "Minute",
    "Second",
    "Tick",
    "TickChange",
    "empty_state",
    "get_bar_start_time",
]
