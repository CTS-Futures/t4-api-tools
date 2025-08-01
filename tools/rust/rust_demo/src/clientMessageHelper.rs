use prost::Message as ProstMessage;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;
use futures_util::SinkExt;
use crate::client::t4proto::v1::{
    auth, market, account, orderrouting, common,
    service::{self,ClientMessage, client_message, Heartbeat},
};

/// Enum representing all possible payloads you can wrap in a ClientMessage.
pub enum ClientPayload {
    LoginRequest(auth::LoginRequest),
    AuthenticationTokenRequest(auth::AuthenticationTokenRequest),
    MarketDepthSubscribe(market::MarketDepthSubscribe),
    MarketByOrderSubscribe(market::MarketByOrderSubscribe),
    AccountSubscribe(account::AccountSubscribe),
    OrderSubmit(orderrouting::OrderSubmit),
    OrderRevise(orderrouting::OrderRevise),
    OrderPull(orderrouting::OrderPull),
    CreateUds(orderrouting::CreateUds),
    Heartbeat(service::Heartbeat),
}

/// Helper function to create a ClientMessage from any payload.
pub fn create_client_message(payload: ClientPayload) -> ClientMessage {
    let payload_enum = match payload {
        ClientPayload::LoginRequest(msg) => {
            client_message::Payload::LoginRequest(msg)
        }
        ClientPayload::AuthenticationTokenRequest(msg) => {
            client_message::Payload::AuthenticationTokenRequest(msg)
        }
        ClientPayload::MarketDepthSubscribe(msg) => {
            client_message::Payload::MarketDepthSubscribe(msg)
        }
        ClientPayload::MarketByOrderSubscribe(msg) => {
            client_message::Payload::MarketByOrderSubscribe(msg)
        }
        ClientPayload::AccountSubscribe(msg) => {
            client_message::Payload::AccountSubscribe(msg)
        }
        ClientPayload::OrderSubmit(msg) => {
            client_message::Payload::OrderSubmit(msg)
        }
        ClientPayload::OrderRevise(msg) => {
            client_message::Payload::OrderRevise(msg)
        }
        ClientPayload::OrderPull(msg) => {
            client_message::Payload::OrderPull(msg)
        }
        ClientPayload::CreateUds(msg) => {
            client_message::Payload::CreateUds(msg)
        }
        ClientPayload::Heartbeat(msg) => {
            client_message::Payload::Heartbeat(msg)
        }
    };

    ClientMessage {
        payload: Some(payload_enum),
    }
}

