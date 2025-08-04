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
use uuid::Uuid;

use crate::clientMessageHelper::{ClientPayload, create_client_message};
use crate::client::t4proto::v1::service::{client_message::Payload, Heartbeat};
use serde::Deserialize;


use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use reqwest::Client as HttpClient;
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
    write_handle: Option<Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, WsMessage>>>>, //allows us to be able to write to the websocket even after connection starts


    //token attributes
    jw_token: Option<String>,
    jw_expiration: Option<i64>,
    pending_token_request: Option<JoinHandle<anyhow::Result<String>>>,
    token_resolvers: HashMap<String, oneshot::Sender<String>>,
    accounts: HashMap<String, t4proto::v1::auth::login_response::Account>, 

    pub on_account_update: Option<Box<dyn Fn(Vec<t4proto::v1::auth::login_response::Account>) + Send + Sync>>,

}

impl Client {
    pub fn new(config: WebSocketConfig) -> Self {
        Self { 
            config, 
            running: false, 
            write_handle: None,
            jw_token: None,
            jw_expiration: None,
            pending_token_request: None,
            token_resolvers: HashMap::new(),
            accounts: HashMap::new(),
            on_account_update: None,

        }
    }

    /// Connect to the WebSocket and return the stream halves
    /// Connect to WebSocket and authenticate
pub async fn connect(client: Arc<Mutex<Client>>) {
    let mut this = client.lock().await;
    println!("Connecting to {}", this.config.url);

    let (ws_stream, _) = connect_async(&this.config.url)
        .await
        .expect("Failed to connect to WebSocket");

    println!("Connected to WebSocket!");

    let (write, read) = ws_stream.split();
    let write_arc = Arc::new(Mutex::new(write));
    this.write_handle = Some(write_arc.clone());

    this.authenticate(write_arc.clone()).await;
    this.start_heartbeat(write_arc.clone());
    this.running = true;

    drop(this); // release lock before spawning listen

    tokio::spawn(async move {
        Client::listen(client.clone(), read).await;
    });
}


    //disconnects from websocket
pub async fn disconnect(client: Arc<Mutex<Client>>) {
    let mut this = client.lock().await;

    if let Some(handle) = this.write_handle.take() {
        let mut w = handle.lock().await;
        if let Err(e) = w.close().await {
            println!("Error closing connection: {}", e);
        }
    }

    this.running = false;
    println!("Disconnected");
}


 async fn listen(
    client: Arc<Mutex<Client>>,
    mut read: futures_util::stream::SplitStream<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>>
) {
    while let Some(msg) = read.next().await {
        match msg {
            Ok(WsMessage::Binary(bin)) => {
                match t4proto::v1::service::ServerMessage::decode(&*bin) {
                    Ok(server_msg) => {
                        let mut client = client.lock().await;
                        client.process_server_message(server_msg).await;
                    }
                    Err(e) => {
                        println!("Failed to decode ServerMessage: {}", e);
                    }
                }
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
}

    pub fn handle_login(&mut self, message: t4proto::v1::auth::LoginResponse) {
        // Successful connection = 0
        if message.result == 0 {
            // Store login response if you want to keep it
            // self.login_response = Some(message.clone()); // Requires adding login_response field

            // Store token
            if let Some(auth_token) = &message.authentication_token {
                if let Some(token_str) = &auth_token.token {
                    if !token_str.is_empty() {
                        self.jw_token = Some(token_str.clone());

                        if let Some(expire_time) = &auth_token.expire_time {
                            self.jw_expiration = Some(expire_time.seconds * 1000);
                            println!("Token expires at: {}", self.jw_expiration.unwrap());
                        }
                    }
                }
                // Store accounts
                println!("handle_login called with {} accounts", message.accounts.len());
                for acc in &message.accounts {
                    // Make sure you have a HashMap<String, AccountType> in your struct
                    self.accounts.insert(acc.account_id.clone(), acc.clone());

                }

                //TODO: update account info
               // Call the callback if set
               
                if let Some(callback) = &self.on_account_update {
                    println!("Triggering on_account_update");
                    callback(self.accounts.values().cloned().collect());
                }
            }
        }
    }
    
        
    pub async fn process_server_message(&mut self, server_msg: t4proto::v1::service::ServerMessage){
        
        match server_msg.payload {
            Some(t4proto::v1::service::server_message::Payload::AuthenticationToken(resp)) => {
                println!("Got token: {:?}", resp);
            }
            Some(t4proto::v1::service::server_message::Payload::LoginResponse(resp)) => {
                
                self.handle_login(resp)
            }
            _ => {
                println!("Other server message: {:?}", server_msg);
            }
        }
        
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

    //refreshes token 
    pub async fn refresh_token(&mut self) -> anyhow::Result<String> {

        //requires a uuid
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.token_resolvers.insert(request_id.clone(), tx);

        //packs message
        let token_req = t4proto::v1::auth::AuthenticationTokenRequest {
            request_id: request_id.clone(),
        };
        let client_msg = create_client_message(ClientPayload::AuthenticationTokenRequest(token_req));

        let mut buf = Vec::new();
        client_msg.encode(&mut buf)?;
        if let Some(write) = &self.write_handle {
            let mut w = write.lock().await; //locks for an exclusive write
            w.send(WsMessage::Binary(buf)).await?; //sends the message
        }

        //wait for 30seconds for a response
        let token = tokio::time::timeout(std::time::Duration::from_secs(30), rx).await??;
        Ok(token)//returns the token
    }

    pub async fn get_auth_token(&mut self) -> anyhow::Result<String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;

        // If token exists and is still valid, return it
        if let (Some(token), Some(exp)) = (&self.jw_token, self.jw_expiration) {
            if exp > now + 30 {
                return Ok(token.clone());
            }
        }

        // If a request is already pending, wait for it
        if let Some(handle) = self.pending_token_request.take() {
            let token = handle.await??;
            return Ok(token);
        }

        // No pending request — refresh token directly (no tokio::spawn needed)
        let token = self.refresh_token().await?;
        Ok(token)
    }

    //gets the market id from the exchange and contract id
    pub async fn get_market_id(&mut self, exchange_id: &str, contract_id: &str) -> anyhow::Result<Option<String>> {
        let mut headers = reqwest::header::HeaderMap::new(); //user the headers map from the reqwest library
        headers.insert("Content-Type", "application/json".parse()?);

        //check whether or not to use an api key
        if !self.config.api.is_empty(){
            headers.insert("Authorization", format!("APIKey {}", self.config.api).parse()?);
        } else {
            let token = self.get_auth_token().await?;
            headers.insert("Authorization", format!("Bearer {}", token).parse()?);
        }
        let client = HttpClient::new();
        let url = format!(
            "{}/markets/picker/firstmarket?exchangeid={}&contractid={}",
            self.config.api, exchange_id, contract_id
        );

        let res = client.get(&url).headers(headers).send().await?;
        if res.status() != 200 {
            println!("Error inside: {:?}", res.status());
            return Ok(None);
        }

        let json: serde_json::Value = res.json().await?;
        Ok(json.get("marketID").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }


}

// Helper to share client in GUI
pub type SharedClient = Arc<Mutex<Client>>;