//! Shared UI state and the UI -> network command channel.
//!
//! The network task mutates [`AppState`] behind a `Mutex`; the egui thread reads
//! it each frame. UI actions are sent to the network task as [`Command`]s.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// Shared application state, mutated by the network task and read by the UI.
pub type Shared = Arc<Mutex<AppState>>;

/// High-level connection lifecycle, shown in the status bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConnStatus {
    #[default]
    Connecting,
    Connected,
    LoggedIn,
    Error,
}

impl ConnStatus {
    pub fn label(self) -> &'static str {
        match self {
            ConnStatus::Connecting => "Connecting…",
            ConnStatus::Connected => "Connected",
            ConnStatus::LoggedIn => "Logged in",
            ConnStatus::Error => "Error",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AccountInfo {
    pub account_id: String,
    pub display_name: String,
}

/// Best bid / offer / last trade for the subscribed market.
#[derive(Debug, Clone, Default)]
pub struct Quote {
    pub bid_price: String,
    pub bid_volume: i32,
    pub ask_price: String,
    pub ask_volume: i32,
    pub last_price: String,
    pub last_volume: i32,
}

/// One OHLCV candle for the chart (prices as f64, time as unix ms).
#[derive(Debug, Clone, Copy)]
pub struct Candle {
    pub time_ms: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: i32,
}

/// A contract returned by the contract-search endpoint, shown in the picker.
#[derive(Debug, Clone, Default)]
pub struct ContractHit {
    pub exchange_id: String,
    pub contract_id: String,
    pub description: String,
}

/// An exchange, shown as a top-level node in the contract picker.
#[derive(Debug, Clone, Default)]
pub struct ExchangeInfo {
    pub exchange_id: String,
    pub description: String,
}

/// An expiry "group" (strategy type + expiry date) in the expiry picker.
#[derive(Debug, Clone, Default)]
pub struct ExpiryGroup {
    pub strategy_type: String,
    pub expiry_date: String,
    pub market_count: i32,
}

/// A concrete market within an expiry group.
#[derive(Debug, Clone, Default)]
pub struct ExpiryMarket {
    pub market_id: String,
    pub expiry_date: String,
    pub description: String,
}

#[derive(Debug, Clone, Default)]
pub struct PositionRow {
    pub market_id: String,
    pub net: i32,
    pub working_buys: i32,
    pub working_sells: i32,
    pub rpl: f64,
    pub upl: f64,
    /// Average open price of the net position (0 when flat), for the chart line.
    pub avg_open_price: f64,
}

/// Whether a session-activity row is an order event or an execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActivityKind {
    #[default]
    Order,
    Fill,
}

impl ActivityKind {
    pub fn label(self) -> &'static str {
        match self {
            ActivityKind::Order => "ORDER",
            ActivityKind::Fill => "FILL",
        }
    }
}

/// One row in the session activity feed: either an order event (placed /
/// working / rejected) or an executed fill (own trade). Interleaved
/// chronologically in the "Orders & Fills" blotter, newest last. Live-only —
/// T4 has no per-session backfill on connect. Order rows are superseded per
/// `unique_id`, so the feed keeps only each order's current live state (a
/// finished order drops its row, leaving just its fill row(s)).
#[derive(Debug, Clone, Default)]
pub struct Activity {
    /// The order this row belongs to. Used to supersede an order's prior status
    /// row as it advances (Held → Working → finished). Set on order rows; empty
    /// on fill rows only when the trade lacks it.
    pub unique_id: String,
    /// Event time as unix ms.
    pub time_ms: i64,
    pub kind: ActivityKind,
    pub market_id: String,
    /// "Buy"/"Sell"/"-", joined from the order row by unique_id.
    pub side: String,
    /// Fill quantity, or the order's current volume.
    pub volume: i32,
    pub price: String,
    /// Order status ("Working"/"Finished"/"Rejected"/"Held"); empty for fills.
    pub status: String,
}

#[derive(Debug, Clone, Default)]
pub struct OrderRow {
    pub unique_id: String,
    pub account_id: String,
    pub market_id: String,
    pub side: String,
    pub price_type: String,
    pub volume: i32,
    pub working_volume: i32,
    pub limit_price: String,
    /// Stop (trigger) price for Stop / Stop-Limit orders; empty otherwise.
    pub stop_price: String,
    pub status: String,
    pub status_detail: String,
}

#[derive(Default)]
pub struct AppState {
    pub connection: ConnStatus,
    pub log: Vec<String>,

    pub accounts: Vec<AccountInfo>,
    pub selected_account: Option<String>,

    pub auth_token: Option<String>,
    /// Token expiry as unix seconds (0 = unknown).
    pub token_expiry: i64,

    /// The active market data product. Seeded from config at login, then
    /// updated when the user picks a different contract.
    pub exchange_id: Option<String>,
    pub contract_id: Option<String>,
    pub market_id: Option<String>,
    pub market_decimals: i32,
    /// `real_decimals` from MarketDetails (used when priceFormat = Real).
    pub market_real_decimals: i32,
    /// Dollar value of one full point, from MarketDetails (raw decimal string);
    /// needed to convert bracket $ amounts into price offsets.
    pub market_point_value: Option<String>,
    pub quote: Quote,

    /// Latest contract-search results, shown in the picker dropdown.
    pub contract_results: Vec<ContractHit>,

    // Picker caches (lazily populated as the user expands the dialogs).
    pub exchanges: Vec<ExchangeInfo>,
    pub contracts_by_exchange: BTreeMap<String, Vec<ContractHit>>,
    pub expiry_groups: Vec<ExpiryGroup>,
    /// Keyed by "{strategy_type}|{expiry_date}".
    pub expiry_markets_by_group: BTreeMap<String, Vec<ExpiryMarket>>,

    pub positions: BTreeMap<String, PositionRow>,
    pub orders: BTreeMap<String, OrderRow>,
    /// Account funds for the subscribed account (from AccountUpdate/AccountProfit).
    pub balance: f64,
    pub margin: f64,
    pub available_cash: f64,
    /// Session activity feed (order events + own executions, interleaved),
    /// newest last, capped at 500.
    pub activity: Vec<Activity>,

    pub candles: Vec<Candle>,
    pub chart_loading: bool,
    /// Wire format the most recent chart load arrived in — e.g.
    /// "binary (T4BinAggr)" or "JSON". Empty until the first load; surfaced in
    /// the 20s heartbeat status line.
    pub chart_format: String,
    pub chart_interval: String,
    /// Bar length in seconds (interval × period), for folding live ticks.
    pub chart_interval_secs: i64,
    /// Bar-period multiplier of the loaded chart (1 = 1m/1h/1D).
    pub chart_period: i32,
    /// Bumped every time `candles` is *replaced* (fresh load / market switch),
    /// so the UI re-locks the chart view to the latest bars. Not bumped on
    /// live-append or older-history prepend.
    pub chart_generation: u64,
    /// Plot-x coordinate of `candles[0]`. Bars are drawn at `x_base + index`;
    /// prepending older bars decrements this so existing bars keep their x and
    /// the view doesn't jump.
    pub chart_x_base: i64,
    /// True while an older-history page is in flight.
    pub chart_loading_older: bool,
    /// True once we've paged back to the start of available history.
    pub chart_no_more: bool,
    /// Earliest trade date fetched so far; older pages step back from here.
    pub chart_window_start: Option<chrono::NaiveDate>,
}

impl AppState {
    /// Append a line to the rolling log (kept bounded).
    pub fn log(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        tracing::info!("{msg}");
        self.log.push(msg);
        let len = self.log.len();
        if len > 500 {
            self.log.drain(0..len - 500);
        }
    }
}

/// Which order type the user selected in the entry form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderKind {
    Market,
    Limit,
    /// Stop-market: triggers a market order once `stop_price` trades.
    Stop,
    /// Stop-limit: triggers a limit order (at `limit_price`) once `stop_price` trades.
    StopLimit,
}

impl OrderKind {
    /// Whether this kind carries a limit price.
    pub fn has_limit(self) -> bool {
        matches!(self, OrderKind::Limit | OrderKind::StopLimit)
    }
    /// Whether this kind carries a stop (trigger) price.
    pub fn has_stop(self) -> bool {
        matches!(self, OrderKind::Stop | OrderKind::StopLimit)
    }
}

/// Time-in-force for an order entry. Maps to the T4 `TimeType` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimeInForce {
    /// Good for the session (TimeType::Normal).
    #[default]
    Day,
    /// Good till cancelled.
    Gtc,
    /// Immediate-or-cancel (fill what you can now, cancel the rest).
    Ioc,
    /// Fill-or-kill (all-or-nothing, immediately).
    Fok,
}

impl TimeInForce {
    pub fn label(self) -> &'static str {
        match self {
            TimeInForce::Day => "Day",
            TimeInForce::Gtc => "GTC",
            TimeInForce::Ioc => "IOC",
            TimeInForce::Fok => "FOK",
        }
    }
}

/// A single-order submission built from the order-entry form.
#[derive(Debug, Clone)]
pub struct OrderRequest {
    pub account_id: String,
    pub buy: bool,
    pub kind: OrderKind,
    pub volume: i32,
    /// Limit price as a decimal string (used for Limit / StopLimit).
    pub limit_price: String,
    /// Stop (trigger) price as a decimal string (used for Stop / StopLimit).
    pub stop_price: String,
    /// Time-in-force for the entry order.
    pub tif: TimeInForce,
    /// Optional trailing-stop distance (price units); adds `trail_distance`.
    pub trail: Option<f64>,
    /// Optional bracket take-profit / stop-loss, in dollars. When either is set
    /// the order is submitted as an AUTO_OCO group with protection legs.
    pub take_profit: Option<f64>,
    pub stop_loss: Option<f64>,
}

/// Messages from the UI thread to the network task.
#[derive(Debug, Clone)]
pub enum Command {
    SubscribeAccount(String),
    SubmitOrder(OrderRequest),
    CancelOrder {
        account_id: String,
        market_id: String,
        unique_id: String,
    },
    /// Revise a working order's volume and/or limit price.
    ReviseOrder {
        account_id: String,
        market_id: String,
        unique_id: String,
        volume: i32,
        /// New limit price as a decimal string; `None` leaves it unchanged.
        limit_price: Option<String>,
    },
    LoadChart {
        bar_interval: String,
        bar_period: i32,
    },
    /// Search contracts by free text (min 2 chars); fills `contract_results`.
    SearchContracts(String),
    /// Switch the active market: unsubscribe the old one, resolve + subscribe
    /// the picked contract, then reload the chart.
    SelectMarket {
        exchange_id: String,
        contract_id: String,
    },
    /// Switch to an already-resolved market id (from the expiry picker), skipping
    /// the firstmarket resolve step.
    SelectMarketById {
        exchange_id: String,
        contract_id: String,
        market_id: String,
    },
    /// Populate the exchanges list for the contract picker (skips if cached).
    LoadExchanges,
    /// Populate the contracts under one exchange (skips if cached).
    LoadContractsForExchange(String),
    /// Populate expiry groups for the active exchange/contract.
    LoadExpiryGroups,
    /// Populate the markets under one expiry group.
    LoadExpiryMarkets {
        strategy_type: String,
        expiry_date: String,
    },
    /// Page in a chunk of older bars when the user scrolls to the left edge.
    LoadOlderChart,
    /// Close a net position with a market order for its full size.
    FlattenPosition {
        account_id: String,
        market_id: String,
    },
    /// Flip a net position (market order for twice its size).
    ReversePosition {
        account_id: String,
        market_id: String,
    },
    /// Pull every working order, optionally restricted to one market.
    CancelAllOrders {
        account_id: String,
        market_id: Option<String>,
    },
}
