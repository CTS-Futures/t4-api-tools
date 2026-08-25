//! T4 API demo (egui GUI): login, market data, charts, and order entry.
//!
//! The egui UI runs on the main thread; a background tokio runtime owns the
//! WebSocket + REST client. They share [`state::AppState`] behind a mutex and
//! communicate UI actions over an mpsc [`state::Command`] channel.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod config;
mod net;
mod proto;
mod state;

use state::{AppState, Command, ConnStatus, Shared};
use std::sync::{Arc, Mutex};

fn main() -> eframe::Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    let cfg_result = config::Config::load("config.json");

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1100.0, 720.0]),
        ..Default::default()
    };

    eframe::run_native(
        "T4 Rust Demo",
        options,
        Box::new(move |cc| {
            cc.egui_ctx.set_visuals(egui::Visuals::light());
            let ctx = cc.egui_ctx.clone();
            let state: Shared = Arc::new(Mutex::new(AppState::default()));
            let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel::<Command>();

            match cfg_result {
                Ok(cfg) => {
                    let net_state = state.clone();
                    std::thread::spawn(move || {
                        match tokio::runtime::Runtime::new() {
                            Ok(rt) => rt.block_on(net::run(cfg, net_state, cmd_rx, ctx)),
                            Err(e) => {
                                // Don't let the net thread die silently — surface it in the UI.
                                if let Ok(mut s) = net_state.lock() {
                                    s.connection = ConnStatus::Error;
                                    s.log(format!("failed to start network runtime: {e}"));
                                }
                            }
                        }
                    });
                }
                Err(e) => {
                    if let Ok(mut s) = state.lock() {
                        s.connection = ConnStatus::Error;
                        s.log(format!("failed to load config.json: {e}"));
                        s.log("copy config.sample.json to config.json and fill in credentials");
                    }
                }
            }

            Ok(Box::new(app::App::new(state, cmd_tx)))
        }),
    )
}
