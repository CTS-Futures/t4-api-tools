"""Unit tests for account-snapshot order_trade handling (no network needed).

Encodes a real ServerMessage with the generated bindings and decodes it before
driving the client, so these also prove AccountSnapshotMessage.order_trade
(field 9) survives the wire round-trip. They fail until proto/t4/v2/account/
account_pb2.py is regenerated from the top-level proto/ directory.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from T4APIClient import Client  # noqa: E402
from t4.v2 import service_pb2  # noqa: E402
from t4.v2.common.enums_pb2 import BuySell  # noqa: E402
from tools.ProtoUtils import decode_message, encode_message  # noqa: E402


_CONFIG = {"websocket": {"url": "", "api": ""}}


def _new_client():
    client = Client(_CONFIG)
    client.events = []
    client.on_account_update = client.events.append
    return client


def _snapshot_bytes():
    """An account snapshot holding one working order and two of its fills."""
    message = service_pb2.ServerMessage()
    snapshot = message.account_snapshot
    snapshot.account_id = "ACC1"

    order = snapshot.messages.add().order_status
    order.unique_id = "ORD1"
    order.account_id = "ACC1"
    order.market_id = "MKT1"
    order.buy_sell = BuySell.BUY_SELL_BUY

    for sequence, (volume, price) in enumerate(
        [("2", "4200.50"), ("3", "4201.00")], start=1
    ):
        trade = snapshot.messages.add().order_trade
        trade.order_id = "ORD1"
        trade.account_id = "ACC1"
        trade.market_id = "MKT1"
        trade.sequence_order = sequence
        trade.volume.value = volume
        trade.price.value = price

    return encode_message(message)


def _deliver(client):
    """Decode a fresh snapshot and hand it to the client, as the reader would."""
    decoded = decode_message(_snapshot_bytes())
    client.handle_account_snapshot(decoded.account_snapshot)
    return decoded


def _fills(client):
    return [event for event in client.events if event.get("type") == "fill"]


def test_order_trade_survives_the_wire_round_trip():
    decoded = decode_message(_snapshot_bytes())
    payloads = [item.WhichOneof("payload") for item in decoded.account_snapshot.messages]
    assert payloads == ["order_status", "order_trade", "order_trade"]


def test_snapshot_trades_emit_fills_with_side_from_the_parent_order():
    client = _new_client()
    _deliver(client)

    fills = _fills(client)
    assert len(fills) == 2
    assert fills[0]["buy_sell"] == BuySell.BUY_SELL_BUY
    assert fills[0]["from_snapshot"] is True
    assert fills[0]["price"] == "4200.50"
    assert fills[0]["volume"] == "2"


def test_replaying_the_snapshot_does_not_duplicate_fills():
    client = _new_client()
    _deliver(client)
    _deliver(client)  # a reconnect re-sends the snapshot

    assert len(_fills(client)) == 2


def test_live_trade_after_a_snapshot_trade_is_still_emitted():
    client = _new_client()
    _deliver(client)

    live = decode_message(_snapshot_bytes()).account_snapshot.messages[1].order_trade
    live.sequence_order = 3
    client.handle_order_trade(live)

    fills = _fills(client)
    assert len(fills) == 3
    assert fills[2]["from_snapshot"] is False


def test_consumers_can_separate_replayed_trades_from_live_ones():
    client = _new_client()
    _deliver(client)

    live = decode_message(_snapshot_bytes()).account_snapshot.messages[1].order_trade
    live.sequence_order = 9
    client.handle_order_trade(live)

    assert [fill["from_snapshot"] for fill in _fills(client)] == [True, True, False]
