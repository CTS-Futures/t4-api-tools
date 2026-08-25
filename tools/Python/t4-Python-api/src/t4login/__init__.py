"""t4login — Python port of the T4 Java API (Phase 1).

Phase 1 ships the following packages:

``t4login.client``
    :class:`~t4login.client.ChartClient` — HTTP client for the T4 Chart API
    (barchart + tradehistory).

``t4login.definitions.chartdata``
    Port of ``com.t4login.definitions.chartdata``: binary stream readers
    (aggregated T4BinAggr and non-aggregated T4Bin), chart-format tag
    constants, and the mutable :class:`~t4login.definitions.chartdata.chart_data_state.ChartDataState`.

``t4login.definitions.priceconversion``
    :class:`~t4login.definitions.priceconversion.price.Price`,
    :class:`~t4login.definitions.priceconversion.vpt.VPT`, and
    :class:`~t4login.definitions.priceconversion.i_market_conversion.IMarketConversion`.

``t4login.datetime_``
    :class:`~t4login.datetime_.NDateTime` — .NET-compatible ticks-based DateTime shim.

``t4login.definitions``
    Supporting enums and value types:
    :class:`~t4login.definitions.bid_offer.BidOffer`,
    :class:`~t4login.definitions.market_mode.MarketMode`.

Import conventions
------------------
The recommended way to import public symbols is via their owning module::

    from t4login.client.chart_client import ChartClient
    from t4login.datetime_.n_date_time import NDateTime

The ``client`` and ``datetime_`` sub-packages also re-export their primary
symbol for convenience::

    from t4login.client import ChartClient
    from t4login.datetime_ import NDateTime

Internal packages (``connection``, ``message``, ``util``) are implementation
details and do not re-export anything.
"""
