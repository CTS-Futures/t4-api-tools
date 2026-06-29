"""Price conversion and formatting for T4 markets.

Provides:

- :class:`~t4login.definitions.priceconversion.price.Price` — immutable
  high-precision price value (backed by ``decimal.Decimal`` at 18-digit scale).
- :class:`~t4login.definitions.priceconversion.vpt.VPT` — Variable Price Tick
  tree for non-uniform tick sizes across price levels.
- :class:`~t4login.definitions.priceconversion.i_market_conversion.IMarketConversion`
  — structural protocol that any market-parameter provider must satisfy.
"""
