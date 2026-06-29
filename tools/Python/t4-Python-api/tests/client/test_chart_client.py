"""Unit tests for :class:`ChartClient`.

Uses ``pytest-httpx`` to stub the HTTP layer so these tests do not require
network access or credentials. They cover:

* URL construction and query-parameter handling for both endpoints.
* ``Authorization`` and ``Accept`` header propagation.
* JSON decoding of the response body.
* The binary decode path (envelope-stripping + ``ChartDataStreamReaderAggr``).
* HTTP error propagation (``raise_for_status``).
"""

from __future__ import annotations

import pytest

from t4login.client.chart_client import ChartClient

from .conftest import CollectingHandler


# ---------------------------------------------------------------------------
# Fixture payloads
# ---------------------------------------------------------------------------
# Minimal but realistic JSON shapes returned by the live API. The unit tests
# only assert on a handful of fields, but keeping the full shape makes the
# fixtures easy to reuse when adding new assertions later.

SAMPLE_JSON_BARCHART: dict = {
    "tradeDateStart": "2024-01-08T00:00:00",
    "tradeDateEnd": "2024-01-08T00:00:00",
    "activeMarket": "XCME_Eq ES (H24)",
    "bars": [
        {
            "tradeDate": "2024-01-08T00:00:00",
            "time": "2024-01-08T00:00:00",
            "closeTime": "2024-01-08T15:59:59.5853624",
            "marketID": "XCME_Eq ES (H24)",
            "openPrice": "473575",
            "highPrice": "480325",
            "lowPrice": "471525",
            "closePrice": "479800",
            "volume": 1339989,
            "volumeAtBid": 665050,
            "volumeAtOffer": 674939,
            "trades": 320624,
            "tradesAtBid": 152333,
            "tradesAtOffer": 168291,
        }
    ],
    "marketDefinitions": [
        {
            "marketID": "XCME_Eq ES (H24)",
            "minPriceIncrement": "25",
            "priceCode": "",
            "tickValue": 12.5,
            "vpt": "",
        }
    ],
    "modeChanges": [],
    "openInterests": [],
    "settlements": [],
}

SAMPLE_JSON_TRADEHISTORY: dict = {
    "exchangeID": "CME_E",
    "contractID": "YM",
    "marketID": "XCME_E YM (H24)",
    "requestStatusMessage": "",
    "tradeDateStart": "2024-01-08T00:00:00",
    "tradeDateEnd": "2024-01-08T00:00:00",
    "trades": [
        {
            "marketID": "XCME_E YM (H24)",
            "tradeDate": "2024-01-08T00:00:00",
            "time": "2024-01-07T17:00:00",
            "tradePrice": "37674",
            "aggressorSide": 1,
        }
    ],
    "marketDefinitions": [],
    "modeChanges": [],
    "openInterests": [],
    "settlements": [],
    "vwaPs": [],
}


# ---------------------------------------------------------------------------
# /chart/barchart (JSON)
# ---------------------------------------------------------------------------


class TestGetBarchartJson:
    def test_returns_parsed_json(self, httpx_mock) -> None:
        httpx_mock.add_response(
            url=(
                "https://api-sim.t4login.com/chart/barchart"
                "?exchangeId=CME&contractId=ES&chartType=Bar"
                "&barInterval=Minute&barPeriod=1"
                "&tradeDateStart=2024-01-08&tradeDateEnd=2024-01-08"
            ),
            json=SAMPLE_JSON_BARCHART,
        )

        with ChartClient(token="test-token") as client:
            result = client.get_barchart_json(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        assert result["activeMarket"] == "XCME_Eq ES (H24)"
        assert len(result["bars"]) == 1
        assert result["bars"][0]["volume"] == 1339989

    def test_sends_auth_header(self, httpx_mock) -> None:
        httpx_mock.add_response(json=SAMPLE_JSON_BARCHART)

        with ChartClient(token="my-secret-token") as client:
            client.get_barchart_json(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["authorization"] == "Bearer my-secret-token"
        assert request.headers["accept"] == "application/json"

    def test_optional_params_included(self, httpx_mock) -> None:
        httpx_mock.add_response(json=SAMPLE_JSON_BARCHART)

        with ChartClient(token="t") as client:
            client.get_barchart_json(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
                market_id="XCME_Eq ES (H24)",
                continuation_type="Volume",
                reset_interval="TradingDay",
            )

        request = httpx_mock.get_request()
        assert request is not None
        # marketID is URL-encoded; just confirm it made it onto the query string.
        assert "marketID" in str(request.url)


# ---------------------------------------------------------------------------
# /chart/barchart (binary)
# ---------------------------------------------------------------------------


class TestGetBarchartBinary:
    def test_decodes_binary_response(self, httpx_mock) -> None:
        """Feed a minimal valid T4BinAggr SOF record and confirm the decode path runs.

        The SOF record alone does not produce any Bar callbacks — this test
        just exercises envelope-stripping + reader wiring without crashing.
        """
        import struct

        from t4login.definitions.chartdata.chart_format_aggr import (
            CTAG_SOF,
            CVAL_T4BINAGGR_VERSION,
        )
        from t4login.util.encoding import encode_7bit_int

        # T4BinAggr SOF record layout:
        #   <length:7bit-int> <tag=CTAG_SOF=1> <version:4-byte LE int>
        sof_body = encode_7bit_int(CTAG_SOF) + struct.pack("<i", CVAL_T4BINAGGR_VERSION)
        record = encode_7bit_int(len(sof_body)) + sof_body

        httpx_mock.add_response(content=record)

        handler = CollectingHandler()
        with ChartClient(token="t") as client:
            client.get_barchart_binary(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
                handler=handler,
            )

        assert handler.bars == []

    def test_sends_binary_accept_header(self, httpx_mock) -> None:
        httpx_mock.add_response(content=b"")

        handler = CollectingHandler()
        with ChartClient(token="t") as client:
            client.get_barchart_binary(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
                handler=handler,
            )

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["accept"] == "application/octet-stream"


# ---------------------------------------------------------------------------
# /chart/tradehistory (JSON)
# ---------------------------------------------------------------------------


class TestGetTradehistoryJson:
    def test_returns_parsed_json(self, httpx_mock) -> None:
        httpx_mock.add_response(json=SAMPLE_JSON_TRADEHISTORY)

        with ChartClient(token="t") as client:
            result = client.get_tradehistory_json(
                exchange_id="CME_E",
                contract_id="YM",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        assert result["marketID"] == "XCME_E YM (H24)"
        assert len(result["trades"]) == 1
        assert result["trades"][0]["tradePrice"] == "37674"

    def test_sends_auth_and_accept_headers(self, httpx_mock) -> None:
        httpx_mock.add_response(json=SAMPLE_JSON_TRADEHISTORY)

        with ChartClient(token="bearer-abc") as client:
            client.get_tradehistory_json(
                exchange_id="CME_E",
                contract_id="YM",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["authorization"] == "Bearer bearer-abc"
        assert request.headers["accept"] == "application/json"

    def test_date_range_params(self, httpx_mock) -> None:
        """``start``/``end`` are sent as-is and tradeDateStart is omitted."""
        httpx_mock.add_response(json=SAMPLE_JSON_TRADEHISTORY)

        with ChartClient(token="t") as client:
            client.get_tradehistory_json(
                exchange_id="CME_E",
                contract_id="YM",
                start="2024-01-07T17:00:00",
                end="2024-01-08T16:00:00",
            )

        request = httpx_mock.get_request()
        assert request is not None
        url_str = str(request.url)
        assert "start=" in url_str
        assert "end=" in url_str
        assert "tradeDateStart" not in url_str


# ---------------------------------------------------------------------------
# /chart/tradehistory (binary)
# ---------------------------------------------------------------------------


class TestGetTradehistoryBinary:
    def test_returns_stream_reader(self, httpx_mock) -> None:
        """Empty response body → reader.read() returns False immediately."""
        httpx_mock.add_response(content=b"")

        with ChartClient(token="t") as client:
            reader = client.get_tradehistory_binary(
                exchange_id="CME_E",
                contract_id="YM",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        assert reader.read() is False

    def test_sends_binary_accept_header(self, httpx_mock) -> None:
        httpx_mock.add_response(content=b"")

        with ChartClient(token="t") as client:
            client.get_tradehistory_binary(
                exchange_id="CME_E",
                contract_id="YM",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
            )

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["accept"] == "application/octet-stream"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """HTTP errors must propagate via ``raise_for_status`` instead of being swallowed."""

    def test_raises_on_401(self, httpx_mock) -> None:
        httpx_mock.add_response(status_code=401)

        with pytest.raises(Exception):  # httpx.HTTPStatusError
            with ChartClient(token="bad-token") as client:
                client.get_barchart_json(
                    exchange_id="CME",
                    contract_id="ES",
                    trade_date_start="2024-01-08",
                    trade_date_end="2024-01-08",
                )

    def test_raises_on_400(self, httpx_mock) -> None:
        httpx_mock.add_response(status_code=400)

        with pytest.raises(Exception):
            with ChartClient(token="t") as client:
                client.get_tradehistory_json(
                    exchange_id="CME_E",
                    contract_id="YM",
                    trade_date_start="2024-01-08",
                    trade_date_end="2024-01-08",
                )

    def test_raises_on_binary_response_with_no_sof_signature(self, httpx_mock) -> None:
        """Non-empty binary body with no T4Bin SOF marker raises ValueError.

        An empty body is a legitimate "no data" result and must NOT raise.
        A non-empty body with no recognisable SOF indicates a corrupt or
        unexpected response and must be surfaced immediately.
        """
        httpx_mock.add_response(content=b"\x00\x01\x02\x03")

        with pytest.raises(ValueError, match="No T4Bin SOF signature"):
            with ChartClient(token="t") as client:
                client.get_barchart_binary(
                    exchange_id="CME",
                    contract_id="ES",
                    trade_date_start="2024-01-08",
                    trade_date_end="2024-01-08",
                    handler=CollectingHandler(),
                )

    def test_empty_binary_body_does_not_raise(self, httpx_mock) -> None:
        """Empty body (HTTP 204-style or truly empty 200) is a valid no-data case."""
        httpx_mock.add_response(content=b"")

        # Should not raise — empty payload returns an empty-reading reader / no callbacks.
        handler = CollectingHandler()
        with ChartClient(token="t") as client:
            client.get_barchart_binary(
                exchange_id="CME",
                contract_id="ES",
                trade_date_start="2024-01-08",
                trade_date_end="2024-01-08",
                handler=handler,
            )
        assert handler.bars == []
