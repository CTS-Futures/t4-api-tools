mod client;
mod clientMessageHelper;
use tokio::signal;
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
    let cfg = load_config();
    let client = Arc::new(Mutex::new(Client::new(cfg.websocket)));

    // Get read half from connect
    let read = Client::connect(client.clone()).await?;

        let client_clone = client.clone();
    tokio::spawn(async move {
        Client::listen(client_clone, read).await;
    });
   

    // Main thread continues
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    // Get Market ID of 12 hour delayed Futures: 10 year note(ZN)
    let market_id_opt = {
        let mut c = client.lock().await;
        c.get_market_id("DL_12h", "ZN").await?
    };

    let market_id = match market_id_opt {
        Some(id) => id,
        None => {
            println!("No market ID found for DL_12h / ZN");
            return Ok(());
        }
    };
    println!("Got Market ID: {:?}", market_id);

    // Get account ID -> parse it out of the login response and store in variable
    let account_id = {
        let c = client.lock().await;
        c.get_first_account_id().unwrap()
    };
    println!("account_id: {:?}", account_id);

    
    {
        let mut c = client.lock().await;
        c.subscribe_account(&account_id).await?; //subscribes to account
    }

    {
        let mut c = client.lock().await;
        c.subscribe_market("DL_12h", "ZN", &market_id).await?; //subscribes to a market (12 hour 10 year note futures)
    }

    {
        let mut c = client.lock().await;
        c.load_exchanges().await?; //loads all available exchanges
    }

    {
        let mut c = client.lock().await;
        c.load_contracts_for_exchange("CME_CL").await?; //loads all the contracts for the NYMEX CRUDE OIL FUTURES
    }
    
   {
        let mut c = client.lock().await;
        c.search_contracts("ZC").await?; //search result api test - (corn/ZC)
   }

    {
        let mut c = client.lock().await;
        c.load_groups("DL_12h", "ZN").await?; //search result api test - (corn/ZC)
   }

    //spawn the listener
    println!("Listening for messages. Press Ctrl+C to exit.");
    signal::ctrl_c().await?;
    println!("Shutting down.");
    Ok(())
}



