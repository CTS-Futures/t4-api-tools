use std::sync::{Arc};
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;
use prost::Message as ProstMessage; // For .encode()
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio::sync::Mutex;
use tokio::task;

use serde::Deserialize;
pub mod t4proto {
    pub mod v1 {
        pub mod auth {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.auth.rs"));
        }
        pub mod service {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.service.rs"));
        }
        pub mod market {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.market.rs"));
        }
        pub mod account {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.account.rs"));
        }
        pub mod orderrouting {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.orderrouting.rs"));
        }
        pub mod common {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.common.rs"));
        }
    }
}
use t4proto::v1::service::ClientMessage;

#[derive(Debug, Deserialize)]
pub struct WebSocketConfig {
    pub url: String,
    pub api: String,
    pub firm: String,
    pub username: String,
    pub password: String,
    pub app_name: String,
    pub app_license: String,
    pub md_exchange_id: String,
    pub md_contract_id: String,
    pub priceFormat: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct Config {
    pub websocket: WebSocketConfig,
   
}

pub struct Client {
    config: WebSocketConfig,
    running: bool,
}

impl Client {
    pub fn new(config: WebSocketConfig) -> Self {
        Self { config, running: false}
    }

    /// Connect to the WebSocket and return the stream halves
    /// Connect to WebSocket and authenticate
    pub async fn connect(&mut self) {
        println!("Connecting to {}", self.config.url);

        let (ws_stream, _) = connect_async(&self.config.url)
            .await
            .expect("Failed to connect to WebSocket");

        println!("Connected to WebSocket!");

        let (mut write, mut read) = ws_stream.split();

        // Immediately authenticate after connecting
        self.authenticate(&mut write).await;

        // Listen for server messages (temporary debug)
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(WsMessage::Binary(bin)) => {
                        println!("Received binary: {} bytes", bin.len());
                    }
                    Ok(WsMessage::Text(txt)) => {
                        println!("Received text: {}", txt);
                    }
                    Ok(WsMessage::Close(_)) => {
                        println!("Server closed connection");
                        break;
                    }
                    Err(e) => {
                        println!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    /// Send LoginRequest protobuf wrapped in ClientMessage
    async fn authenticate(&self, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, WsMessage>) {
        println!("Authenticating...");

        let login_info = t4proto::v1::auth::LoginRequest {
            firm: self.config.firm.clone(),
            username: self.config.username.clone(),
            password: self.config.password.clone(),
            app_name: self.config.app_name.clone(),
            app_license: self.config.app_license.clone(),
            api_key: String::new(),
            price_format: self.config.priceFormat.unwrap_or(0) as i32,
        };

        let client_msg = t4proto::v1::service::ClientMessage {
            payload: Some(
                t4proto::v1::service::client_message::Payload::LoginRequest(login_info),
            ),
        };

        let mut buf = Vec::new();
        client_msg.encode(&mut buf).unwrap();

        write.send(WsMessage::Binary(buf))
            .await
            .expect("Failed to send login request");

        println!("Login request sent!");
    }
}

// Helper to share client in GUI
pub type SharedClient = Arc<Mutex<Client>>;