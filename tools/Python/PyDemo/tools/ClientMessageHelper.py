import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'proto'))) #line subject to change. due to this file not being in the same folder as "proto"
from t4.v2 import service_pb2  # uses the v2 service envelope

class ClientMessageHelper:
    @staticmethod
    def create_client_message(message_dict: dict) -> service_pb2.ClientMessage:
        """Wrap one v2 domain message in the WebSocket ClientMessage oneof."""
        client_message = service_pb2.ClientMessage()

        if not message_dict:
            raise ValueError("Empty message dictionary")

        key = next(iter(message_dict))

        match key:
            case "login_request":
                client_message.login_request.CopyFrom(message_dict[key])
            case "authentication_token_request":
                client_message.authentication_token_request.CopyFrom(message_dict[key])
            case "market_subscribe":
                client_message.market_subscribe.CopyFrom(message_dict[key])
            case "account_subscribe":
                client_message.account_subscribe.CopyFrom(message_dict[key])
            case "order_submit":
                client_message.order_submit.CopyFrom(message_dict[key])
            case "order_revise":
                client_message.order_revise.CopyFrom(message_dict[key])
            case "order_pull":
                client_message.order_pull.CopyFrom(message_dict[key])
            case "order_batch":
                client_message.order_batch.CopyFrom(message_dict[key])
            case "create_uds":
                client_message.create_uds.CopyFrom(message_dict[key])
            case "heartbeat":
                client_message.heartbeat.CopyFrom(message_dict[key])
            case _:
                raise ValueError(f"Unsupported message type: {key}")

        return client_message
