import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'proto')))
from proto.t4.v1 import service_pb2 #utilizes service.proto

class ClientMessageHelper:
    @staticmethod
    def create_client_message(message_dict: dict) -> service_pb2.ClientMessage: #returns a protobuf readable by the websocket api (client message)
        client_msg = service_pb2.ClientMessage()

        #puts a message into its corresponding "envelope" client message
        if "login_request" in message_dict:
            client_msg.login_request.CopyFrom(message_dict["login_request"]) #.CopyFrom() method allows to transfer data between messages
        elif "authentication_token_request" in message_dict:
            client_msg.authentication_token_request.CopyFrom(message_dict["authentication_token_request"])
        elif "market_depth_subscribe" in message_dict:
            client_msg.market_depth_subscribe.CopyFrom(message_dict["market_depth_subscribe"])
        elif "market_by_order_subscribe" in message_dict:
            client_msg.market_by_order_subscribe.CopyFrom(message_dict["market_by_order_subscribe"])
        elif "account_subscribe" in message_dict:
            client_msg.account_subscribe.CopyFrom(message_dict["account_subscribe"])
        elif "order_submit" in message_dict:
            client_msg.order_submit.CopyFrom(message_dict["order_submit"])
        elif "order_revise" in message_dict:
            client_msg.order_revise.CopyFrom(message_dict["order_revise"])
        elif "order_pull" in message_dict:
            client_msg.order_pull.CopyFrom(message_dict["order_pull"])
        elif "create_uds" in message_dict:
            client_msg.create_uds.CopyFrom(message_dict["create_uds"])
        elif "heartbeat" in message_dict:
            client_msg.heartbeat.CopyFrom(message_dict["heartbeat"])
        else:
            raise ValueError(f"Unsupported message type: {list(message_dict.keys())[0]}")

        return client_msg
