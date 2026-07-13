//! Runtime configuration, loaded from `config.json` (same shape as the C++
//! demo's `config.sample.json`).

use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub websocket: WsConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WsConfig {
    /// WebSocket endpoint, e.g. `wss://wss-sim.t4login.com/v1`.
    pub url: String,
    /// REST base URL, e.g. `https://api-sim.t4login.com`.
    pub api: String,

    pub firm: String,
    pub username: String,
    pub password: String,
    pub app_name: String,
    pub app_license: String,

    /// Default market-data product (exchange + contract), e.g. `CME_Eq` / `ES`.
    pub md_exchange_id: String,
    pub md_contract_id: String,

    /// Display price format (0=Decimal, 1=Real, 2=Clearing). Currently advisory.
    #[serde(default, rename = "priceFormat")]
    pub price_format: i32,
}

impl Config {
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Config> {
        let text = std::fs::read_to_string(path.as_ref())?;
        let cfg: Config = serde_json::from_str(&text)?;
        Ok(cfg)
    }
}
