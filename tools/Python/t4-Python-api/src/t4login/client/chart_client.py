"""HTTP client for the T4 Chart API (barchart + tradehistory)."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import httpx

from t4login.definitions.chartdata.chart_data_stream_reader import ChartDataStreamReader
from t4login.definitions.chartdata.chart_data_stream_reader_aggr import (
    ChartDataHandler,
    ChartDataStreamReaderAggr,
)
from t4login.definitions.chartdata.chart_data_type import ChartDataType, Tick as _TickDataType
from t4login.datetime_.n_date_time import NDateTime

_DEFAULT_BASE_URL = "https://api-sim.t4login.com/chart"

# T4Bin/T4BinAggr SOF record signature: <length:7bit><tag=CTAG_SOF=1><version=1 as 4-byte LE int>.
# Aggregated (T4BinAggr) SOF length = 5 (tag + version).
# Non-aggregated (T4Bin) SOF length = 13 (tag + version + 8-byte datetime).
# The HTTP binary response wraps the T4Bin payload in an envelope (header + GUID +
# request metadata) followed by the embedded T4Bin blob — we locate the blob by
# scanning for either SOF signature.
_T4BINAGGR_SOF_SIGNATURE = b"\x05\x01\x01\x00\x00\x00"
_T4BIN_SOF_SIGNATURE = b"\x0d\x01\x01\x00\x00\x00"


def _extract_t4bin_payload(content: bytes) -> bytes:
    """Strip the HTTP binary envelope and return the embedded T4Bin payload.

    The HTTP response wraps the T4Bin blob in an envelope (header + GUID +
    request metadata).  We locate the embedded blob by scanning for either
    SOF signature:

    * T4BinAggr SOF (aggregated barchart):   ``\\x05\\x01\\x01\\x00\\x00\\x00``
    * T4Bin SOF     (non-aggregated history): ``\\x0d\\x01\\x01\\x00\\x00\\x00``

    Raises:
        ValueError: If the response body is non-empty but contains no
            recognisable SOF signature — this indicates a corrupt or
            unexpected response rather than a legitimate empty result.
    """
    if not content:
        return b""
    aggr_idx = content.find(_T4BINAGGR_SOF_SIGNATURE)
    bin_idx = content.find(_T4BIN_SOF_SIGNATURE)
    candidates = [i for i in (aggr_idx, bin_idx) if i >= 0]
    if not candidates:
        raise ValueError(
            f"No T4Bin SOF signature found in {len(content)}-byte response payload. "
            "The server may have returned an error body or an unrecognised format."
        )
    return content[min(candidates):]


class ChartClient:
    """Client for the T4 Chart Data API.

    Parameters
    ----------
    token : str
        Bearer token for authentication.
    base_url : str, optional
        Base URL for the chart API (defaults to the sim environment).
    http_client : httpx.Client | None, optional
        Pre-configured httpx client. If None, one is created internally.
    """

    def __init__(
        self,
        token: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(timeout=30.0)

    def close(self) -> None:
        """Close the underlying HTTP client (only if we created it)."""
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "ChartClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # /chart/barchart
    # ------------------------------------------------------------------

    def get_barchart_json(
        self,
        *,
        exchange_id: str,
        contract_id: str,
        chart_type: str = "Bar",
        bar_interval: str = "Minute",
        bar_period: int = 1,
        trade_date_start: str,
        trade_date_end: str,
        market_id: str | None = None,
        continuation_type: str | None = None,
        reset_interval: str | None = None,
    ) -> dict[str, Any]:
        """Fetch barchart data as JSON (default response format)."""
        params = self._barchart_params(
            exchange_id=exchange_id,
            contract_id=contract_id,
            chart_type=chart_type,
            bar_interval=bar_interval,
            bar_period=bar_period,
            trade_date_start=trade_date_start,
            trade_date_end=trade_date_end,
            market_id=market_id,
            continuation_type=continuation_type,
            reset_interval=reset_interval,
        )
        resp = self._get("/barchart", params=params, accept="application/json")
        return resp.json()  # type: ignore[no-any-return]

    def get_barchart_binary(
        self,
        *,
        exchange_id: str,
        contract_id: str,
        chart_type: str = "Bar",
        bar_interval: str = "Minute",
        bar_period: int = 1,
        trade_date_start: str,
        trade_date_end: str,
        market_id: str | None = None,
        continuation_type: str | None = None,
        reset_interval: str | None = None,
        handler: ChartDataHandler,
    ) -> None:
        """Fetch barchart data in binary format and decode via ChartDataStreamReaderAggr.

        The decoded records are dispatched to the provided *handler*.
        """
        params = self._barchart_params(
            exchange_id=exchange_id,
            contract_id=contract_id,
            chart_type=chart_type,
            bar_interval=bar_interval,
            bar_period=bar_period,
            trade_date_start=trade_date_start,
            trade_date_end=trade_date_end,
            market_id=market_id,
            continuation_type=continuation_type,
            reset_interval=reset_interval,
        )
        resp = self._get("/barchart", params=params, accept="application/octet-stream")
        payload = _extract_t4bin_payload(resp.content)
        ChartDataStreamReaderAggr.read(payload, handler)

    # ------------------------------------------------------------------
    # /chart/tradehistory
    # ------------------------------------------------------------------

    def get_tradehistory_json(
        self,
        *,
        exchange_id: str,
        contract_id: str,
        market_id: str | None = None,
        trade_date_start: str | None = None,
        trade_date_end: str | None = None,
        start: str | None = None,
        end: str | None = None,
        since: str | None = None,
    ) -> dict[str, Any]:
        """Fetch trade history data as JSON (default response format).

        Date range selection — use **one** of the following:

        * ``trade_date_start`` / ``trade_date_end`` — request all ticks for
          one or more full trading sessions identified by their trade date
          (``YYYY-MM-DD`` strings).  The T4 *trade date* for a session that
          spans midnight is the date on which the session is listed, not the
          wall-clock date of each tick.

        * ``start`` / ``end`` — request ticks within an absolute intraday
          time window (ISO-8601 datetime strings).  Use this when you need a
          slice of a session rather than a whole day.

        * ``since`` — request all ticks since a given UTC datetime (ISO-8601).
          Useful for incremental polling.

        Supplying both ``trade_date_*`` and ``start``/``end`` at the same time
        is not validated here and the API will give precedence to one set;
        avoid mixing them.
        """
        params = self._tradehistory_params(
            exchange_id=exchange_id,
            contract_id=contract_id,
            market_id=market_id,
            trade_date_start=trade_date_start,
            trade_date_end=trade_date_end,
            start=start,
            end=end,
            since=since,
        )
        resp = self._get("/tradehistory", params=params, accept="application/json")
        return resp.json()  # type: ignore[no-any-return]

    def get_tradehistory_binary(
        self,
        *,
        exchange_id: str,
        contract_id: str,
        market_id: str | None = None,
        trade_date_start: str | None = None,
        trade_date_end: str | None = None,
        start: str | None = None,
        end: str | None = None,
        since: str | None = None,
        data_type: ChartDataType = _TickDataType,
    ) -> ChartDataStreamReader:
        """Fetch trade history in binary format and return a ChartDataStreamReader.

        The caller iterates the reader via ``reader.read()`` to decode individual
        records from the non-aggregated T4Bin stream.

        Date range selection — same rules as :meth:`get_tradehistory_json`:
        supply either ``trade_date_start``/``trade_date_end`` for full trading
        sessions, *or* ``start``/``end`` for an intraday slice, *or* ``since``
        for incremental polling.  Do not mix the two date styles.
        """
        params = self._tradehistory_params(
            exchange_id=exchange_id,
            contract_id=contract_id,
            market_id=market_id,
            trade_date_start=trade_date_start,
            trade_date_end=trade_date_end,
            start=start,
            end=end,
            since=since,
        )
        resp = self._get("/tradehistory", params=params, accept="application/octet-stream")
        payload = _extract_t4bin_payload(resp.content)
        stream = BytesIO(payload)
        reader = ChartDataStreamReader(
            stream=stream,
            trade_date=NDateTime(0),
            market_id=market_id or "",
            data_type=data_type,
        )
        return reader

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get(self, path: str, *, params: dict[str, str], accept: str) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": accept,
        }
        url = f"{self._base_url}{path}"
        resp = self._client.get(url, params=params, headers=headers)
        resp.raise_for_status()
        return resp

    @staticmethod
    def _barchart_params(
        *,
        exchange_id: str,
        contract_id: str,
        chart_type: str,
        bar_interval: str,
        bar_period: int,
        trade_date_start: str,
        trade_date_end: str,
        market_id: str | None,
        continuation_type: str | None,
        reset_interval: str | None,
    ) -> dict[str, str]:
        params: dict[str, str] = {
            "exchangeId": exchange_id,
            "contractId": contract_id,
            "chartType": chart_type,
            "barInterval": bar_interval,
            "barPeriod": str(bar_period),
            "tradeDateStart": trade_date_start,
            "tradeDateEnd": trade_date_end,
        }
        if market_id is not None:
            params["marketID"] = market_id
        if continuation_type is not None:
            params["continuationType"] = continuation_type
        if reset_interval is not None:
            params["resetInterval"] = reset_interval
        return params

    @staticmethod
    def _tradehistory_params(
        *,
        exchange_id: str,
        contract_id: str,
        market_id: str | None,
        trade_date_start: str | None,
        trade_date_end: str | None,
        start: str | None,
        end: str | None,
        since: str | None,
    ) -> dict[str, str]:
        params: dict[str, str] = {
            "exchangeId": exchange_id,
            "contractId": contract_id,
        }
        if market_id is not None:
            params["marketID"] = market_id
        if trade_date_start is not None:
            params["tradeDateStart"] = trade_date_start
        if trade_date_end is not None:
            params["tradeDateEnd"] = trade_date_end
        if start is not None:
            params["start"] = start
        if end is not None:
            params["end"] = end
        if since is not None:
            params["since"] = since
        return params
