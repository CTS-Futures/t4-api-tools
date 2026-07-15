//! Async network layer: one WebSocket session (login, heartbeat, token refresh,
//! subscriptions, order routing) plus REST chart loads.
//!
//! Runs on a background tokio runtime. Inbound `ServerMessage`s mutate the shared
//! [`AppState`]; UI actions arrive as [`Command`]s. All outbound frames go through
//! a single mpsc channel to a dedicated writer task so the socket sink is never
//! shared across `select!` arms or spawned tasks.

mod rest;

use crate::config::Config;
use crate::proto::service::{client_message, server_message};
use crate::proto::{account, auth, common, encode_client, market, orderrouting, service};
use crate::state::{
    AccountInfo, AppState, Command, ConnStatus, OrderKind, OrderRequest, Quote, Shared,
    TimeInForce,
};

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message as WsMessage;

type Out = UnboundedSender<Vec<u8>>;

/// Lock the shared state, apply `f`, then ask egui to repaint.
fn with_state(state: &Shared, ctx: &egui::Context, f: impl FnOnce(&mut AppState)) {
    if let Ok(mut s) = state.lock() {
        f(&mut s);
    }
    ctx.request_repaint();
}

/// Reconnecting session loop. Runs forever; the process exits when the window
/// closes and the runtime thread is torn down.
pub async fn run(
    cfg: Config,
    state: Shared,
    mut cmd_rx: UnboundedReceiver<Command>,
    ctx: egui::Context,
) {
    loop {
        with_state(&state, &ctx, |s| {
            s.connection = ConnStatus::Connecting;
            s.log("connecting to WebSocket…");
        });

        match run_session(&cfg, &state, &mut cmd_rx, &ctx).await {
            Ok(()) => with_state(&state, &ctx, |s| {
                s.connection = ConnStatus::Error;
                s.log("connection closed");
            }),
            Err(e) => with_state(&state, &ctx, |s| {
                s.connection = ConnStatus::Error;
                s.log(format!("session ended: {e:#}"));
            }),
        }

        tokio::time::sleep(Duration::from_secs(3)).await;
        with_state(&state, &ctx, |s| s.log("reconnecting…"));
    }
}

async fn run_session(
    cfg: &Config,
    state: &Shared,
    cmd_rx: &mut UnboundedReceiver<Command>,
    ctx: &egui::Context,
) -> Result<()> {
    let (ws_stream, _resp) = tokio_tungstenite::connect_async(&cfg.websocket.url)
        .await
        .context("WebSocket connect failed")?;

    with_state(state, ctx, |s| {
        s.connection = ConnStatus::Connected;
        s.log("WebSocket connected");
    });

    let (mut write, mut read) = ws_stream.split();

    // Outgoing frame channel -> dedicated writer task.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if write.send(WsMessage::Binary(bytes)).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    let http = reqwest::Client::new();

    send_login(cfg, &out_tx)?;
    with_state(state, ctx, |s| s.log("login request sent"));

    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    heartbeat.tick().await; // discard the immediate first tick

    let mut market_subscribed = false;

    let res: Result<()> = loop {
        tokio::select! {
            incoming = read.next() => match incoming {
                Some(Ok(WsMessage::Binary(bytes))) => {
                    handle_server_bytes(&bytes, cfg, state, ctx, &out_tx, &http, &mut market_subscribed);
                }
                Some(Ok(WsMessage::Close(_))) => break Ok(()),
                Some(Ok(_)) => {}
                Some(Err(e)) => break Err(anyhow!("websocket read error: {e}")),
                None => break Ok(()),
            },
            cmd = cmd_rx.recv() => {
                if let Some(cmd) = cmd {
                    handle_command(cmd, cfg, state, ctx, &out_tx, &http);
                }
            }
            _ = heartbeat.tick() => {
                let hb = service::Heartbeat { timestamp: chrono::Utc::now().timestamp_millis() };
                let _ = out_tx.send(encode_client(client_message::Payload::Heartbeat(hb)));
                maybe_refresh_token(state, &out_tx);
                with_state(state, ctx, |s| {
                    let fmt = if s.chart_format.is_empty() {
                        "not loaded".to_string()
                    } else {
                        s.chart_format.clone()
                    };
                    s.log(format!("heartbeat — chart format: {fmt}"));
                });
            }
        }
    };

    writer.abort();
    res
}

// ---------------------------------------------------------------------------
// Outbound builders
// ---------------------------------------------------------------------------

fn send_login(cfg: &Config, out: &Out) -> Result<()> {
    let ws = &cfg.websocket;
    let req = auth::LoginRequest {
        api_key: String::new(),
        firm: ws.firm.clone(),
        username: ws.username.clone(),
        password: ws.password.clone(),
        app_name: ws.app_name.clone(),
        app_license: ws.app_license.clone(),
        price_format: ws.price_format,
    };
    out.send(encode_client(client_message::Payload::LoginRequest(req)))
        .map_err(|_| anyhow!("failed to queue login (writer gone)"))?;
    Ok(())
}

fn send_account_subscribe(account_id: &str, out: &Out) {
    let sub = account::AccountSubscribe {
        subscribe: common::AccountSubscribeType::AllUpdates as i32,
        subscribe_all_accounts: false,
        account_id: vec![account_id.to_string()],
        upl_mode: Some(common::UplMode::Average as i32),
    };
    let _ = out.send(encode_client(client_message::Payload::AccountSubscribe(sub)));
}

fn send_market_depth_subscribe(exchange_id: &str, contract_id: &str, market_id: &str, out: &Out) {
    let sub = market::MarketDepthSubscribe {
        exchange_id: exchange_id.to_string(),
        contract_id: contract_id.to_string(),
        market_id: market_id.to_string(),
        buffer: common::DepthBuffer::Smart as i32,
        depth_levels: common::DepthLevels::BestOnly as i32,
    };
    let _ = out.send(encode_client(client_message::Payload::MarketDepthSubscribe(sub)));
}

/// Tell the server to stop streaming depth for a market (used before switching).
fn send_market_depth_unsubscribe(exchange_id: &str, contract_id: &str, market_id: &str, out: &Out) {
    let sub = market::MarketDepthSubscribe {
        exchange_id: exchange_id.to_string(),
        contract_id: contract_id.to_string(),
        market_id: market_id.to_string(),
        buffer: common::DepthBuffer::NoSubscription as i32,
        depth_levels: common::DepthLevels::Undefined as i32,
    };
    let _ = out.send(encode_client(client_message::Payload::MarketDepthSubscribe(sub)));
}

// ---------------------------------------------------------------------------
// Commands (UI -> network)
// ---------------------------------------------------------------------------

fn handle_command(
    cmd: Command,
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
) {
    match cmd {
        Command::SubscribeAccount(account_id) => {
            send_account_subscribe(&account_id, out);
            with_state(state, ctx, |s| {
                s.selected_account = Some(account_id.clone());
                // Clear the previous account's funds until fresh updates arrive.
                s.balance = 0.0;
                s.margin = 0.0;
                s.available_cash = 0.0;
                s.log(format!("subscribing to account {account_id}"));
            });
        }
        Command::SubmitOrder(req) => submit_order(req, cfg, state, ctx, out),
        Command::ReviseOrder {
            account_id,
            market_id,
            unique_id,
            volume,
            limit_price,
        } => {
            let revise = orderrouting::order_revise::Revise {
                unique_id: unique_id.clone(),
                volume: Some(volume),
                max_show: None,
                max_volume: None,
                limit_price: limit_price.map(|v| common::Price { value: v }),
                stop_price: None,
                trail_price: None,
                tag: None,
                activation_data: None,
            };
            let msg = orderrouting::OrderRevise {
                user_id: String::new(),
                account_id,
                market_id,
                manual_order_indicator: true,
                revisions: vec![revise],
            };
            let _ = out.send(encode_client(client_message::Payload::OrderRevise(msg)));
            with_state(state, ctx, |s| s.log(format!("revise sent for {unique_id}")));
        }
        Command::CancelOrder {
            account_id,
            market_id,
            unique_id,
        } => {
            let pull = orderrouting::order_pull::Pull {
                unique_id: unique_id.clone(),
                tag: None,
            };
            let msg = orderrouting::OrderPull {
                user_id: String::new(),
                account_id,
                market_id,
                manual_order_indicator: true,
                pulls: vec![pull],
            };
            let _ = out.send(encode_client(client_message::Payload::OrderPull(msg)));
            with_state(state, ctx, |s| s.log(format!("cancel sent for {unique_id}")));
        }
        Command::LoadChart {
            bar_interval,
            bar_period,
        } => spawn_chart_load(cfg, state, ctx, http, bar_interval, bar_period),
        Command::SearchContracts(term) => spawn_search(state, ctx, http, cfg, term),
        Command::SelectMarket {
            exchange_id,
            contract_id,
        } => spawn_select_market(cfg, state, ctx, out, http, exchange_id, contract_id),
        Command::SelectMarketById {
            exchange_id,
            contract_id,
            market_id,
        } => spawn_select_market_by_id(cfg, state, ctx, out, http, exchange_id, contract_id, market_id),
        Command::LoadExchanges => spawn_load_exchanges(cfg, state, ctx, http),
        Command::LoadContractsForExchange(ex) => spawn_load_contracts(cfg, state, ctx, http, ex),
        Command::LoadExpiryGroups => spawn_load_expiry_groups(cfg, state, ctx, http),
        Command::LoadExpiryMarkets {
            strategy_type,
            expiry_date,
        } => spawn_load_expiry_markets(cfg, state, ctx, http, strategy_type, expiry_date),
        Command::LoadOlderChart => spawn_load_older(cfg, state, ctx, http),
        Command::FlattenPosition {
            account_id,
            market_id,
        } => flatten_or_reverse(&account_id, &market_id, false, state, ctx, out),
        Command::ReversePosition {
            account_id,
            market_id,
        } => flatten_or_reverse(&account_id, &market_id, true, state, ctx, out),
        Command::CancelAllOrders {
            account_id,
            market_id,
        } => cancel_all(&account_id, market_id.as_deref(), state, ctx, out),
    }
}

/// Submit a market order that closes (or, when `reverse`, flips) the net
/// position on `market_id`. No-op when already flat.
fn flatten_or_reverse(
    account_id: &str,
    market_id: &str,
    reverse: bool,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
) {
    let net = state
        .lock()
        .ok()
        .and_then(|s| s.positions.get(market_id).map(|p| p.net))
        .unwrap_or(0);
    let verb = if reverse { "reverse" } else { "flatten" };
    if net == 0 {
        with_state(state, ctx, |s| {
            s.log(format!("no position to {verb} on {market_id}"))
        });
        return;
    }
    // Long (net > 0) closes by selling; short closes by buying.
    let buy = net < 0;
    let volume = net.abs() * if reverse { 2 } else { 1 };
    let order = orderrouting::order_submit::Order {
        buy_sell: if buy {
            common::BuySell::Buy
        } else {
            common::BuySell::Sell
        } as i32,
        price_type: common::PriceType::Market as i32,
        time_type: common::TimeType::Normal as i32,
        volume,
        max_show: None,
        max_volume: None,
        limit_price: None,
        stop_price: None,
        trail_distance: None,
        tag: None,
        activation_type: None,
        activation_data: None,
    };
    let submit = orderrouting::OrderSubmit {
        user_id: None,
        account_id: account_id.to_string(),
        market_id: market_id.to_string(),
        order_link: common::OrderLink::None as i32,
        manual_order_indicator: true,
        orders: vec![order],
    };
    let _ = out.send(encode_client(client_message::Payload::OrderSubmit(submit)));
    with_state(state, ctx, |s| {
        s.log(format!(
            "{verb}: {} {volume} on {market_id}",
            if buy { "BUY" } else { "SELL" }
        ))
    });
}

/// Pull every Working/Held order for `account_id`, optionally limited to one
/// market. Orders are grouped into one `OrderPull` per market.
fn cancel_all(
    account_id: &str,
    market: Option<&str>,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
) {
    let groups: std::collections::BTreeMap<String, Vec<String>> = {
        let Some(s) = state.lock().ok() else { return };
        let mut g: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        for o in s.orders.values() {
            if o.account_id != account_id {
                continue;
            }
            if market.is_some_and(|m| o.market_id != m) {
                continue;
            }
            if o.status != "Working" && o.status != "Held" {
                continue;
            }
            g.entry(o.market_id.clone()).or_default().push(o.unique_id.clone());
        }
        g
    };
    if groups.is_empty() {
        with_state(state, ctx, |s| s.log("cancel-all: no working orders"));
        return;
    }
    let mut count = 0;
    for (mkt, ids) in groups {
        let pulls: Vec<_> = ids
            .iter()
            .map(|id| orderrouting::order_pull::Pull {
                unique_id: id.clone(),
                tag: None,
            })
            .collect();
        count += pulls.len();
        let msg = orderrouting::OrderPull {
            user_id: String::new(),
            account_id: account_id.to_string(),
            market_id: mkt,
            manual_order_indicator: true,
            pulls,
        };
        let _ = out.send(encode_client(client_message::Payload::OrderPull(msg)));
    }
    with_state(state, ctx, |s| {
        s.log(format!("cancel-all: pulled {count} order(s)"))
    });
}

fn submit_order(req: OrderRequest, cfg: &Config, state: &Shared, ctx: &egui::Context, out: &Out) {
    let (market_id, point_value, decimals, real_decimals) = match state.lock().ok() {
        Some(s) => (
            s.market_id.clone(),
            s.market_point_value.clone(),
            s.market_decimals,
            s.market_real_decimals,
        ),
        None => (None, None, 0, 0),
    };
    let Some(market_id) = market_id else {
        with_state(state, ctx, |s| s.log("cannot submit: no active market"));
        return;
    };

    let side = if req.buy {
        common::BuySell::Buy
    } else {
        common::BuySell::Sell
    };
    let price_type = match req.kind {
        OrderKind::Market => common::PriceType::Market,
        OrderKind::Limit => common::PriceType::Limit,
        OrderKind::Stop => common::PriceType::StopMarket,
        OrderKind::StopLimit => common::PriceType::StopLimit,
    };
    let limit_price = if req.kind.has_limit() && !req.limit_price.trim().is_empty() {
        Some(common::Price {
            value: req.limit_price.trim().to_string(),
        })
    } else {
        None
    };
    let stop_price = if req.kind.has_stop() && !req.stop_price.trim().is_empty() {
        Some(common::Price {
            value: req.stop_price.trim().to_string(),
        })
    } else {
        None
    };
    let time_type = match req.tif {
        TimeInForce::Day => common::TimeType::Normal,
        TimeInForce::Gtc => common::TimeType::GoodTillCancelled,
        TimeInForce::Ioc => common::TimeType::ImmediateAndCancel,
        TimeInForce::Fok => common::TimeType::CompleteVolume,
    };
    // A trailing distance only makes sense on stop orders.
    let trail_distance = req
        .trail
        .filter(|_| req.kind.has_stop())
        .map(|v| common::Price { value: fmt_offset(v) });

    let entry = orderrouting::order_submit::Order {
        buy_sell: side as i32,
        price_type: price_type as i32,
        time_type: time_type as i32,
        volume: req.volume,
        max_show: None,
        max_volume: None,
        limit_price,
        stop_price,
        trail_distance,
        tag: None,
        activation_type: None,
        activation_data: None,
    };

    let mut orders = vec![entry];

    // Bracket legs: convert the $ P&L into a signed price offset the server
    // applies at fill under AUTO_OCO. Mirrors the JS demo's "Dollars mode":
    //   offset = (|$| / volume) / point_value / 10^price_decimals
    //   TP (Limit):      buy → +offset, sell → −offset
    //   SL (StopMarket): buy → −offset, sell → +offset
    if req.take_profit.is_some() || req.stop_loss.is_some() {
        let price_decimals = if cfg.websocket.price_format == 0 {
            decimals
        } else {
            real_decimals
        };
        let pv = point_value.as_deref().and_then(|v| v.parse::<f64>().ok());
        match pv {
            Some(pv) if pv > 0.0 && req.volume > 0 => {
                let protection = if req.buy {
                    common::BuySell::Sell
                } else {
                    common::BuySell::Buy
                };
                let scale = 10f64.powi(price_decimals);
                let offset = |dollars: f64| (dollars.abs() / req.volume as f64) / pv / scale;

                if let Some(tp) = req.take_profit {
                    let signed = if req.buy { offset(tp) } else { -offset(tp) };
                    orders.push(protection_leg(
                        protection,
                        common::PriceType::Limit,
                        Some(signed),
                        None,
                    ));
                }
                if let Some(sl) = req.stop_loss {
                    let signed = if req.buy { -offset(sl) } else { offset(sl) };
                    orders.push(protection_leg(
                        protection,
                        common::PriceType::StopMarket,
                        None,
                        Some(signed),
                    ));
                }
            }
            _ => with_state(state, ctx, |s| {
                s.log("brackets skipped: market point value not available yet")
            }),
        }
    }

    // OCO-link only when protection legs were actually added.
    let order_link = if orders.len() > 1 {
        common::OrderLink::AutoOco
    } else {
        common::OrderLink::None
    } as i32;

    let submit = orderrouting::OrderSubmit {
        user_id: None,
        account_id: req.account_id.clone(),
        market_id: market_id.clone(),
        order_link,
        manual_order_indicator: true,
        orders,
    };
    let _ = out.send(encode_client(client_message::Payload::OrderSubmit(submit)));
    with_state(state, ctx, |s| {
        let mut msg = format!(
            "order sent: {} {} {} {} on {market_id}",
            if req.buy { "BUY" } else { "SELL" },
            req.volume,
            match req.kind {
                OrderKind::Market => "MKT".to_string(),
                OrderKind::Limit => format!("LMT @ {}", req.limit_price),
                OrderKind::Stop => format!("STP @ {}", req.stop_price),
                OrderKind::StopLimit =>
                    format!("STPLMT {} @ {}", req.stop_price, req.limit_price),
            },
            req.tif.label(),
        );
        if let Some(tp) = req.take_profit {
            msg.push_str(&format!(" TP ${tp}"));
        }
        if let Some(sl) = req.stop_loss {
            msg.push_str(&format!(" SL ${sl}"));
        }
        if order_link == common::OrderLink::AutoOco as i32 {
            msg.push_str(" [AUTO_OCO]");
        }
        s.log(msg);
    });
}

/// Build a bracket protection leg (volume 0, GTC, held) carrying a signed price
/// offset in either the limit (take-profit) or stop (stop-loss) field.
fn protection_leg(
    side: common::BuySell,
    price_type: common::PriceType,
    limit_offset: Option<f64>,
    stop_offset: Option<f64>,
) -> orderrouting::order_submit::Order {
    orderrouting::order_submit::Order {
        buy_sell: side as i32,
        price_type: price_type as i32,
        time_type: common::TimeType::GoodTillCancelled as i32,
        volume: 0,
        max_show: None,
        max_volume: None,
        limit_price: limit_offset.map(|v| common::Price { value: fmt_offset(v) }),
        stop_price: stop_offset.map(|v| common::Price { value: fmt_offset(v) }),
        trail_distance: None,
        tag: None,
        activation_type: Some(common::ActivationType::Hold as i32),
        activation_data: None,
    }
}

/// Format a price offset as a plain decimal string (no scientific notation,
/// trailing zeros trimmed), preserving sign.
fn fmt_offset(v: f64) -> String {
    let s = format!("{v:.10}");
    let trimmed = s.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The active market-data product (exchange, contract), preferring the
/// user-selected market in state and falling back to the config default.
fn active_product(cfg: &Config, s: &AppState) -> (String, String) {
    (
        s.exchange_id.clone().unwrap_or_else(|| cfg.websocket.md_exchange_id.clone()),
        s.contract_id.clone().unwrap_or_else(|| cfg.websocket.md_contract_id.clone()),
    )
}

fn spawn_chart_load(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    http: &reqwest::Client,
    bar_interval: String,
    bar_period: i32,
) {
    let (token, exchange, contract, market_id) = {
        match state.lock().ok() {
            Some(s) => {
                let (e, c) = active_product(cfg, &s);
                (s.auth_token.clone(), e, c, s.market_id.clone())
            }
            None => (None, String::new(), String::new(), None),
        }
    };
    let (Some(token), Some(market_id)) = (token, market_id) else {
        with_state(state, ctx, |s| {
            s.log("cannot load chart: waiting for login/market")
        });
        return;
    };

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        load_chart(&http, &api, &token, &exchange, &contract, &market_id, &bar_interval,
            bar_period, &state, &ctx)
        .await;
    });
}

/// Fetch a fresh chart for `market_id` and swap it into state, resetting the
/// paging window and re-locking the view. Shared by the interval buttons, the
/// initial auto-load, and market switches.
#[allow(clippy::too_many_arguments)]
async fn load_chart(
    http: &reqwest::Client,
    api: &str,
    token: &str,
    exchange: &str,
    contract: &str,
    market_id: &str,
    bar_interval: &str,
    bar_period: i32,
    state: &Shared,
    ctx: &egui::Context,
) {
    let interval_secs = rest::interval_to_secs(bar_interval, bar_period);
    with_state(state, ctx, |s| {
        s.chart_loading = true;
        s.chart_interval = bar_interval.to_string();
        s.chart_interval_secs = interval_secs;
        s.chart_period = bar_period;
        s.chart_loading_older = false;
        s.chart_no_more = false;
        s.log(format!("loading chart ({bar_interval}/{bar_period})…"));
    });

    let result = rest::fetch_chart(
        http, api, token, exchange, contract, market_id, bar_interval, bar_period,
    )
    .await;

    with_state(state, ctx, |s| {
        s.chart_loading = false;
        match result {
            Ok((candles, window_start, format)) => {
                s.log(format!("chart loaded: {} bars ({format})", candles.len()));
                s.chart_format = format;
                s.candles = candles;
                s.chart_x_base = 0;
                s.chart_window_start = Some(window_start);
                // Fresh dataset: bump generation so the UI re-locks to latest.
                s.chart_generation = s.chart_generation.wrapping_add(1);
            }
            Err(e) => s.log(format!("chart load failed: {e:#}")),
        }
    });
}

/// Run a contract search and store the results for the picker dropdown.
fn spawn_search(
    state: &Shared,
    ctx: &egui::Context,
    http: &reqwest::Client,
    cfg: &Config,
    term: String,
) {
    let token = state.lock().ok().and_then(|s| s.auth_token.clone());
    let Some(token) = token else { return };

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        match rest::search_contracts(&http, &api, &token, &term).await {
            Ok(hits) => with_state(&state, &ctx, |s| s.contract_results = hits),
            Err(e) => with_state(&state, &ctx, |s| s.log(format!("search failed: {e:#}"))),
        }
    });
}

/// Fields read from state to perform a market switch:
/// (token, old_exchange, old_contract, old_market, interval, period).
type SwitchCtx = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    i32,
);

fn read_switch_ctx(state: &Shared) -> SwitchCtx {
    match state.lock().ok() {
        Some(s) => {
            let interval = if s.chart_interval.is_empty() {
                "Minute".to_string()
            } else {
                s.chart_interval.clone()
            };
            let period = if s.chart_period == 0 { 1 } else { s.chart_period };
            (
                s.auth_token.clone(),
                s.exchange_id.clone(),
                s.contract_id.clone(),
                s.market_id.clone(),
                interval,
                period,
            )
        }
        None => (None, None, None, None, "Minute".to_string(), 1),
    }
}

/// Unsubscribe the old market, subscribe the new one, clear stale chart/quote
/// state, and reload the chart. Shared by both picker paths.
#[allow(clippy::too_many_arguments)]
async fn switch_market(
    http: reqwest::Client,
    api: String,
    token: String,
    exchange_id: String,
    contract_id: String,
    market_id: String,
    interval: String,
    period: i32,
    old: (Option<String>, Option<String>, Option<String>),
    out: Out,
    state: Shared,
    ctx: egui::Context,
) {
    if let (Some(oe), Some(oc), Some(om)) = old {
        send_market_depth_unsubscribe(&oe, &oc, &om, &out);
    }
    send_market_depth_subscribe(&exchange_id, &contract_id, &market_id, &out);

    with_state(&state, &ctx, |s| {
        s.exchange_id = Some(exchange_id.clone());
        s.contract_id = Some(contract_id.clone());
        s.market_id = Some(market_id.clone());
        s.quote = Quote::default();
        s.candles.clear();
        s.chart_x_base = 0;
        s.chart_no_more = false;
        s.chart_loading_older = false;
        s.chart_window_start = None;
        s.contract_results.clear();
        s.log(format!("switched to {exchange_id}/{contract_id} → {market_id}"));
    });

    load_chart(&http, &api, &token, &exchange_id, &contract_id, &market_id, &interval, period,
        &state, &ctx)
    .await;
}

/// Switch the active market by resolving the picked contract via `firstmarket`.
fn spawn_select_market(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
    exchange_id: String,
    contract_id: String,
) {
    let (token, old_e, old_c, old_m, interval, period) = read_switch_ctx(state);
    let Some(token) = token else {
        with_state(state, ctx, |s| s.log("cannot switch market: not logged in"));
        return;
    };

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let out = out.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        let market_id = match rest::first_market(&http, &api, &token, &exchange_id, &contract_id).await {
            Ok(m) => m,
            Err(e) => {
                with_state(&state, &ctx, |s| s.log(format!("market resolve failed: {e:#}")));
                return;
            }
        };
        switch_market(http, api, token, exchange_id, contract_id, market_id, interval, period,
            (old_e, old_c, old_m), out, state, ctx)
        .await;
    });
}

/// Switch to an already-resolved market id (from the expiry picker).
#[allow(clippy::too_many_arguments)]
fn spawn_select_market_by_id(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
    exchange_id: String,
    contract_id: String,
    market_id: String,
) {
    let (token, old_e, old_c, old_m, interval, period) = read_switch_ctx(state);
    let Some(token) = token else {
        with_state(state, ctx, |s| s.log("cannot switch market: not logged in"));
        return;
    };

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let out = out.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        switch_market(http, api, token, exchange_id, contract_id, market_id, interval, period,
            (old_e, old_c, old_m), out, state, ctx)
        .await;
    });
}

/// Load the exchange list for the contract picker (skips if already cached).
fn spawn_load_exchanges(cfg: &Config, state: &Shared, ctx: &egui::Context, http: &reqwest::Client) {
    let token = state.lock().ok().and_then(|s| s.auth_token.clone());
    let Some(token) = token else { return };
    if state.lock().map(|s| !s.exchanges.is_empty()).unwrap_or(false) {
        return;
    }

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        match rest::load_exchanges(&http, &api, &token).await {
            Ok(list) => with_state(&state, &ctx, |s| s.exchanges = list),
            Err(e) => with_state(&state, &ctx, |s| s.log(format!("exchanges load failed: {e:#}"))),
        }
    });
}

/// Load the contracts under one exchange (skips if already cached).
fn spawn_load_contracts(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    http: &reqwest::Client,
    exchange_id: String,
) {
    let token = state.lock().ok().and_then(|s| s.auth_token.clone());
    let Some(token) = token else { return };
    if state
        .lock()
        .map(|s| s.contracts_by_exchange.contains_key(&exchange_id))
        .unwrap_or(false)
    {
        return;
    }

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        match rest::load_contracts(&http, &api, &token, &exchange_id).await {
            Ok(list) => with_state(&state, &ctx, |s| {
                s.contracts_by_exchange.insert(exchange_id, list);
            }),
            Err(e) => with_state(&state, &ctx, |s| s.log(format!("contracts load failed: {e:#}"))),
        }
    });
}

/// Load expiry groups for the active exchange/contract, clearing any stale
/// per-group market cache from a previous contract.
fn spawn_load_expiry_groups(cfg: &Config, state: &Shared, ctx: &egui::Context, http: &reqwest::Client) {
    let (token, exchange, contract) = match state.lock().ok() {
        Some(s) => (s.auth_token.clone(), s.exchange_id.clone(), s.contract_id.clone()),
        None => (None, None, None),
    };
    let (Some(token), Some(exchange), Some(contract)) = (token, exchange, contract) else {
        return;
    };

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        match rest::load_expiry_groups(&http, &api, &token, &exchange, &contract).await {
            Ok(list) => with_state(&state, &ctx, |s| {
                s.expiry_groups = list;
                s.expiry_markets_by_group.clear();
            }),
            Err(e) => {
                with_state(&state, &ctx, |s| s.log(format!("expiry groups load failed: {e:#}")))
            }
        }
    });
}

/// Load the markets under one expiry group (skips if already cached).
fn spawn_load_expiry_markets(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    http: &reqwest::Client,
    strategy_type: String,
    expiry_date: String,
) {
    let (token, exchange, contract) = match state.lock().ok() {
        Some(s) => (s.auth_token.clone(), s.exchange_id.clone(), s.contract_id.clone()),
        None => (None, None, None),
    };
    let (Some(token), Some(exchange), Some(contract)) = (token, exchange, contract) else {
        return;
    };
    let key = format!("{strategy_type}|{expiry_date}");
    if state
        .lock()
        .map(|s| s.expiry_markets_by_group.contains_key(&key))
        .unwrap_or(false)
    {
        return;
    }

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        match rest::load_expiry_markets(&http, &api, &token, &exchange, &contract, &strategy_type,
            &expiry_date)
        .await
        {
            Ok(list) => with_state(&state, &ctx, |s| {
                s.expiry_markets_by_group.insert(key, list);
            }),
            Err(e) => {
                with_state(&state, &ctx, |s| s.log(format!("expiry markets load failed: {e:#}")))
            }
        }
    });
}

/// Page in a chunk of older bars and prepend them, keeping the view stable by
/// shifting the x-base left by the number of bars added.
fn spawn_load_older(cfg: &Config, state: &Shared, ctx: &egui::Context, http: &reqwest::Client) {
    let (token, exchange, contract, market_id, interval, period, window_start, oldest) = {
        match state.lock().ok() {
            Some(s) => {
                if s.chart_loading_older || s.chart_no_more || s.candles.is_empty() {
                    return;
                }
                let (e, c) = active_product(cfg, &s);
                (
                    s.auth_token.clone(),
                    e,
                    c,
                    s.market_id.clone(),
                    s.chart_interval.clone(),
                    if s.chart_period == 0 { 1 } else { s.chart_period },
                    s.chart_window_start,
                    s.candles.first().map(|c| c.time_ms).unwrap_or(i64::MAX),
                )
            }
            None => return,
        }
    };
    let (Some(token), Some(market_id), Some(window_start)) = (token, market_id, window_start) else {
        return;
    };

    with_state(state, ctx, |s| s.chart_loading_older = true);

    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let api = cfg.websocket.api.clone();

    tokio::spawn(async move {
        let result = rest::fetch_older(
            &http, &api, &token, &exchange, &contract, &market_id, &interval, period, window_start,
        )
        .await;

        with_state(&state, &ctx, |s| {
            s.chart_loading_older = false;
            match result {
                Ok(page) => {
                    s.chart_window_start = Some(page.window_start);
                    // Keep only bars strictly older than what we already hold.
                    let mut older: Vec<_> =
                        page.candles.into_iter().filter(|c| c.time_ms < oldest).collect();
                    if !older.is_empty() {
                        let added = older.len() as i64;
                        older.append(&mut s.candles);
                        s.candles = older;
                        s.chart_x_base -= added;
                        s.log(format!("loaded {added} older bars"));
                    }
                    if page.reached_floor {
                        s.chart_no_more = true;
                        s.log("reached start of history");
                    }
                }
                Err(e) => s.log(format!("older history load failed: {e:#}")),
            }
        });
    });
}

fn maybe_refresh_token(state: &Shared, out: &Out) {
    let need = state
        .lock()
        .map(|s| {
            s.auth_token.is_some()
                && s.token_expiry != 0
                && s.token_expiry <= chrono::Utc::now().timestamp() + 30
        })
        .unwrap_or(false);
    if need {
        let req = auth::AuthenticationTokenRequest {
            request_id: format!("t4demo-{}", chrono::Utc::now().timestamp_millis()),
        };
        let _ = out.send(encode_client(
            client_message::Payload::AuthenticationTokenRequest(req),
        ));
    }
}

// ---------------------------------------------------------------------------
// Inbound dispatch (network -> state)
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn handle_server_bytes(
    bytes: &[u8],
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
    market_subscribed: &mut bool,
) {
    let msg = match service::ServerMessage::decode(bytes) {
        Ok(m) => m,
        Err(e) => {
            with_state(state, ctx, |s| s.log(format!("decode error: {e}")));
            return;
        }
    };
    let Some(payload) = msg.payload else { return };

    use server_message::Payload as P;
    match payload {
        P::LoginResponse(r) => handle_login(r, cfg, state, ctx, out, http, market_subscribed),
        P::AuthenticationToken(t) => with_state(state, ctx, |s| {
            store_token(s, &t);
            s.log("auth token refreshed");
        }),
        P::MarketDetails(d) => with_state(state, ctx, |s| {
            s.market_decimals = d.decimals;
            s.market_real_decimals = d.real_decimals;
            s.market_point_value = d.point_value.as_ref().map(|p| p.value.clone());
        }),
        P::MarketDepth(d) => with_state(state, ctx, |s| apply_market_depth(s, &d)),
        P::MarketDepthTrade(t) => with_state(state, ctx, |s| {
            let lp = price_string(&t.last_trade_price);
            s.quote.last_price = lp.clone();
            s.quote.last_volume = t.last_trade_volume;
            apply_live_tick(s, &lp, t.last_trade_volume);
        }),
        P::MarketSnapshot(snap) => with_state(state, ctx, |s| {
            for m in &snap.messages {
                if let Some(market::market_snapshot_message::Payload::MarketDepth(d)) = &m.payload {
                    apply_market_depth(s, d);
                }
            }
        }),
        P::AccountSubscribeResponse(r) => with_state(state, ctx, |s| {
            s.log(format!("account subscribe: success={}", r.success));
        }),
        P::AccountSnapshot(snap) => with_state(state, ctx, |s| {
            for m in &snap.messages {
                match &m.payload {
                    Some(account::account_snapshot_message::Payload::AccountPosition(p)) => {
                        apply_position(s, p)
                    }
                    Some(account::account_snapshot_message::Payload::OrderUpdateMulti(m)) => {
                        apply_order_multi(s, m)
                    }
                    _ => {}
                }
            }
        }),
        P::AccountUpdate(u) => with_state(state, ctx, |s| {
            s.balance = u.balance;
            s.margin = u.margin;
        }),
        P::AccountProfit(p) => with_state(state, ctx, |s| {
            if let Some(cash) = p.available_cash {
                s.available_cash = cash;
            }
        }),
        P::AccountPosition(p) => with_state(state, ctx, |s| apply_position(s, &p)),
        P::AccountPositionProfit(p) => with_state(state, ctx, |s| {
            if let Some(row) = s.positions.get_mut(&p.market_id) {
                if let Some(upl) = p.upl {
                    row.upl = upl;
                }
                if let Some(rpl) = p.rpl {
                    row.rpl = rpl;
                }
            }
        }),
        P::OrderUpdate(o) => with_state(state, ctx, |s| apply_order_update(s, &o)),
        P::OrderUpdateMulti(m) => with_state(state, ctx, |s| apply_order_multi(s, &m)),
        P::OrderUpdateStatus(st) => with_state(state, ctx, |s| apply_order_status(s, &st)),
        P::OrderUpdateTrade(t) => with_state(state, ctx, |s| apply_order_trade(s, &t)),
        P::OrderUpdateFailed(f) => with_state(state, ctx, |s| {
            let row = s.orders.entry(f.unique_id.clone()).or_default();
            row.unique_id = f.unique_id.clone();
            row.status = "Rejected".to_string();
            row.status_detail = f.status_detail.clone();
            s.log(format!("order failed: {}", f.status_detail));
        }),
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_login(
    r: auth::LoginResponse,
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
    market_subscribed: &mut bool,
) {
    let success = r.result == common::LoginResult::Success as i32;
    if !success {
        with_state(state, ctx, |s| {
            s.connection = ConnStatus::Error;
            s.log(format!(
                "login failed (result={}): {}",
                r.result, r.error_message
            ));
        });
        return;
    }

    let accounts: Vec<AccountInfo> = r
        .accounts
        .iter()
        .map(|a| {
            let name = if !a.display_name.is_empty() {
                a.display_name.clone()
            } else if !a.account_name.is_empty() {
                a.account_name.clone()
            } else {
                a.account_number.clone()
            };
            AccountInfo {
                account_id: a.account_id.clone(),
                display_name: name,
            }
        })
        .collect();

    let first_account = accounts.first().map(|a| a.account_id.clone());
    let token = r.authentication_token.clone();

    with_state(state, ctx, |s| {
        s.connection = ConnStatus::LoggedIn;
        s.accounts = accounts;
        if let Some(t) = &token {
            store_token(s, t);
        }
        s.log(format!(
            "login OK — {} account(s)",
            s.accounts.len()
        ));
    });

    // Auto-subscribe the first account so positions/orders populate.
    if let Some(account_id) = &first_account {
        send_account_subscribe(account_id, out);
        with_state(state, ctx, |s| {
            s.selected_account = Some(account_id.clone());
        });
    }

    // Auto-resolve + subscribe the default market once.
    if !*market_subscribed {
        if let Some(tok) = token.as_ref().and_then(|t| t.token.clone()) {
            *market_subscribed = true;
            spawn_market_subscribe(cfg, state, ctx, out, http, tok);
        }
    }
}

fn spawn_market_subscribe(
    cfg: &Config,
    state: &Shared,
    ctx: &egui::Context,
    out: &Out,
    http: &reqwest::Client,
    token: String,
) {
    let http = http.clone();
    let state = state.clone();
    let ctx = ctx.clone();
    let out = out.clone();
    let api = cfg.websocket.api.clone();
    let exchange = cfg.websocket.md_exchange_id.clone();
    let contract = cfg.websocket.md_contract_id.clone();

    tokio::spawn(async move {
        let market_id = match rest::first_market(&http, &api, &token, &exchange, &contract).await {
            Ok(market_id) => {
                send_market_depth_subscribe(&exchange, &contract, &market_id, &out);
                with_state(&state, &ctx, |s| {
                    // Seed the active product so chart/older/live code follows it.
                    s.exchange_id = Some(exchange.clone());
                    s.contract_id = Some(contract.clone());
                    s.market_id = Some(market_id.clone());
                    s.log(format!("subscribed to market {market_id}"));
                });
                market_id
            }
            Err(e) => {
                with_state(&state, &ctx, |s| s.log(format!("market resolve failed: {e:#}")));
                return;
            }
        };

        // Auto-load a default chart so the Chart tab has data (and a locked view)
        // on first open — no interval click required.
        load_chart(&http, &api, &token, &exchange, &contract, &market_id, "Minute", 1, &state, &ctx)
            .await;
    });
}

// ---------------------------------------------------------------------------
// State appliers
// ---------------------------------------------------------------------------

fn store_token(s: &mut AppState, tok: &auth::AuthenticationToken) {
    if let Some(t) = &tok.token {
        s.auth_token = Some(t.clone());
    }
    if let Some(ts) = &tok.expire_time {
        s.token_expiry = ts.seconds;
    }
}

fn apply_market_depth(s: &mut AppState, d: &market::MarketDepth) {
    if let Some(b) = d.bids.first() {
        s.quote.bid_price = price_string(&b.price);
        s.quote.bid_volume = b.volume;
    }
    if let Some(o) = d.offers.first() {
        s.quote.ask_price = price_string(&o.price);
        s.quote.ask_volume = o.volume;
    }
    if let Some(td) = &d.trade_data {
        let lp = price_string(&td.last_trade_price);
        if !lp.is_empty() {
            s.quote.last_price = lp.clone();
            s.quote.last_volume = td.last_trade_volume;
            apply_live_tick(s, &lp, td.last_trade_volume);
        }
    }
}

/// Fold a trade tick into the current in-progress candle so the chart moves
/// live. T4 trade data carries no per-tick time, so we bucket by wall clock
/// (same approach as the C++/JS demos). No-op until a chart is loaded.
fn apply_live_tick(s: &mut AppState, price_str: &str, volume: i32) {
    if s.candles.is_empty() || s.chart_interval_secs <= 0 {
        return;
    }
    let Ok(price) = price_str.parse::<f64>() else { return };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let bucket_ms = s.chart_interval_secs * 1_000;
    let bucket = now_ms - now_ms.rem_euclid(bucket_ms);

    let Some(last) = s.candles.last_mut() else {
        return;
    };
    if last.time_ms == bucket {
        last.high = last.high.max(price);
        last.low = last.low.min(price);
        last.close = price;
        last.volume += volume;
    } else if bucket > last.time_ms {
        s.candles.push(crate::state::Candle {
            time_ms: bucket,
            open: price,
            high: price,
            low: price,
            close: price,
            volume,
        });
        // New bar appended at the right; existing bars keep their x, so the
        // x-base is unchanged and we deliberately don't re-lock the view.
    }
}

fn apply_position(s: &mut AppState, p: &account::AccountPosition) {
    let row = s.positions.entry(p.market_id.clone()).or_default();
    row.market_id = p.market_id.clone();
    row.net = p.buys - p.sells;
    row.working_buys = p.working_buys;
    row.working_sells = p.working_sells;
    row.rpl = p.rpl;
    row.avg_open_price = p
        .average_open_price
        .as_ref()
        .and_then(|pr| pr.value.parse::<f64>().ok())
        .unwrap_or(0.0);
}

/// Append an activity row to the session feed, capped at 500 (newest last).
fn push_activity(s: &mut AppState, a: crate::state::Activity) {
    s.activity.push(a);
    let n = s.activity.len();
    if n > 500 {
        s.activity.drain(0..n - 500);
    }
}

/// Reconcile an order's row in the activity feed on a status change. The feed
/// keeps only each order's *current* state, so an earlier row for this order is
/// removed before the new one is recorded — Held → Working → finished collapses
/// to a single evolving row (TP/SL children included). A finished order (fully
/// filled or cancelled) drops its row entirely, leaving just its fill row(s).
/// No-op when the status is unchanged. `prev_status` is the row's status before
/// this update.
fn log_order_activity(s: &mut AppState, unique_id: &str, prev_status: &str) {
    let Some(row) = s.orders.get(unique_id) else { return };
    if row.status == prev_status {
        return;
    }
    // Clone what the new row needs before touching `s.activity` — ends the
    // immutable `s.orders` borrow so the mutable feed borrow below is legal.
    let status = row.status.clone();
    let market_id = row.market_id.clone();
    let side = row.side.clone();
    let volume = row.volume;
    let price = row.limit_price.clone();

    // Drop this order's prior status row; only its latest state survives.
    s.activity
        .retain(|a| !(a.kind == crate::state::ActivityKind::Order && a.unique_id == unique_id));

    // A finished order leaves only its fill row(s) — don't re-add a row.
    // Working/Held/Rejected are kept live (Rejected surfaces submission
    // failures, which have no fill row to represent them).
    if status == "Finished" {
        return;
    }
    push_activity(
        s,
        crate::state::Activity {
            unique_id: unique_id.to_string(),
            time_ms: chrono::Utc::now().timestamp_millis(),
            kind: crate::state::ActivityKind::Order,
            market_id,
            side,
            volume,
            price,
            status,
        },
    );
}

fn apply_order_multi(s: &mut AppState, m: &orderrouting::OrderUpdateMulti) {
    use orderrouting::order_update_multi_message::Payload as P;
    for u in &m.updates {
        match &u.payload {
            Some(P::OrderUpdate(o)) => apply_order_update(s, o),
            Some(P::OrderUpdateStatus(st)) => apply_order_status(s, st),
            Some(P::OrderUpdateTrade(t)) => apply_order_trade(s, t),
            Some(P::OrderUpdateFailed(f)) => {
                let prev = s
                    .orders
                    .get(&f.unique_id)
                    .map(|r| r.status.clone())
                    .unwrap_or_default();
                let row = s.orders.entry(f.unique_id.clone()).or_default();
                row.unique_id = f.unique_id.clone();
                row.status = "Rejected".to_string();
                row.status_detail = f.status_detail.clone();
                log_order_activity(s, &f.unique_id, &prev);
            }
            _ => {}
        }
    }
}

fn apply_order_update(s: &mut AppState, o: &orderrouting::OrderUpdate) {
    let prev = s
        .orders
        .get(&o.unique_id)
        .map(|r| r.status.clone())
        .unwrap_or_default();
    let row = s.orders.entry(o.unique_id.clone()).or_default();
    row.unique_id = o.unique_id.clone();
    row.account_id = o.account_id.clone();
    row.market_id = o.market_id.clone();
    row.side = side_label(o.buy_sell).to_string();
    row.price_type = price_type_label(o.price_type).to_string();
    row.volume = o.current_volume;
    row.working_volume = o.working_volume;
    row.limit_price = price_string(&o.current_limit_price);
    row.stop_price = price_string(&o.current_stop_price);
    row.status = order_status_label(o.status).to_string();
    row.status_detail = o.status_detail.clone();
    log_order_activity(s, &o.unique_id, &prev);
}

fn apply_order_status(s: &mut AppState, st: &orderrouting::OrderUpdateStatus) {
    let prev = s
        .orders
        .get(&st.unique_id)
        .map(|r| r.status.clone())
        .unwrap_or_default();
    let row = s.orders.entry(st.unique_id.clone()).or_default();
    row.unique_id = st.unique_id.clone();
    row.account_id = st.account_id.clone();
    row.market_id = st.market_id.clone();
    if st.current_volume != 0 {
        row.volume = st.current_volume;
    }
    row.working_volume = st.working_volume;
    let lp = price_string(&st.current_limit_price);
    if !lp.is_empty() {
        row.limit_price = lp;
    }
    let sp = price_string(&st.current_stop_price);
    if !sp.is_empty() {
        row.stop_price = sp;
    }
    row.status = order_status_label(st.status).to_string();
    if !st.status_detail.is_empty() {
        row.status_detail = st.status_detail.clone();
    }
    log_order_activity(s, &st.unique_id, &prev);
}

fn apply_order_trade(s: &mut AppState, t: &orderrouting::OrderUpdateTrade) {
    let prev = s
        .orders
        .get(&t.unique_id)
        .map(|r| r.status.clone())
        .unwrap_or_default();
    let side = {
        let row = s.orders.entry(t.unique_id.clone()).or_default();
        row.unique_id = t.unique_id.clone();
        row.working_volume = t.working_volume;
        row.status = order_status_label(t.status).to_string();
        row.side.clone()
    };

    // Record the fill for the activity feed (T4 has no per-session backfill, so
    // this is live-only). Side isn't on the trade message — join it from the order.
    let time_ms = t
        .time
        .as_ref()
        .map(|ts| ts.seconds * 1000 + i64::from(ts.nanos) / 1_000_000)
        .filter(|ms| *ms > 0)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    push_activity(
        s,
        crate::state::Activity {
            unique_id: t.unique_id.clone(),
            time_ms,
            kind: crate::state::ActivityKind::Fill,
            market_id: t.market_id.clone(),
            side: if side.is_empty() { "-".to_string() } else { side },
            volume: t.volume,
            price: price_string(&t.price),
            status: String::new(),
        },
    );

    // Reconcile the order's live row: a full fill (status → Finished) removes
    // its stale Working row; a partial fill (status unchanged) is a no-op, so
    // the single Working row persists alongside the new fill row.
    log_order_activity(s, &t.unique_id, &prev);

    s.log(format!(
        "fill: {} @ {} ({} left)",
        t.volume,
        price_string(&t.price),
        t.working_volume
    ));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn price_string(p: &Option<common::Price>) -> String {
    p.as_ref().map(|p| p.value.clone()).unwrap_or_default()
}

fn side_label(v: i32) -> &'static str {
    match common::BuySell::try_from(v) {
        Ok(common::BuySell::Buy) => "Buy",
        Ok(common::BuySell::Sell) => "Sell",
        _ => "-",
    }
}

fn price_type_label(v: i32) -> &'static str {
    match common::PriceType::try_from(v) {
        Ok(common::PriceType::Market) => "Market",
        Ok(common::PriceType::Limit) => "Limit",
        Ok(common::PriceType::StopMarket) => "Stop",
        Ok(common::PriceType::StopLimit) => "StopLimit",
        _ => "-",
    }
}

fn order_status_label(v: i32) -> &'static str {
    match common::OrderStatus::try_from(v) {
        Ok(common::OrderStatus::Working) => "Working",
        Ok(common::OrderStatus::Finished) => "Finished",
        Ok(common::OrderStatus::Rejected) => "Rejected",
        Ok(common::OrderStatus::Held) => "Held",
        _ => "-",
    }
}
