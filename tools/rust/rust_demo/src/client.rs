use std::sync::{Arc};
use tokio_tungstenite::{
    tungstenite::protocol::Message as WsMessage,
    MaybeTlsStream, WebSocketStream,
};
use tokio::time::{self, Duration};
use prost::Message as ProstMessage; // For .encode()
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use futures_util::stream::SplitSink;
use tokio::sync::Mutex;
use tokio::task;
use crate::clientMessageHelper::{ClientPayload, create_client_message};
use crate::client::t4proto::v1::service::{self, client_message::Payload, Heartbeat};
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

        //ability to make a pointer to write 
        let write = Arc::new(Mutex::new(write));
        // Immediately authenticate after connecting

        self.authenticate(write.clone()).await;
        self.start_heartbeat(write.clone());
        // Listen for server messages (temporary debug)
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(WsMessage::Binary(bin)) => {
                        println!("Received binary: {} bytes", bin.len());
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
    async fn authenticate(
        &self,
        write: Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, WsMessage>>>,
    ) {
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

        let client_msg = create_client_message(ClientPayload::LoginRequest(login_info));

        let mut buf = Vec::new();
        client_msg.encode(&mut buf).unwrap();

        let mut w = write.lock().await;
        w.send(WsMessage::Binary(buf))
            .await
            .expect("Failed to send login request");

        println!("Login request sent!");
    }

     fn start_heartbeat(
        &self,
        write: Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, WsMessage>>>,
    ) {
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(20));
            loop {
                interval.tick().await;

                let heartbeat_msg = ClientMessage {
                    payload: Some(Payload::Heartbeat(Heartbeat {
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    })),
                };

                let mut buf = Vec::new();
                heartbeat_msg.encode(&mut buf).unwrap();

                let mut w = write.lock().await;
                if let Err(e) = w.send(WsMessage::Binary(buf)).await {
                    println!("Failed to send heartbeat: {}", e);
                    break;
                }

                println!("heartbeat sent");
            }
        });
    }
}

// Helper to share client in GUI
pub type SharedClient = Arc<Mutex<Client>>;