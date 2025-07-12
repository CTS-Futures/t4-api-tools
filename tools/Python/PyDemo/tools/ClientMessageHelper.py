import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'proto'))) #line subject to change. due to this file not being in the same folder as "proto"
from proto.t4.v1 import service_pb2 #utilizes service.proto

class ClientMessageHelper:
    @staticmethod
    def create_client_message(message_dict: dict) -> service_pb2.ClientMessage: #returns a protobuf readable by the websocket api (client message)
        client_message = service_pb2.ClientMessage()

        if not message_dict:
            raise ValueError("Empty message dictionary")

        key = next(iter(message_dict))

        match key:
            case "login_request":
                client_message.login_request.CopyFrom(message_dict[key])
            case "authentication_token_request":
                client_message.authentication_token_request.CopyFrom(message_dict[key])
            case "market_depth_subscribe":
                client_message.market_depth_subscribe.CopyFrom(message_dict[key])
            case "market_by_order_subscribe":
                client_message.market_by_order_subscribe.CopyFrom(message_dict[key])
            case "account_subscribe":
                client_message.account_subscribe.CopyFrom(message_dict[key])
            case "order_submit":
                client_message.order_submit.CopyFrom(message_dict[key])
            case "order_revise":
                client_message.order_revise.CopyFrom(message_dict[key])
            case "order_pull":
                client_message.order_pull.CopyFrom(message_dict[key])
            case "create_uds":
                client_message.create_uds.CopyFrom(message_dict[key])
            case "heartbeat":
                client_message.heartbeat.CopyFrom(message_dict[key])
            case _:
                raise ValueError(f"Unsupported message type: {key}")

        return client_message
