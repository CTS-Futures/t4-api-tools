"""Port of `com.t4login.definitions.chartdata.ChartDataChange`.

Standard Java enum with 16 constants (0-15). Ported to `IntEnum`.
`None` is a Python reserved word, so it is renamed to `NONE`.

Each value corresponds to the type of data that was decoded in the most recent
call to ``ChartDataStreamReader.read()`` or dispatched by the aggregated reader.
After reading a record, consumers check ``state.Change`` to determine which
fields of the state object contain fresh data.
"""

from __future__ import annotations

from enum import IntEnum


class ChartDataChange(IntEnum):
    """Type of data change decoded from the most recent stream record."""

    NONE = 0              # No meaningful change (internal framing or unknown tag)
    Trade = 1             # Individual trade executed
    Quote = 2             # Best bid/offer (BBO) update
    MarketMode = 3        # Session state transition
    Settlement = 4        # Settlement price published
    TradeBar = 5          # Aggregated OHLCV bar
    TradeDate = 6         # Trade date boundary (new session started)
    TPO = 7               # Time-Price Opportunity profile data point
    TickChange = 8        # Price change record (no volume)
    RFQ = 9               # Request-for-quote event
    HeldSettlement = 10   # Held (preliminary) settlement price
    ClearedVolume = 11    # Cleared volume for the session
    OpenInterest = 12     # Open interest update
    VWAP = 13             # Volume-weighted average price
    MarketSwitch = 14     # Active market switched in consolidated stream
    MarketDefinition = 15 # Market instrument metadata received

    @classmethod
    def get(cls, value: int) -> ChartDataChange | None:
        """Lookup by int value. Returns ``None`` if not found (mirrors Java returning null)."""
        try:
            return cls(value)
        except ValueError:
            return None
