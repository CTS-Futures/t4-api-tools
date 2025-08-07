use std::sync::{Arc};
use tokio_tungstenite::{
    tungstenite::protocol::Message as WsMessage,
    MaybeTlsStream, WebSocketStream,
};
use serde_json::Value;
use futures_util::stream::SplitStream;
use tokio::net::TcpStream;
use tokio::time::{self, Duration};
use prost::Message as ProstMessage; // For .encode()
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use futures_util::stream::SplitSink;
use tokio::sync::Mutex;
use uuid::Uuid;
use anyhow::Result;

use crate::clientMessageHelper::{ClientPayload, create_client_message};
use crate::client::t4proto::v1::service::{client_message::Payload, Heartbeat};
use serde::Deserialize;


use crate::client::t4proto::v1::common::{DepthBuffer, DepthLevels};
use crate::client::t4proto::v1::market::MarketDepthSubscribe;

use crate::client::t4proto::v1::common::{
    ActivationType, BuySell, OrderLink, Price, PriceType, TimeType,
};
use crate::client::t4proto::v1::orderrouting::{OrderSubmit, order_submit::Order};

use prost::Message;


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
    pub api_key: String,
    pub username: String,
    pub password: String,
    pub app_name: String,
    pub app_license: String,
    pub md_exchange_id: String,
    pub md_contract_id: String,
    pub price_format: Option<u32>,
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

    selected_account: Option<String>, 
    pub on_account_update: Option<Box<dyn Fn(Vec<t4proto::v1::auth::login_response::Account>) + Send + Sync>>,
    current_subscription:  Option<MarketSubscription>,
    current_market_id: Option<String>,

}
#[derive(Debug, Clone)]
pub struct MarketSubscription {
    pub exchange_id: String,
    pub contract_id: String,
    pub market_id: String,
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
            selected_account: None,
            current_subscription: None,
            current_market_id: None,
        }
    }

    /// Connect to the WebSocket and return the stream halves
    /// Connect to WebSocket and authenticate
    pub fn set_write_handle(
        &mut self,
        write: futures_util::stream::SplitSink<
            WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
            WsMessage,
        >,
    ) {
        self.write_handle = Some(Arc::new(Mutex::new(write)));
    }

    //connects to the websocket
    pub async fn connect(
        client: Arc<Mutex<Client>>
    ) -> anyhow::Result<SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>> {
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
        Ok(read)
        // tokio::spawn(async move {
        //     Client::listen(client.clone(), read).await;
        // });
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

    // decodes all of the messages from the websocket
    pub async fn listen(
        client: Arc<Mutex<Client>>,
        mut read: futures_util::stream::SplitStream<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>>
    ) {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(WsMessage::Binary(bin)) => {
                    match t4proto::v1::service::ServerMessage::decode(&*bin) {
                        Ok(server_msg) => {
                            println!("{:?}", server_msg);
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
    pub fn get_first_account_id(&self) -> Option<String> {
    
        self.accounts.keys().next().cloned()
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
    /// necessary for websocket connection
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
            price_format: self.config.price_format.unwrap_or(0) as i32,
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

    //sends a heartbeat every 20 seconds. 
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
        if !self.config.api_key.is_empty(){
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

    
    pub async fn subscribe_account(&mut self, account_id: &str) -> anyhow::Result<()> {
        // TODO: when gui is made, we check if it's the account the user selected
        // if let Some(selected) = &self.selected_account {
        // if selected == account_id {
        //     return Ok(());
        // }

        // Unsubscribe from the previous account
        let unsubscribe_msg = t4proto::v1::account::AccountSubscribe {
            subscribe: 0, // ACCOUNT_SUBSCRIBE_TYPE_NONE
            subscribe_all_accounts: false,
            account_id: vec![account_id.to_string()],
            upl_mode: Some(0),
        };
        let client_msg = create_client_message(ClientPayload::AccountSubscribe(unsubscribe_msg));

        let mut buf = Vec::new();
        client_msg.encode(&mut buf)?;
        if let Some(write) = &self.write_handle {
            let mut w = write.lock().await;
            w.send(WsMessage::Binary(buf)).await?;
        }
    

        //Update the selected account
        self.selected_account = Some(account_id.to_string());

        //subscribe to the new account
        if !account_id.is_empty() {
            let subscribe_msg = t4proto::v1::account::AccountSubscribe {
                subscribe: 2, // ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES
                subscribe_all_accounts: false,
                account_id: vec![account_id.to_string()],
                upl_mode: Some(1),
            };
            let client_msg = create_client_message(ClientPayload::AccountSubscribe(subscribe_msg));

            let mut buf = Vec::new();
            client_msg.encode(&mut buf)?;
            if let Some(write) = &self.write_handle {
                let mut w = write.lock().await;
                w.send(WsMessage::Binary(buf)).await?;
            }

            println!("Subscribed to account: {}", account_id);
        }

        Ok(())

}

    //subscribes to a given market given an exchange id, contract id, and market id (websocket message)
    pub async fn subscribe_market(&mut self, exchange_id: &str, contract_id: &str, market_id: &str) -> anyhow::Result<()> {

        let _key = format!("{}_{}_{}", exchange_id, contract_id, market_id);

        // If already subscribed, unsubscribe first
        if let Some(current) = &self.current_subscription {
            let unsubscribe_msg = MarketDepthSubscribe {
                exchange_id: current.exchange_id.clone(),
                contract_id: current.contract_id.clone(),
                market_id: current.market_id.clone(),
                buffer: DepthBuffer::NoSubscription as i32,
                depth_levels: DepthLevels::Undefined as i32,
            };
            let client_msg =
                create_client_message(ClientPayload::MarketDepthSubscribe(unsubscribe_msg));

            let mut buf = Vec::new();
            client_msg.encode(&mut buf)?;
            if let Some(write) = &self.write_handle {
                let mut w = write.lock().await;
                w.send(WsMessage::Binary(buf)).await?;
            }

            println!(
                "Unsubscribed from market: {}",
                current.market_id
            );

            self.current_subscription = None;
        }

        // Store new subscription info
        self.current_subscription = Some(MarketSubscription {
            exchange_id: exchange_id.to_string(),
            contract_id: contract_id.to_string(),
            market_id: market_id.to_string(),
        });
       self.current_market_id = Some(market_id.to_string());

        // Send subscribe request
        let subscribe_msg = MarketDepthSubscribe {
            exchange_id: exchange_id.to_string(),
            contract_id: contract_id.to_string(),
            market_id: market_id.to_string(),
            buffer: DepthBuffer::SmartTrade as i32,
            depth_levels: DepthLevels::BestOnly as i32,
        };
        let client_msg =
            create_client_message(ClientPayload::MarketDepthSubscribe(subscribe_msg));

        let mut buf = Vec::new();
        client_msg.encode(&mut buf)?;
        if let Some(write) = &self.write_handle {
            let mut w = write.lock().await;
            w.send(WsMessage::Binary(buf)).await?;
        }

        println!("Subscribed to market: {}", market_id);

        Ok(())
    }

    //loads all of the available exchanges with the T4 api (rest api call)
    pub async fn load_exchanges(&mut self) -> anyhow::Result<()> {
        let mut headers = reqwest::header::HeaderMap::new(); //user the headers map from the reqwest library
        headers.insert("Content-Type", "application/json".parse()?);


            // Set Authorization header
        if !self.config.api_key.is_empty(){
            headers.insert("Authorization", format!("APIKey {}", self.config.api).parse()?);
        } else {
            let token = self.get_auth_token().await?;
            headers.insert("Authorization", format!("Bearer {}", token).parse()?);
        }

        let client = HttpClient::new();
        let url = format!("{}/markets/exchanges",self.config.api);
        let res = client.get(&url).headers(headers).send().await?;
        if res.status() != 200 {
            anyhow::bail!("HTTP {}: {}", res.status(), res.text().await?);
        }

        let exchanges: Vec<Value> = res.json().await?;
        println!("{:?}", exchanges);

        Ok(())
    }
    
    //loads all contracts given the exchange id (rest api call)
    pub async fn load_contracts_for_exchange(&mut self, exchange_id: &str) -> Result<()> {
        let mut headers = reqwest::header::HeaderMap::new(); //user the headers map from the reqwest library
        headers.insert("Content-Type", "application/json".parse()?);


            // Set Authorization header
        if !self.config.api_key.is_empty(){
            headers.insert("Authorization", format!("APIKey {}", self.config.api).parse()?);
        } else {
            let token = self.get_auth_token().await?;
            headers.insert("Authorization", format!("Bearer {}", token).parse()?);
        }

        let client = HttpClient::new();
        let url = format!("{}/markets/contracts?exchangeID={}",self.config.api, exchange_id);

        let res = client.get(&url).headers(headers).send().await?;

        println!("test");
        if res.status() != 200 {
            anyhow::bail!("HTTP {}: {}", res.status(), res.text().await?);
        }

        let contracts: Vec<Value> = res.json().await?;
        println!("contracts-> {:?}", contracts);

        Ok(())

    }
    // pub async fn submit_order(
    //     &mut self,
    //     side: &str,
    //     volume: i32,
    //     price: f64,
    //     price_type: &str,
    //     take_profit_dollars: Option<f64>,
    //     stop_loss_dollars: Option<f64>,
    // ) -> anyhow::Result<()> {
    //     // Ensure account & market are set
    //     let account_id = self.selected_account.clone()
    //         .ok_or_else(|| anyhow::anyhow!("No account selected"))?;
    //     let market_id = self.current_market_id.clone()
    //         .ok_or_else(|| anyhow::anyhow!("No market selected"))?;

    //     // Get market details (must be implemented in Client)
    //     let market_details = self.get_market_details(&market_id)
    //         .ok_or_else(|| anyhow::anyhow!("No market details found"))?;

    //     // Convert to enum values
    //     let price_type_value = match price_type.to_lowercase().as_str() {
    //         "market" => PriceType::PriceTypeMarket as i32,
    //         _ => PriceType::PriceTypeLimit as i32,
    //     };

    //     let buy_sell_value = match side.to_lowercase().as_str() {
    //         "buy" => BuySell::BuySellBuy as i32,
    //         _ => BuySell::BuySellSell as i32,
    //     };

    //     let has_brackets = take_profit_dollars.is_some() || stop_loss_dollars.is_some();
    //     let order_link_value = if has_brackets {
    //         OrderLink::OrderLinkAutoOco as i32
    //     } else {
    //         OrderLink::OrderLinkNone as i32
    //     };

    //     // Main order
    //     let main_order = Order {
    //         buy_sell: buy_sell_value,
    //         price_type: price_type_value,
    //         time_type: TimeType::TimeTypeNormal as i32,
    //         volume,
    //         max_show: None,
    //         max_volume: None,
    //         limit_price: if price_type_value == PriceType::PriceTypeLimit as i32 {
    //             Some(Price {
    //                 value: price.to_string(),
    //             })
    //         } else {
    //             None
    //         },
    //         stop_price: None,
    //         trail_distance: None,
    //         tag: None,
    //         activation_type: None,
    //         activation_data: None,
    //     };

    //     let mut orders = vec![main_order];

    //     let protection_side = if buy_sell_value == BuySell::BuySellBuy as i32 {
    //         BuySell::BuySellSell as i32
    //     } else {
    //         BuySell::BuySellBuy as i32
    //     };

    //     // Take profit
    //     if let Some(tp_dollars) = take_profit_dollars {
    //         let tp_points = tp_dollars / market_details.point_value.value;
    //         let tp_price = tp_points * market_details.min_price_increment.value;

    //         orders.push(Order {
    //             buy_sell: protection_side,
    //             price_type: PriceType::PriceTypeLimit as i32,
    //             time_type: TimeType::TimeTypeGoodTillCancelled as i32,
    //             volume: 0,
    //             max_show: None,
    //             max_volume: None,
    //             limit_price: Some(Price {
    //                 value: tp_price.to_string(),
    //             }),
    //             stop_price: None,
    //             trail_distance: None,
    //             tag: None,
    //             activation_type: Some(ActivationType::ActivationTypeHold as i32),
    //             activation_data: None,
    //         });
    //     }

    //     // Stop loss
    //     if let Some(sl_dollars) = stop_loss_dollars {
    //         let sl_points = sl_dollars / market_details.point_value.value;
    //         let sl_price = sl_points * market_details.min_price_increment.value;

    //         orders.push(Order {
    //             buy_sell: protection_side,
    //             price_type: PriceType::PriceTypeStopMarket as i32,
    //             time_type: TimeType::TimeTypeGoodTillCancelled as i32,
    //             volume: 0,
    //             max_show: None,
    //             max_volume: None,
    //             limit_price: None,
    //             stop_price: Some(Price {
    //                 value: sl_price.to_string(),
    //             }),
    //             trail_distance: None,
    //             tag: None,
    //             activation_type: Some(ActivationType::ActivationTypeHold as i32),
    //             activation_data: None,
    //         });
    //     }

    //     // Build OrderSubmit
    //     let submit_msg = OrderSubmit {
    //         user_id: None,
    //         account_id,
    //         market_id,
    //         order_link: order_link_value,
    //         manual_order_indicator: true,
    //         orders,
    //     };

    //     // Send WS message
    //     let client_msg = create_client_message(ClientPayload::OrderSubmit(submit_msg));
    //     let mut buf = Vec::new();
    //     client_msg.encode(&mut buf)?;
    //     if let Some(write) = &self.write_handle {
    //         let mut w = write.lock().await;
    //         w.send(WsMessage::Binary(buf)).await?;
    //     }

    //     println!(
    //         "Order submitted: {} {} @ {} (Type: {})",
    //         if buy_sell_value == BuySell::BuySellBuy as i32 { "Buy" } else { "Sell" },
    //         volume,
    //         if price_type_value == PriceType::PriceTypeMarket as i32 {
    //             "Market".to_string()
    //         } else {
    //             price.to_string()
    //         },
    //         price_type
    //     );

    //     if let Some(tp) = take_profit_dollars {
    //         println!(
    //             "Take profit: ${} ({})",
    //             tp,
    //             if protection_side == BuySell::BuySellBuy as i32 { "Buy" } else { "Sell" }
    //         );
    //     }

    //     if let Some(sl) = stop_loss_dollars {
    //         println!(
    //             "Stop loss: ${} ({})",
    //             sl,
    //             if protection_side == BuySell::BuySellBuy as i32 { "Buy" } else { "Sell" }
    //         );
    //     }

    //     if has_brackets {
    //         println!("OCO (One Cancels Other) bracket order applied");
    //     }

    //     Ok(())
    // }
    }


// Helper to share client in GUI
pub type SharedClient = Arc<Mutex<Client>>;