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
struct GuiWrapper {
    gui_state: Arc<Mutex<T4WebTraderDemo>>,
}

impl eframe::App for GuiWrapper {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        let mut gui = self.gui_state.lock().unwrap();
        gui.update(ctx, frame);
    }
}
#[tokio::main]
async fn main() -> eframe::Result<()> {
    let cfg = load_config();
    let ws_client = Arc::new(Mutex::new(Client::new(cfg.websocket)));
 // Create GUI state
    // Create GUI state
    let gui_state = Arc::new(Mutex::new(T4WebTraderDemo::new(ws_client.clone())));

    // Register account update callback
    {
       let gui_clone = gui_state.clone();
        let mut client = ws_client.lock().await;
        client.on_account_update = Some(Box::new(move |accounts| {
            if let Ok(mut gui) = gui_clone.try_lock() {
                gui.set_accounts(accounts.iter().map(|a| a.account_name.clone()).collect());
                if let Some(ctx) = &gui.ctx {
                    ctx.request_repaint();
                }
            }
        }));
    }

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1200.0, 800.0]),
        ..Default::default()
    };
eframe::run_native(
    "T4 WebTrader Demo",
    options,
    Box::new({
        let gui_state = gui_state.clone();
        move |_cc| Ok(Box::new(GuiWrapper { gui_state }))
    }),
)
}