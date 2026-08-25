"""Port of `com.t4login.definitions.chartdata.ChartFormat`.

Module-level constants for trade flags and binary record tags (CTAGs), plus the
`get_bar_start_time` helper that truncates an `NDateTime` to the start of a bar
boundary for the given aggregation type.

The two Java overloads (one accepting `NDateTime`, one accepting raw ticks) are
collapsed into a single function that accepts either `NDateTime` or `int`.

Record tag naming convention:
- CTAG_ prefix identifies a binary record tag constant.
- The tag value is read immediately after the record length in the T4Bin stream.
- Tags are grouped by function: framing (SOF), market setup, trade/tick data,
  bar aggregates, quotes (BBO), TPO (market profile), mode/settlement/OI,
  and price-change records.
"""

from __future__ import annotations

from t4login.datetime_.n_date_time import NDateTime
from t4login.definitions.chartdata.chart_data_type import (
    TPO,
    ChartDataType,
    Day,
    Hour,
    Minute,
    Second,
)

# --- Trade flags (bit masks combined in the trade attributes byte) ----------
NONE: int = 0
TRADE_DUE_TO_SPREAD: int = 1
TRADE_AT_BID: int = 2
TRADE_AT_OFFER: int = 4

# Controls whether the reader should cache decoded state
NO_CACHE: int = 1

# --- Binary format version ----------------------------------------------------
CVAL_T4BIN_VERSION: int = 1

# --- Record tags (CTAGs) — stream framing ------------------------------------
CTAG_SOF: int = 1                  # Start-of-file: version + trade-date header
CTAG_MARKET_DEFINITION: int = 2    # Instrument metadata (numerator, denom, etc.)

CTAG_CONSOLIDATED: int = 7        # Flags the stream as consolidated (multi-market)
CTAG_MARKET_SWITCH: int = 8       # Switch active market by key index
CTAG_MARKET_KEY: int = 9          # Register a market_id ↔ key mapping

# --- Record tags — tick/trade data -------------------------------------------
CTAG_TICKDATAPOINT_7BIT: int = 11         # Trade with positive delta price (7-bit ticks)
CTAG_TICKDATAPOINT_NEG_7BIT: int = 12     # Trade with negative delta price (7-bit ticks)

CTAG_TICKDATAPOINT_ALT_7BIT: int = 17     # Trade + order volumes (positive delta)
CTAG_TICKDATAPOINT_ALT_NEG_7BIT: int = 18 # Trade + order volumes (negative delta)

CTAG_TICKCHANGEDATAPOINT_7BIT: int = 14       # Price change, positive delta
CTAG_TICKCHANGEDATAPOINT_NEG_7BIT: int = 15   # Price change, negative delta

# --- Record tags — bar (OHLCV) data -----------------------------------------
CTAG_BARDATAPOINT_7BIT_DELTA_LOW: int = 21     # Bar with prices as deltas from low
CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW: int = 22 # Bar with neg delta low adjustment

# --- Record tags — TPO (Time-Price Opportunity / market profile) -------------
CTAG_TPO_START: int = 30              # TPO period start with positive base delta
CTAG_TPO_START_NEGBASE: int = 31      # TPO period start with negative base delta
CTAG_TPO_DATAPOINT: int = 32          # TPO data point (regular)
CTAG_TPO_DATAPOINT_OPEN: int = 33     # TPO data point (opening tick)
CTAG_TPO_DATAPOINT_CLOSE: int = 34    # TPO data point (closing tick)
CTAG_TPO_DATAPOINT_OPENCLOSE: int = 35 # TPO data point (both open and close)

# --- Record tags — quote (best bid/offer) ------------------------------------
CTAG_QUOTE_7BIT: int = 50            # BBO update, positive bid delta
CTAG_QUOTE_NEG_7BIT: int = 51        # BBO update, negative bid delta
CTAG_QUOTE_VOLUME_DELTA: int = 52    # BBO volume-only update (no price change)
CTAG_QUOTE_PRICE: int = 53           # BBO with increment-based bid (delta)
CTAG_QUOTE_PRICE_DEC: int = 54       # BBO with absolute increment-based bid

# --- Record tags — absolute trade price (increment-based) --------------------
CTAG_TRADE_PRICE: int = 60           # Trade with delta increment price
CTAG_TRADE_PRICE_DEC: int = 61       # Trade with absolute increment price
CTAG_TRADE_PRICE_ALT: int = 62       # Trade + order volumes (delta increments)
CTAG_TRADE_PRICE_DEC_ALT: int = 63   # Trade + order volumes (absolute increments)

# --- Record tags — bar price (increment-based) -------------------------------
CTAG_BAR_PRICE: int = 65             # Bar with delta low increment prices
CTAG_BAR_PRICE_DEC: int = 66         # Bar with absolute increment prices

# --- Record tags — market state / session events -----------------------------
CTAG_MARKET_MODE: int = 100           # Market mode change (pre-open, open, etc.)
CTAG_MARKET_SETTLEMENT: int = 101     # Settlement price (tick-based)
CTAG_MARKET_HELD_SETTLEMENT: int = 102 # Held settlement price (tick-based)
CTAG_MARKET_CLEARED_VOLUME: int = 103 # Cleared volume for the session
CTAG_MARKET_OPEN_INTEREST: int = 104  # Open interest update
CTAG_MARKET_VWAP: int = 105           # VWAP (tick-based)
CTAG_MARKET_RFQ: int = 106            # Request-for-quote event

# --- Record tags — increment-based settlement/VWAP prices --------------------
CTAG_SETTLEMENT_PRICE: int = 107      # Settlement price (increment-based)
CTAG_HELD_SETTLEMENT_PRICE: int = 108 # Held settlement (increment-based)
CTAG_VWAP_PRICE: int = 109            # VWAP (increment-based)

# --- Record tags — price change (TickChange aggregation) ---------------------
CTAG_PRICE_CHANGE: int = 140          # Price change with delta increments
CTAG_PRICE_CHANGE_DEC: int = 141      # Price change with absolute increments

# --- Record tags — TPO price (increment-based) -------------------------------
CTAG_TPO_START_PRICE: int = 190       # TPO start with delta base increments
CTAG_TPO_START_PRICE_DEC: int = 191   # TPO start with absolute base increments
CTAG_TPO_PRICE: int = 192             # TPO data point (increment-based)
CTAG_TPO_OPEN_PRICE: int = 193        # TPO opening (increment-based)
CTAG_TPO_CLOSE_PRICE: int = 194       # TPO closing (increment-based)
CTAG_TPO_OPENCLOSE_PRICE: int = 195   # TPO open+close (increment-based)


# --- Bar start time truncation ------------------------------------------------


def get_bar_start_time(
    time: NDateTime | int,
    trade_date: NDateTime | int,
    data_type: ChartDataType,
) -> NDateTime | int:
    """Get the start time of a bar, truncated to the appropriate boundary.

    Accepts either ``NDateTime`` objects or raw ticks (int). Returns the same
    type that was passed in for ``time``.
    """
    if isinstance(time, int):
        td_ticks = trade_date if isinstance(trade_date, int) else trade_date.ticks
        return _get_bar_start_time_ticks(time, td_ticks, data_type)
    td = trade_date if isinstance(trade_date, NDateTime) else NDateTime(trade_date)
    return _get_bar_start_time_ndt(time, td, data_type)


def _get_bar_start_time_ndt(
    time: NDateTime, trade_date: NDateTime, data_type: ChartDataType
) -> NDateTime:
    if data_type == Second:
        return NDateTime(time.year, time.month, time.day, time.hour, time.minute, time.second, 0)
    if data_type in (Minute, TPO):
        return NDateTime(time.year, time.month, time.day, time.hour, time.minute, 0, 0)
    if data_type == Hour:
        return NDateTime(time.year, time.month, time.day, time.hour, 0, 0, 0)
    if data_type == Day:
        return trade_date
    return time


def _get_bar_start_time_ticks(
    time_ticks: int, trade_date_ticks: int, data_type: ChartDataType
) -> int:
    if data_type == Second:
        t = NDateTime(time_ticks)
        return NDateTime(t.year, t.month, t.day, t.hour, t.minute, t.second, 0).ticks
    if data_type in (Minute, TPO):
        t = NDateTime(time_ticks)
        return NDateTime(t.year, t.month, t.day, t.hour, t.minute, 0, 0).ticks
    if data_type == Hour:
        t = NDateTime(time_ticks)
        return NDateTime(t.year, t.month, t.day, t.hour, 0, 0, 0).ticks
    if data_type == Day:
        return trade_date_ticks
    return time_ticks
