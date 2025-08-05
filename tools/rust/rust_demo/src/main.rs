mod client;
mod clientMessageHelper;

use client::Client;
use client::Config;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::fs;
use std::path::Path;
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;

fn load_config() -> Config {
    let config_path = Path::new("config/config.toml");
    let config_str = fs::read_to_string(config_path)
        .expect("Failed to read config.toml");
    toml::from_str::<Config>(&config_str)
        .expect("Failed to parse config.toml")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load configuration
    let cfg = load_config();
    let client = Arc::new(Mutex::new(Client::new(cfg.clone())));

    // Connect WebSocket
    println!("Connecting to WebSocket...");
    let (ws_stream, _) = connect_async(&cfg.websocket).await?;
    println!("Connected!");

    let (write, mut read) = ws_stream.split();
    {
        let mut c = client.lock().await;
        c.set_write_handle(write); // You'll need to add a setter for write_handle in Client
    }

    // Spawn a task to read incoming messages
    let client_clone = client.clone();
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(WsMessage::Binary(bin)) => {
                    let server_msg = t4proto::v1::service::ServerMessage::decode(&*bin)
                        .expect("Failed to decode server message");
                    let mut c = client_clone.lock().await;
                    c.process_server_message(server_msg).await;
                }
                Ok(other) => {
                    println!("Other WS message: {:?}", other);
                }
                Err(e) => {
                    println!("WebSocket error: {:?}", e);
                    break;
                }
            }
        }
    });

    // Authenticate
    {
        let c = client.clone();
        let write = {
            let c = c.lock().await;
            c.write_handle.clone().unwrap()
        };
        client.lock().await.authenticate(write).await;
        client.lock().await.start_heartbeat(write);
    }

    // Example API call after authentication
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    {
        let mut c = client.lock().await;
        let market_id = c.get_market_id("EXAMPLE_EXCHANGE", "EXAMPLE_CONTRACT").await?;
        println!("Got Market ID: {:?}", market_id);
    }

    Ok(())
}

// mod gui;
// mod client;
// mod clientMessageHelper;
// use std::sync::Arc;
// use tokio::sync::Mutex;

// use gui::T4WebTraderDemo;

// use client::{Client, Config};
// use std::fs;
// use std::path::Path;
// fn load_config() -> Config {
//     let config_path = Path::new("config/config.toml");
//     let config_str = fs::read_to_string(config_path)
//         .expect("Failed to read config.toml");
//     toml::from_str::<Config>(&config_str)
//         .expect("Failed to parse config.toml")
// }
// struct GuiWrapper {
//     gui_state: Arc<Mutex<T4WebTraderDemo>>,
// }

// impl eframe::App for GuiWrapper {
//     fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
//         let mut gui = self.gui_state.lock().unwrap();
//         gui.update(ctx, frame);
//     }
// }
// #[tokio::main]
// async fn main() -> eframe::Result<()> {
//     let cfg = load_config();
//     let ws_client = Arc::new(Mutex::new(Client::new(cfg.websocket)));
//  // Create GUI state
//     // Create GUI state
//     let gui_state = Arc::new(Mutex::new(T4WebTraderDemo::new(ws_client.clone())));

//     // Register account update callback
//     {
//        let gui_clone = gui_state.clone();
//         let mut client = ws_client.lock().await;
//         client.on_account_update = Some(Box::new(move |accounts| {
//             if let Ok(mut gui) = gui_clone.try_lock() {
//                 gui.set_accounts(accounts.iter().map(|a| a.account_name.clone()).collect());
//                 if let Some(ctx) = &gui.ctx {
//                     ctx.request_repaint();
//                 }
//             }
//         }));
//     }

//     let options = eframe::NativeOptions {
//         viewport: egui::ViewportBuilder::default().with_inner_size([1200.0, 800.0]),
//         ..Default::default()
//     };
// eframe::run_native(
//     "T4 WebTrader Demo",
//     options,
//     Box::new({
//         let gui_state = gui_state.clone();
//         move |_cc| Ok(Box::new(GuiWrapper { gui_state }))
//     }),
// )
// }