import sys
import os

#adjusts system path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'proto'))) #line subject to change. due to this file not being in the same folder as "proto"
from t4.v1 import service_pb2


def encode_message(message: service_pb2.ClientMessage) -> bytes: # translates client message into binary for sending over websocket 

    return message.SerializeToString()

def decode_message(data: bytes) -> service_pb2.ServerMessage: # translates bytes server message
    """
    Parse a ServerMessage from a binary string received from WebSocket.
    """

    
    server_message = service_pb2.ServerMessage()
    server_message.ParseFromString(data)
    return server_message
