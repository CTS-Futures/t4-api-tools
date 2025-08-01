mod gui;
mod client;
mod clientMessageHelper;
use std::sync::Arc;
use tokio::sync::Mutex;

use gui::T4WebTraderDemo;

use client::{Client, Config};
use std::fs;
use std::path::Path;
fn load_config() -> Config {
    let config_path = Path::new("config/config.toml");
    let config_str = fs::read_to_string(config_path)
        .expect("Failed to read config.toml");
    toml::from_str::<Config>(&config_str)
        .expect("Failed to parse config.toml")
}

#[tokio::main]
async fn main() -> eframe::Result<()> {
    let cfg = load_config();
    let ws_client = Arc::new(Mutex::new(Client::new(cfg.websocket)));

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1200.0, 800.0]),
        ..Default::default()
    };


eframe::run_native(
    "T4 WebTrader Demo",
    options,
    Box::new({
        let ws_client = ws_client.clone(); // move into closure
        move |_cc| Ok(Box::new(T4WebTraderDemo::new(ws_client.clone())))
    }),
)
}
