//! egui front-end. Reads a snapshot of the shared state each frame and sends
//! user actions to the network task as [`Command`]s.
//!
//! Layout mirrors the sibling C++ demo: a top connection/account bar, a
//! **Trading** tab laid out as a 2×2 grid (Market Data, Order Entry, Positions,
//! Orders) and a **Chart** tab, with the log pinned to the bottom.

use crate::state::{
    AccountInfo, Activity, ActivityKind, Candle, Command, ConnStatus, ContractHit, ExchangeInfo,
    ExpiryGroup, ExpiryMarket, OrderKind, OrderRequest, OrderRow, PositionRow, Quote, Shared,
    TimeInForce,
};
use egui::Color32;
use egui_plot::{
    Bar, BarChart, BoxElem, BoxPlot, BoxSpread, HLine, Line, LineStyle, MarkerShape, Plot,
    PlotBounds, PlotPoints, Points,
};
use std::collections::{BTreeMap, HashSet};
use tokio::sync::mpsc::UnboundedSender;

/// The two top-level views, selected by the tab bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tab {
    Trading,
    Chart,
}

/// How the price series is drawn in the Chart tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChartStyle {
    Candles,
    Line,
    HeikinAshi,
}

/// Active chart drawing tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DrawMode {
    Off,
    HLine,
    Trend,
}

/// A user-drawn chart annotation, anchored on `(time_ms, price)` so it survives
/// history prepends and interval reloads. One anchor = horizontal line; two =
/// trendline segment.
#[derive(Debug, Clone)]
struct Drawing {
    anchors: Vec<(i64, f64)>,
}

/// How many of the newest bars the chart locks into view on load.
const CHART_VIEW_BARS: usize = 120;

/// Load older history once the visible left edge comes within this many bars of
/// the oldest loaded bar.
const SCROLL_BUFFER: f64 = 20.0;

/// Extra bars drawn on each side of the visible viewport, so a one-frame lag in
/// the view bounds (we slice using *last* frame's range) never shows an edge.
const RENDER_MARGIN: i64 = 8;

/// Bars computed *before* the viewport when building indicators, so windowed and
/// EMA-based series are visually identical to a full-history computation at the
/// viewport's left edge (covers MA_SLOW=50, Bollinger/EMA=20, RSI=14; EMA/MACD
/// converge well within this many bars).
const INDICATOR_WARMUP: usize = 250;

/// Mouse-wheel zoom strength. The per-frame zoom factor is `exp(delta * this)`,
/// so a positive scroll (wheel up) zooms in and a negative scroll zooms out.
const ZOOM_SENSITIVITY: f32 = 0.005;

/// Candle / volume colors for up and down bars.
const UP_COLOR: Color32 = Color32::from_rgb(0x26, 0xa6, 0x9a); // teal-green
const DOWN_COLOR: Color32 = Color32::from_rgb(0xef, 0x53, 0x50); // red

/// Periods for the two optional moving-average overlays.
const MA_FAST: usize = 20;
const MA_SLOW: usize = 50;

/// Indicator parameters (fixed for the demo).
const EMA_PERIOD: usize = 20;
const BOLL_PERIOD: usize = 20;
const BOLL_K: f64 = 2.0;
const RSI_PERIOD: usize = 14;
const MACD_FAST: usize = 12;
const MACD_SLOW: usize = 26;
const MACD_SIGNAL: usize = 9;

/// A cheap per-frame copy of the parts of state the UI renders, so we don't hold
/// the state lock while drawing.
struct Snapshot {
    connection: ConnStatus,
    accounts: Vec<AccountInfo>,
    selected_account: Option<String>,
    exchange_id: Option<String>,
    contract_id: Option<String>,
    market_id: Option<String>,
    quote: Quote,
    positions: Vec<PositionRow>,
    orders: Vec<OrderRow>,
    activity: Vec<Activity>,
    balance: f64,
    margin: f64,
    available_cash: f64,
    candles: Vec<Candle>,
    contract_results: Vec<ContractHit>,
    exchanges: Vec<ExchangeInfo>,
    contracts_by_exchange: BTreeMap<String, Vec<ContractHit>>,
    expiry_groups: Vec<ExpiryGroup>,
    expiry_markets_by_group: BTreeMap<String, Vec<ExpiryMarket>>,
    chart_loading: bool,
    chart_interval: String,
    /// Bar-period multiplier of the loaded chart (distinguishes 1m/5m/15m).
    chart_period: i32,
    chart_generation: u64,
    chart_x_base: i64,
    chart_loading_older: bool,
    chart_no_more: bool,
    log_tail: Vec<String>,
}

pub struct App {
    state: Shared,
    cmd_tx: UnboundedSender<Command>,

    // Which top-level tab is showing.
    tab: Tab,

    // Order-entry form.
    order_buy: bool,
    order_kind: OrderKind,
    order_volume: i32,
    order_price: String,
    /// Stop (trigger) price for Stop / StopLimit orders (blank = none).
    order_stop: String,
    /// Time-in-force selected in the entry form.
    order_tif: TimeInForce,
    /// Optional trailing-stop distance in price units (blank = none).
    order_trail: String,
    /// Optional bracket take-profit / stop-loss, in dollars (blank = none).
    order_tp: String,
    order_sl: String,
    /// The market the Price field was last auto-seeded for; a change re-seeds.
    price_market: Option<String>,

    // Chart view locking.
    /// When set, the next chart frame re-locks the view to the newest bars.
    chart_follow: bool,
    /// The chart generation we last locked the view for; a change means fresh data.
    last_locked_generation: u64,
    /// Last frame's visible x-range, used to slice this frame's chart geometry to
    /// the viewport. `None` on the first frame after a fresh load (falls back to
    /// the newest-bars window).
    last_visible_x: Option<(f64, f64)>,

    // Chart display options.
    /// Candlestick vs. close-price line.
    chart_style: ChartStyle,
    /// Whether the MA_FAST / MA_SLOW moving-average overlays are drawn.
    ma_fast_on: bool,
    ma_slow_on: bool,
    /// Price-pane indicator overlays.
    ema_on: bool,
    vwap_on: bool,
    boll_on: bool,
    /// Sub-pane oscillators below the chart.
    rsi_on: bool,
    macd_on: bool,
    /// Whether the volume pane below the price chart is shown.
    show_volume: bool,

    // Chart drawing tools.
    draw_mode: DrawMode,
    /// User drawings keyed by market id (session-only).
    drawings: BTreeMap<String, Vec<Drawing>>,
    /// First anchor of an in-progress trendline (awaiting the second click).
    pending_anchor: Option<(i64, f64)>,

    /// Free-text in the market/contract search box.
    contract_query: String,

    // Picker dialogs.
    contract_dialog_open: bool,
    expiry_dialog_open: bool,
    /// Exchanges we've already asked the network task to load contracts for, so
    /// an open CollapsingHeader doesn't re-send the request every frame.
    contracts_requested: HashSet<String>,
    /// Expiry-group keys we've already requested markets for (same reason).
    expiry_markets_requested: HashSet<String>,

    /// Whether the dark egui theme is active (toggled from the top bar).
    dark_mode: bool,

    // Modify-order dialog state (seeded when the user clicks a working order).
    modify_open: bool,
    modify_unique_id: String,
    modify_account_id: String,
    modify_market_id: String,
    modify_volume: i32,
    modify_price: String,

    // Flash-on-update tracking for the Bid/Ask/Last cards: the previously seen
    // value and the `ui.input().time` at which it last changed.
    prev_bid: String,
    prev_ask: String,
    prev_last: String,
    bid_flash_at: f64,
    ask_flash_at: f64,
    last_flash_at: f64,

    // Order UX.
    /// When set, Submit opens a confirmation dialog instead of sending directly.
    confirm_orders: bool,
    /// Order awaiting confirmation in the dialog.
    pending_order: Option<OrderRequest>,
    /// Number of fills seen last frame, and when the count last grew — used to
    /// flash the Orders & Fills header on a new execution.
    fill_count: usize,
    fill_flash_at: f64,
}

impl App {
    pub fn new(state: Shared, cmd_tx: UnboundedSender<Command>) -> Self {
        App {
            state,
            cmd_tx,
            tab: Tab::Trading,
            order_buy: true,
            order_kind: OrderKind::Limit,
            order_volume: 1,
            order_price: String::new(),
            order_stop: String::new(),
            order_tif: TimeInForce::Day,
            order_trail: String::new(),
            order_tp: String::new(),
            order_sl: String::new(),
            price_market: None,
            chart_follow: true,
            last_locked_generation: 0,
            last_visible_x: None,
            chart_style: ChartStyle::Candles,
            ma_fast_on: false,
            ma_slow_on: false,
            ema_on: false,
            vwap_on: false,
            boll_on: false,
            rsi_on: false,
            macd_on: false,
            show_volume: true,
            draw_mode: DrawMode::Off,
            drawings: BTreeMap::new(),
            pending_anchor: None,
            contract_query: String::new(),
            contract_dialog_open: false,
            expiry_dialog_open: false,
            contracts_requested: HashSet::new(),
            expiry_markets_requested: HashSet::new(),
            dark_mode: false,
            modify_open: false,
            modify_unique_id: String::new(),
            modify_account_id: String::new(),
            modify_market_id: String::new(),
            modify_volume: 1,
            modify_price: String::new(),
            prev_bid: String::new(),
            prev_ask: String::new(),
            prev_last: String::new(),
            bid_flash_at: 0.0,
            ask_flash_at: 0.0,
            last_flash_at: 0.0,
            confirm_orders: false,
            pending_order: None,
            fill_count: 0,
            fill_flash_at: 0.0,
        }
    }

    fn snapshot(&self) -> Snapshot {
        // Never panic the UI on a poisoned lock: recover the guard and keep rendering.
        let s = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let log_len = s.log.len();
        Snapshot {
            connection: s.connection,
            accounts: s.accounts.clone(),
            selected_account: s.selected_account.clone(),
            exchange_id: s.exchange_id.clone(),
            contract_id: s.contract_id.clone(),
            market_id: s.market_id.clone(),
            quote: s.quote.clone(),
            positions: s.positions.values().cloned().collect(),
            orders: s.orders.values().cloned().collect(),
            activity: s.activity.clone(),
            balance: s.balance,
            margin: s.margin,
            available_cash: s.available_cash,
            candles: s.candles.clone(),
            contract_results: s.contract_results.clone(),
            exchanges: s.exchanges.clone(),
            contracts_by_exchange: s.contracts_by_exchange.clone(),
            expiry_groups: s.expiry_groups.clone(),
            expiry_markets_by_group: s.expiry_markets_by_group.clone(),
            chart_loading: s.chart_loading,
            chart_interval: s.chart_interval.clone(),
            chart_period: s.chart_period,
            chart_generation: s.chart_generation,
            chart_x_base: s.chart_x_base,
            chart_loading_older: s.chart_loading_older,
            chart_no_more: s.chart_no_more,
            log_tail: s.log[log_len.saturating_sub(100)..].to_vec(),
        }
    }

    fn send(&self, cmd: Command) {
        if self.cmd_tx.send(cmd).is_err() {
            // Network thread is gone; surface it instead of silently dropping the action.
            if let Ok(mut s) = self.state.lock() {
                s.log("network channel closed — action dropped");
            }
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let snap = self.snapshot();

        // Flash the Orders & Fills header whenever a new fill arrives.
        let fills = snap
            .activity
            .iter()
            .filter(|a| a.kind == ActivityKind::Fill)
            .count();
        if fills > self.fill_count {
            self.fill_flash_at = ctx.input(|i| i.time);
        }
        self.fill_count = fills;

        self.top_bar(ctx, &snap);
        self.log_panel(ctx, &snap);
        egui::CentralPanel::default().show(ctx, |ui| match self.tab {
            Tab::Trading => self.trading_tab(ui, &snap),
            Tab::Chart => self.chart_tab(ui, &snap),
        });

        self.contract_dialog(ctx, &snap);
        self.expiry_dialog(ctx, &snap);
        self.modify_dialog(ctx);
        self.confirm_dialog(ctx);
    }
}

impl App {
    fn top_bar(&mut self, ctx: &egui::Context, snap: &Snapshot) {
        egui::TopBottomPanel::top("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("T4 Rust Demo");
                ui.separator();

                let (txt, color) = match snap.connection {
                    ConnStatus::LoggedIn => (snap.connection.label(), Color32::from_rgb(0, 170, 0)),
                    ConnStatus::Connected => (snap.connection.label(), Color32::YELLOW),
                    ConnStatus::Connecting => (snap.connection.label(), Color32::GRAY),
                    ConnStatus::Error => (snap.connection.label(), Color32::from_rgb(210, 60, 60)),
                };
                ui.colored_label(color, txt);
                ui.separator();

                // Account selector.
                let current = snap
                    .selected_account
                    .as_deref()
                    .and_then(|id| snap.accounts.iter().find(|a| a.account_id == id))
                    .map(|a| a.display_name.clone())
                    .unwrap_or_else(|| "— select account —".to_string());

                egui::ComboBox::from_id_salt("account")
                    .selected_text(current)
                    .show_ui(ui, |ui| {
                        for acc in &snap.accounts {
                            let selected = snap.selected_account.as_deref() == Some(&acc.account_id);
                            if ui.selectable_label(selected, &acc.display_name).clicked() && !selected
                            {
                                self.send(Command::SubscribeAccount(acc.account_id.clone()));
                            }
                        }
                    });

                if let Some(m) = &snap.market_id {
                    ui.separator();
                    ui.label(format!("Market: {m}"));
                }

                // Account funds readout (populated after account subscribe).
                if snap.selected_account.is_some()
                    && (snap.balance != 0.0 || snap.margin != 0.0 || snap.available_cash != 0.0)
                {
                    ui.separator();
                    ui.label(format!(
                        "Bal {:.0} · Margin {:.0} · Avail {:.0}",
                        snap.balance, snap.margin, snap.available_cash
                    ))
                    .on_hover_text("Account balance · margin requirement · available funds");
                }

                ui.separator();
                if ui.button("Contract").clicked() {
                    self.contract_dialog_open = true;
                    self.send(Command::LoadExchanges);
                }
                let has_market = snap.market_id.is_some();
                if ui
                    .add_enabled(has_market, egui::Button::new("Expiry"))
                    .clicked()
                {
                    self.expiry_dialog_open = true;
                    self.expiry_markets_requested.clear();
                    self.send(Command::LoadExpiryGroups);
                }

                // Theme toggle, pushed to the right edge.
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let icon = if self.dark_mode { "☀" } else { "🌙" };
                    if ui.button(icon).on_hover_text("Toggle theme").clicked() {
                        self.dark_mode = !self.dark_mode;
                        ctx.set_visuals(if self.dark_mode {
                            egui::Visuals::dark()
                        } else {
                            egui::Visuals::light()
                        });
                    }
                });
            });

            // Tab selector.
            ui.horizontal(|ui| {
                ui.selectable_value(&mut self.tab, Tab::Trading, "Trading");
                ui.selectable_value(&mut self.tab, Tab::Chart, "Chart");
            });
        });
    }

    /// Contract picker: search box (≥2 chars) grouping matches by exchange, or a
    /// browsable exchange→contract tree when the box is empty. Selecting resolves
    /// the market via firstmarket.
    fn contract_dialog(&mut self, ctx: &egui::Context, snap: &Snapshot) {
        if !self.contract_dialog_open {
            return;
        }
        let mut win_open = true;
        let mut picked: Option<(String, String)> = None;

        egui::Window::new("Select a Contract")
            .open(&mut win_open)
            .collapsible(false)
            .resizable(true)
            .default_size([420.0, 520.0])
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label("Search");
                    if ui.text_edit_singleline(&mut self.contract_query).changed() {
                        let term = self.contract_query.trim().to_string();
                        if term.len() >= 2 {
                            self.send(Command::SearchContracts(term));
                        }
                    }
                });
                ui.separator();

                egui::ScrollArea::vertical().show(ui, |ui| {
                    if self.contract_query.trim().len() >= 2 {
                        // Search mode: group hits by exchange.
                        let mut by_ex: BTreeMap<&str, Vec<&ContractHit>> = BTreeMap::new();
                        for h in &snap.contract_results {
                            by_ex.entry(h.exchange_id.as_str()).or_default().push(h);
                        }
                        if by_ex.is_empty() {
                            ui.small("No matches.");
                        }
                        for (ex, hits) in by_ex {
                            egui::CollapsingHeader::new(ex)
                                .default_open(true)
                                .id_salt(ex)
                                .show(ui, |ui| {
                                    for h in hits {
                                        if ui.selectable_label(false, contract_label(h)).clicked() {
                                            picked = Some((h.exchange_id.clone(), h.contract_id.clone()));
                                        }
                                    }
                                });
                        }
                    } else {
                        // Browse mode: exchanges → lazily-loaded contracts.
                        if snap.exchanges.is_empty() {
                            ui.spinner();
                        }
                        for ex in &snap.exchanges {
                            let title = if ex.description.is_empty() {
                                ex.exchange_id.clone()
                            } else {
                                format!("{} ({})", ex.description, ex.exchange_id)
                            };
                            egui::CollapsingHeader::new(title)
                                .id_salt(&ex.exchange_id)
                                .show(ui, |ui| match snap.contracts_by_exchange.get(&ex.exchange_id) {
                                    Some(list) => {
                                        if list.is_empty() {
                                            ui.small("No contracts.");
                                        }
                                        for h in list {
                                            if ui.selectable_label(false, contract_label(h)).clicked()
                                            {
                                                picked = Some((h.exchange_id.clone(), h.contract_id.clone()));
                                            }
                                        }
                                    }
                                    None => {
                                        ui.spinner();
                                        if self.contracts_requested.insert(ex.exchange_id.clone()) {
                                            self.send(Command::LoadContractsForExchange(
                                                ex.exchange_id.clone(),
                                            ));
                                        }
                                    }
                                });
                        }
                    }
                });
            });

        if let Some((exchange_id, contract_id)) = picked {
            self.send(Command::SelectMarket { exchange_id, contract_id });
            self.contract_query.clear();
            self.contract_dialog_open = false;
        } else {
            self.contract_dialog_open = win_open;
        }
    }

    /// Expiry picker: expiry groups for the active contract → lazily-loaded
    /// markets. Selecting switches to that market id directly.
    fn expiry_dialog(&mut self, ctx: &egui::Context, snap: &Snapshot) {
        if !self.expiry_dialog_open {
            return;
        }
        let ex = snap.exchange_id.clone().unwrap_or_default();
        let ct = snap.contract_id.clone().unwrap_or_default();
        let mut win_open = true;
        let mut picked: Option<String> = None;

        egui::Window::new("Select an Expiry")
            .open(&mut win_open)
            .collapsible(false)
            .resizable(true)
            .default_size([420.0, 520.0])
            .show(ctx, |ui| {
                if ex.is_empty() || ct.is_empty() {
                    ui.label("Pick a contract first.");
                    return;
                }
                ui.label(format!("{ex} / {ct}"));
                ui.separator();

                egui::ScrollArea::vertical().show(ui, |ui| {
                    if snap.expiry_groups.is_empty() {
                        ui.spinner();
                    }
                    for g in &snap.expiry_groups {
                        let name = strategy_display_name(&g.strategy_type);
                        let title = if g.expiry_date.is_empty() {
                            format!("{name} ({})", g.market_count)
                        } else {
                            format!("{name} · {} ({})", g.expiry_date, g.market_count)
                        };
                        let key = format!("{}|{}", g.strategy_type, g.expiry_date);
                        egui::CollapsingHeader::new(title).id_salt(&key).show(ui, |ui| {
                            match snap.expiry_markets_by_group.get(&key) {
                                Some(list) => {
                                    if list.is_empty() {
                                        ui.small("No markets.");
                                    }
                                    for m in list {
                                        let label = match (m.description.is_empty(), m.expiry_date.is_empty()) {
                                            (false, _) => format!("{} ({})", m.description, m.market_id),
                                            (true, false) => format!("{} ({})", m.expiry_date, m.market_id),
                                            (true, true) => m.market_id.clone(),
                                        };
                                        if ui.selectable_label(false, label).clicked() {
                                            picked = Some(m.market_id.clone());
                                        }
                                    }
                                }
                                None => {
                                    ui.spinner();
                                    if self.expiry_markets_requested.insert(key.clone()) {
                                        self.send(Command::LoadExpiryMarkets {
                                            strategy_type: g.strategy_type.clone(),
                                            expiry_date: g.expiry_date.clone(),
                                        });
                                    }
                                }
                            }
                        });
                    }
                });
            });

        if let Some(market_id) = picked {
            self.send(Command::SelectMarketById {
                exchange_id: ex,
                contract_id: ct,
                market_id,
            });
            self.expiry_dialog_open = false;
        } else {
            self.expiry_dialog_open = win_open;
        }
    }

    fn log_panel(&mut self, ctx: &egui::Context, snap: &Snapshot) {
        egui::TopBottomPanel::bottom("log")
            .resizable(true)
            .default_height(120.0)
            .show(ctx, |ui| {
                ui.label("Log");
                egui::ScrollArea::vertical()
                    .stick_to_bottom(true)
                    .show(ui, |ui| {
                        for line in &snap.log_tail {
                            ui.monospace(line);
                        }
                    });
            });
    }

    // -- Trading tab: 2×2 grid --------------------------------------------

    fn trading_tab(&mut self, ui: &mut egui::Ui, snap: &Snapshot) {
        // Two quadrant rows take ~36% of the height each; the full-width
        // Orders & Fills blotter takes the remainder (mirrors the JS demo's
        // trade-history row).
        let row_h = ((ui.available_height() - 16.0) * 0.36).max(120.0);
        let w = ui.available_width();

        ui.allocate_ui(egui::vec2(w, row_h), |ui| {
            ui.columns(2, |c| {
                panel(&mut c[0], "Market Data", |ui| self.market_data(ui, snap));
                panel(&mut c[1], "Order Entry", |ui| self.order_entry(ui, snap));
            });
        });
        ui.allocate_ui(egui::vec2(w, row_h), |ui| {
            ui.columns(2, |c| {
                panel(&mut c[0], "Positions", |ui| self.positions(ui, snap));
                panel(&mut c[1], "Orders", |ui| self.orders(ui, snap));
            });
        });
        panel(ui, "Orders & Fills", |ui| self.activity_feed(ui, snap));
    }

    fn market_data(&mut self, ui: &mut egui::Ui, snap: &Snapshot) {
        let q = &snap.quote;

        // Record a flash timestamp whenever a value changes since last frame.
        let now = ui.input(|i| i.time);
        if q.bid_price != self.prev_bid {
            self.prev_bid = q.bid_price.clone();
            self.bid_flash_at = now;
        }
        if q.ask_price != self.prev_ask {
            self.prev_ask = q.ask_price.clone();
            self.ask_flash_at = now;
        }
        if q.last_price != self.prev_last {
            self.prev_last = q.last_price.clone();
            self.last_flash_at = now;
        }

        // Animate a 0→1 fade factor per card (egui 0.29 has no animate_color_*).
        let ctx = ui.ctx().clone();
        let flash_t = |id: &str, at: f64| -> f32 {
            ctx.animate_bool_with_time(egui::Id::new(id), now - at < FLASH_SECS, FLASH_SECS as f32)
        };
        let bid_t = flash_t("bid_flash", self.bid_flash_at);
        let ask_t = flash_t("ask_flash", self.ask_flash_at);
        let last_t = flash_t("last_flash", self.last_flash_at);

        ui.columns(3, |c| {
            quote_card(&mut c[0], "Bid", &q.bid_price, q.bid_volume, BID_BORDER,
                lerp_color(BID_BG, BID_FLASH, bid_t), BID_TEXT);
            quote_card(&mut c[1], "Ask", &q.ask_price, q.ask_volume, ASK_BORDER,
                lerp_color(ASK_BG, ASK_FLASH, ask_t), ASK_TEXT);
            quote_card(&mut c[2], "Last", &q.last_price, q.last_volume, LAST_BORDER,
                lerp_color(LAST_BG, LAST_FLASH, last_t), LAST_TEXT);
        });
    }

    fn order_entry(&mut self, ui: &mut egui::Ui, snap: &Snapshot) {
        // Seed the limit-price field with the market's current price the first
        // time it's available (and whenever the market changes), so it starts
        // where the market is. Any value already typed is left untouched.
        if snap.market_id != self.price_market {
            self.price_market = snap.market_id.clone();
            self.order_price.clear();
        }
        if self.order_kind.has_limit() && self.order_price.trim().is_empty() {
            let cur = current_price(&snap.quote);
            if !cur.is_empty() {
                self.order_price = cur;
            }
        }

        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.order_buy, true, "Buy");
            ui.selectable_value(&mut self.order_buy, false, "Sell");
        });
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.order_kind, OrderKind::Limit, "Limit");
            ui.selectable_value(&mut self.order_kind, OrderKind::Market, "Market");
            ui.selectable_value(&mut self.order_kind, OrderKind::Stop, "Stop");
            ui.selectable_value(&mut self.order_kind, OrderKind::StopLimit, "StopLmt");
        });
        ui.horizontal(|ui| {
            ui.label("Qty");
            ui.add(egui::DragValue::new(&mut self.order_volume).range(1..=1000));
            // Quick-set presets.
            for q in [1, 5, 10, 25] {
                if ui.small_button(q.to_string()).clicked() {
                    self.order_volume = q;
                }
            }
        });
        if self.order_kind.has_limit() {
            ui.horizontal(|ui| {
                ui.label("Limit");
                ui.text_edit_singleline(&mut self.order_price);
            });
        }
        if self.order_kind.has_stop() {
            ui.horizontal(|ui| {
                ui.label("Stop ");
                ui.text_edit_singleline(&mut self.order_stop);
            });
        }

        // Time-in-force + optional trailing-stop distance.
        ui.horizontal(|ui| {
            ui.label("TIF");
            egui::ComboBox::from_id_salt("tif")
                .selected_text(self.order_tif.label())
                .show_ui(ui, |ui| {
                    for tif in [
                        TimeInForce::Day,
                        TimeInForce::Gtc,
                        TimeInForce::Ioc,
                        TimeInForce::Fok,
                    ] {
                        ui.selectable_value(&mut self.order_tif, tif, tif.label());
                    }
                });
            if self.order_kind.has_stop() {
                ui.label("Trail");
                ui.add(egui::TextEdit::singleline(&mut self.order_trail).desired_width(60.0))
                    .on_hover_text("Trailing-stop distance in price units (blank = fixed stop)");
            }
        });

        // Optional bracket legs (dollars). Blank = none.
        ui.horizontal(|ui| {
            ui.label("TP $");
            ui.add(egui::TextEdit::singleline(&mut self.order_tp).desired_width(70.0));
            ui.label("SL $");
            ui.add(egui::TextEdit::singleline(&mut self.order_sl).desired_width(70.0));
        });

        ui.checkbox(&mut self.confirm_orders, "Confirm before submit");

        ui.add_space(6.0);
        let can_submit = snap.selected_account.is_some() && snap.market_id.is_some();
        if ui
            .add_enabled(can_submit, egui::Button::new("Submit Order"))
            .clicked()
        {
            if let Some(account_id) = snap.selected_account.clone() {
                let req = OrderRequest {
                    account_id,
                    buy: self.order_buy,
                    kind: self.order_kind,
                    volume: self.order_volume,
                    limit_price: self.order_price.clone(),
                    stop_price: self.order_stop.clone(),
                    tif: self.order_tif,
                    trail: self.order_trail.trim().parse::<f64>().ok(),
                    take_profit: self.order_tp.trim().parse::<f64>().ok(),
                    stop_loss: self.order_sl.trim().parse::<f64>().ok(),
                };
                // Route through the confirmation dialog when enabled.
                if self.confirm_orders {
                    self.pending_order = Some(req);
                } else {
                    self.send(Command::SubmitOrder(req));
                }
            }
        }
        if !can_submit {
            ui.small("Waiting for account + market…");
        }
    }

    /// Order confirmation dialog: summarizes the pending order and gates
    /// submission behind an explicit Confirm.
    fn confirm_dialog(&mut self, ctx: &egui::Context) {
        let Some(req) = self.pending_order.clone() else {
            return;
        };
        let mut open = true;
        let mut decided = false;
        egui::Window::new("Confirm Order")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
            .show(ctx, |ui| {
                let kind = match req.kind {
                    OrderKind::Market => "Market".to_string(),
                    OrderKind::Limit => format!("Limit @ {}", req.limit_price),
                    OrderKind::Stop => format!("Stop @ {}", req.stop_price),
                    OrderKind::StopLimit => {
                        format!("StopLimit stop {} / limit {}", req.stop_price, req.limit_price)
                    }
                };
                ui.strong(format!(
                    "{} {} · {}",
                    if req.buy { "BUY" } else { "SELL" },
                    req.volume,
                    kind,
                ));
                ui.label(format!("Time-in-force: {}", req.tif.label()));
                if let Some(t) = req.trail {
                    ui.label(format!("Trailing distance: {t}"));
                }
                if req.take_profit.is_some() || req.stop_loss.is_some() {
                    ui.label(format!(
                        "Bracket: TP {} · SL {}",
                        req.take_profit.map(|v| format!("${v}")).unwrap_or_else(|| "—".into()),
                        req.stop_loss.map(|v| format!("${v}")).unwrap_or_else(|| "—".into()),
                    ));
                }
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui
                        .button(egui::RichText::new("Confirm").color(Color32::from_rgb(0, 150, 0)))
                        .clicked()
                    {
                        self.send(Command::SubmitOrder(req.clone()));
                        decided = true;
                    }
                    if ui.button("Cancel").clicked() {
                        decided = true;
                    }
                });
            });
        if !open || decided {
            self.pending_order = None;
        }
    }

    fn positions(&self, ui: &mut egui::Ui, snap: &Snapshot) {
        egui::ScrollArea::vertical()
            .id_salt("positions")
            .show(ui, |ui| {
                egui::Grid::new("pos_grid").striped(true).show(ui, |ui| {
                    ui.label("Market");
                    ui.label("Net");
                    ui.label("Wk B/S");
                    ui.label("RPL");
                    ui.label("UPL");
                    ui.label("");
                    ui.end_row();
                    for p in &snap.positions {
                        ui.label(&p.market_id);
                        ui.label(p.net.to_string());
                        ui.label(format!("{}/{}", p.working_buys, p.working_sells));
                        ui.label(format!("{:.2}", p.rpl));
                        ui.label(format!("{:.2}", p.upl));
                        // Flatten / reverse the net position with a market order.
                        ui.horizontal(|ui| {
                            let can_act = p.net != 0 && snap.selected_account.is_some();
                            if ui
                                .add_enabled(can_act, egui::Button::new("Flat").small())
                                .clicked()
                            {
                                if let Some(account_id) = snap.selected_account.clone() {
                                    self.send(Command::FlattenPosition {
                                        account_id,
                                        market_id: p.market_id.clone(),
                                    });
                                }
                            }
                            if ui
                                .add_enabled(can_act, egui::Button::new("Rev").small())
                                .clicked()
                            {
                                if let Some(account_id) = snap.selected_account.clone() {
                                    self.send(Command::ReversePosition {
                                        account_id,
                                        market_id: p.market_id.clone(),
                                    });
                                }
                            }
                        });
                        ui.end_row();
                    }
                });
            });
    }

    fn orders(&mut self, ui: &mut egui::Ui, snap: &Snapshot) {
        // Bulk cancel: pull every working order for the active account.
        let has_working = snap.orders.iter().any(|o| o.status == "Working" || o.status == "Held");
        let can_cancel_all = has_working && snap.selected_account.is_some();
        if ui
            .add_enabled(can_cancel_all, egui::Button::new("Cancel All").small())
            .clicked()
        {
            if let Some(account_id) = snap.selected_account.clone() {
                self.send(Command::CancelAllOrders {
                    account_id,
                    market_id: None,
                });
            }
        }
        egui::ScrollArea::vertical()
            .id_salt("orders")
            .show(ui, |ui| {
                egui::Grid::new("ord_grid").striped(true).show(ui, |ui| {
                    ui.label("Side");
                    ui.label("Type");
                    ui.label("Price");
                    ui.label("Wk/Vol");
                    ui.label("Status");
                    ui.label("");
                    ui.end_row();
                    for o in &snap.orders {
                        ui.label(&o.side);
                        ui.label(&o.price_type);
                        ui.label(disp(&o.limit_price));
                        ui.label(format!("{}/{}", o.working_volume, o.volume));
                        ui.label(&o.status);
                        if o.status == "Working" {
                            if ui.small_button("Modify").clicked() {
                                self.modify_unique_id = o.unique_id.clone();
                                self.modify_account_id = o.account_id.clone();
                                self.modify_market_id = o.market_id.clone();
                                self.modify_volume = o.volume.max(1);
                                self.modify_price = o.limit_price.clone();
                                self.modify_open = true;
                            }
                        } else {
                            ui.label("");
                        }
                        ui.end_row();
                    }
                });
            });
    }

    /// Session activity feed: order events and own executions interleaved
    /// chronologically, with a fill-summary line, newest at the bottom. Mirrors
    /// the JS demo's trade-history view (Time/Type/Market/Side/Qty/Price/
    /// Status). Live-only — T4 has no per-session backfill on connect.
    fn activity_feed(&self, ui: &mut egui::Ui, snap: &Snapshot) {
        let fills = || snap.activity.iter().filter(|a| a.kind == ActivityKind::Fill);
        let trades = fills().count();
        let lots: i32 = fills().map(|f| f.volume).sum();
        let buys: i32 = fills().filter(|f| f.side == "Buy").map(|f| f.volume).sum();
        let sells: i32 = fills().filter(|f| f.side == "Sell").map(|f| f.volume).sum();
        let net = buys - sells;
        if snap.activity.is_empty() {
            ui.small("No activity yet this session");
        } else {
            // Flash the summary bright on a new fill, fading back to the normal
            // weak text color (same technique as the Bid/Ask/Last cards).
            let now = ui.input(|i| i.time);
            let t = ui.ctx().animate_bool_with_time(
                egui::Id::new("fill_flash"),
                now - self.fill_flash_at < FLASH_SECS,
                FLASH_SECS as f32,
            );
            let base = ui.visuals().weak_text_color();
            let color = lerp_color(base, Color32::from_rgb(70, 130, 220), t);
            ui.small(
                egui::RichText::new(format!(
                    "{trades} trade(s) · {lots} lot(s) · {buys} buy / {sells} sell · net {}{net}",
                    if net > 0 { "+" } else { "" },
                ))
                .color(color),
            );
        }

        egui::ScrollArea::vertical()
            .id_salt("activity")
            .auto_shrink([false, false])
            .stick_to_bottom(true)
            .show(ui, |ui| {
                egui::Grid::new("activity_grid")
                    .striped(true)
                    .num_columns(7)
                    .show(ui, |ui| {
                        ui.strong("Time");
                        ui.strong("Type");
                        ui.strong("Market");
                        ui.strong("Side");
                        ui.strong("Qty");
                        ui.strong("Price");
                        ui.strong("Status");
                        ui.end_row();
                        for a in &snap.activity {
                            ui.label(fmt_hms(a.time_ms));
                            match a.kind {
                                ActivityKind::Order => ui.colored_label(
                                    Color32::from_rgb(120, 140, 170),
                                    a.kind.label(),
                                ),
                                ActivityKind::Fill => ui.colored_label(
                                    Color32::from_rgb(70, 130, 220),
                                    a.kind.label(),
                                ),
                            };
                            ui.label(&a.market_id);
                            match a.side.as_str() {
                                "Buy" => ui.colored_label(Color32::from_rgb(0, 150, 0), "Buy"),
                                "Sell" => ui.colored_label(Color32::from_rgb(200, 40, 40), "Sell"),
                                other => ui.label(other),
                            };
                            ui.label(a.volume.to_string());
                            ui.monospace(disp(&a.price));
                            ui.label(&a.status);
                            ui.end_row();
                        }
                    });
            });
    }

    /// Modal-ish dialog for a working order: edit volume/price, then Revise or
    /// Pull (cancel). Mirrors the C++/Python demos' modify dialog.
    fn modify_dialog(&mut self, ctx: &egui::Context) {
        if !self.modify_open {
            return;
        }
        let mut open = true;
        let mut close = false;
        egui::Window::new("Modify Order")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
            .show(ctx, |ui| {
                ui.label(format!("Order {}", self.modify_unique_id));
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    ui.label("Volume");
                    ui.add(egui::DragValue::new(&mut self.modify_volume).range(1..=10000));
                });
                ui.horizontal(|ui| {
                    ui.label("Price");
                    ui.text_edit_singleline(&mut self.modify_price);
                });
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Revise").clicked() {
                        let limit_price = {
                            let t = self.modify_price.trim();
                            (!t.is_empty() && t.parse::<f64>().is_ok()).then(|| t.to_string())
                        };
                        self.send(Command::ReviseOrder {
                            account_id: self.modify_account_id.clone(),
                            market_id: self.modify_market_id.clone(),
                            unique_id: self.modify_unique_id.clone(),
                            volume: self.modify_volume,
                            limit_price,
                        });
                        close = true;
                    }
                    if ui
                        .button(egui::RichText::new("Pull").color(Color32::from_rgb(200, 40, 40)))
                        .clicked()
                    {
                        self.send(Command::CancelOrder {
                            account_id: self.modify_account_id.clone(),
                            market_id: self.modify_market_id.clone(),
                            unique_id: self.modify_unique_id.clone(),
                        });
                        close = true;
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
        // `open` goes false when the window's ✕ is clicked.
        self.modify_open = open && !close;
    }

    // -- Chart tab --------------------------------------------------------

    fn chart_tab(&mut self, ui: &mut egui::Ui, snap: &Snapshot) {
        ui.horizontal(|ui| {
            ui.label("Interval:");
            // (label, barInterval, barPeriod) — the backend already supports the
            // period multiplier, so 5m/15m are just Minute × 5 / × 15.
            for (label, interval, period) in [
                ("15s", "Second", 15),
                ("1m", "Minute", 1),
                ("5m", "Minute", 5),
                ("15m", "Minute", 15),
                ("1h", "Hour", 1),
                ("1D", "Day", 1),
            ] {
                // `Minute` appears three times, so match on interval *and* period.
                let selected = snap.chart_interval == interval && snap.chart_period == period;
                if ui.selectable_label(selected, label).clicked() && !selected {
                    self.send(Command::LoadChart {
                        bar_interval: interval.to_string(),
                        bar_period: period,
                    });
                }
            }
            ui.separator();
            // Candlestick vs. close-price line.
            ui.selectable_value(&mut self.chart_style, ChartStyle::Candles, "Candles");
            ui.selectable_value(&mut self.chart_style, ChartStyle::Line, "Line");
            ui.selectable_value(&mut self.chart_style, ChartStyle::HeikinAshi, "HA");
            ui.separator();
            // Overlays / panes.
            ui.toggle_value(&mut self.ma_fast_on, format!("MA{MA_FAST}"));
            ui.toggle_value(&mut self.ma_slow_on, format!("MA{MA_SLOW}"));
            ui.toggle_value(&mut self.ema_on, format!("EMA{EMA_PERIOD}"));
            ui.toggle_value(&mut self.vwap_on, "VWAP");
            ui.toggle_value(&mut self.boll_on, "Boll");
            ui.toggle_value(&mut self.show_volume, "Vol");
            ui.toggle_value(&mut self.rsi_on, "RSI");
            ui.toggle_value(&mut self.macd_on, "MACD");
            ui.separator();
            // Drawing tools. Switching tool clears any half-drawn trendline.
            ui.label("Draw:");
            for (mode, label) in [
                (DrawMode::Off, "None"),
                (DrawMode::HLine, "HLine"),
                (DrawMode::Trend, "Trend"),
            ] {
                if ui
                    .selectable_label(self.draw_mode == mode, label)
                    .clicked()
                {
                    self.draw_mode = mode;
                    self.pending_anchor = None;
                }
            }
            if ui.small_button("Clear").clicked() {
                if let Some(m) = &snap.market_id {
                    self.drawings.remove(m);
                }
                self.pending_anchor = None;
            }
            ui.separator();
            if ui.button("⟲ Latest").clicked() {
                self.chart_follow = true;
            }
            if snap.chart_loading {
                ui.spinner();
            }
            if snap.chart_loading_older {
                ui.spinner();
                ui.small("loading older…");
            }
            if snap.chart_no_more {
                ui.small("• start of history");
            }
            if let (Some(first), Some(last)) = (snap.candles.first(), snap.candles.last()) {
                let vol: i64 = snap.candles.iter().map(|c| c.volume as i64).sum();
                let iv = if snap.chart_period > 1 {
                    format!("{}×{}", snap.chart_period, snap.chart_interval)
                } else {
                    snap.chart_interval.clone()
                };
                ui.label(format!(
                    "{} · {} bars · vol {} · {} → {}",
                    iv,
                    snap.candles.len(),
                    vol,
                    fmt_ms(first.time_ms),
                    fmt_ms(last.time_ms),
                ));
            }
        });

        // Bars are drawn at `x_base + index` so prepending older history (which
        // decrements x_base) never shifts existing bars' coordinates.
        let x_base = snap.chart_x_base;
        let candles = &snap.candles;

        // Lazy-render: only build geometry for the bars in (last frame's)
        // viewport plus RENDER_MARGIN, so per-frame cost is bounded by what's on
        // screen rather than the full loaded history. Indicators get an extra
        // INDICATOR_WARMUP lead-in so their values match a full-history calc at
        // the left edge; egui_plot clips the off-screen warm-up out of the draw.
        let (gstart, gend) = visible_range(self.last_visible_x, candles.len(), x_base);
        let istart = gstart.saturating_sub(INDICATOR_WARMUP);

        // Heikin-Ashi is a running transform, so compute it from the warm-up
        // start; boxes then index it relative to `istart`.
        let heikin = self.chart_style == ChartStyle::HeikinAshi;
        let ha_candles: Vec<Candle> = if heikin {
            heikin_ashi(&candles[istart..gend])
        } else {
            Vec::new()
        };

        // Candlestick boxes over the visible slice: body spans open..close, wick
        // spans low..high.
        let elems: Vec<BoxElem> = (gstart..gend)
            .map(|g| {
                let c = if heikin { &ha_candles[g - istart] } else { &candles[g] };
                let up = c.close >= c.open;
                let (lo_box, hi_box) = if up { (c.open, c.close) } else { (c.close, c.open) };
                let color = if up { UP_COLOR } else { DOWN_COLOR };
                let spread = BoxSpread::new(c.low, lo_box, (c.open + c.close) / 2.0, hi_box, c.high);
                BoxElem::new((x_base + g as i64) as f64, spread)
                    .fill(color)
                    .stroke(egui::Stroke::new(1.5, color))
                    .whisker_width(0.15)
                    .box_width(0.8)
            })
            .collect();

        // Close-price polyline for Line mode (visible slice only).
        let line_pts: Vec<[f64; 2]> = (gstart..gend)
            .map(|g| [(x_base + g as i64) as f64, candles[g].close])
            .collect();

        // Indicators run over the warm-up + visible slice; the sub-slice base is
        // `x_base + istart` so their emitted x-coords stay globally aligned.
        let ind = &candles[istart..gend];
        let ind_base = x_base + istart as i64;

        // Optional moving-average overlays.
        let ma_fast_pts = self.ma_fast_on.then(|| sma(ind, ind_base, MA_FAST));
        let ma_slow_pts = self.ma_slow_on.then(|| sma(ind, ind_base, MA_SLOW));

        // Optional price-pane indicator overlays. VWAP is session-cumulative, so
        // it still sums from bar 0 but only emits points from `istart` on.
        let ema_pts = self.ema_on.then(|| ema(ind, ind_base, EMA_PERIOD));
        let vwap_pts = self.vwap_on.then(|| vwap(candles, x_base, istart));
        let boll = self
            .boll_on
            .then(|| bollinger(ind, ind_base, BOLL_PERIOD, BOLL_K));

        // Optional oscillator sub-panes.
        let rsi_pts = self.rsi_on.then(|| rsi(ind, ind_base, RSI_PERIOD));
        let macd_data = self
            .macd_on
            .then(|| macd(ind, ind_base, MACD_FAST, MACD_SLOW, MACD_SIGNAL));

        // Trade overlays for the active market: working-order price lines, the
        // position average line, and fill markers. Fill x-coords map a fill's
        // time to the nearest loaded bar.
        let market = snap.market_id.clone();
        let in_market = |m: &str| market.as_deref() == Some(m);
        let order_lines: Vec<(f64, bool)> = snap
            .orders
            .iter()
            .filter(|o| in_market(&o.market_id) && (o.status == "Working" || o.status == "Held"))
            .filter_map(|o| {
                // Prefer the limit price; fall back to the stop (trigger) price
                // so Stop / Stop-Limit orders still get a line.
                let txt = if o.limit_price.trim().is_empty() {
                    o.stop_price.trim()
                } else {
                    o.limit_price.trim()
                };
                Some((txt.parse::<f64>().ok()?, o.side == "Buy"))
            })
            .collect();
        let pos_line: Option<f64> = snap
            .positions
            .iter()
            .find(|p| in_market(&p.market_id) && p.net != 0 && p.avg_open_price != 0.0)
            .map(|p| p.avg_open_price);
        let map_x = |t: i64| -> Option<f64> {
            if candles.is_empty() {
                return None;
            }
            let idx = match candles.binary_search_by(|c| c.time_ms.cmp(&t)) {
                Ok(i) => i,
                Err(i) => i.min(candles.len() - 1),
            };
            Some((x_base + idx as i64) as f64)
        };
        let (mut fill_buy, mut fill_sell) = (Vec::<[f64; 2]>::new(), Vec::<[f64; 2]>::new());
        for a in &snap.activity {
            if a.kind != ActivityKind::Fill || !in_market(&a.market_id) {
                continue;
            }
            let (Some(x), Some(y)) = (map_x(a.time_ms), a.price.trim().parse::<f64>().ok()) else {
                continue;
            };
            if a.side == "Sell" {
                fill_sell.push([x, y]);
            } else {
                fill_buy.push([x, y]);
            }
        }

        // User drawings for the active market, resolved to plot geometry.
        let (mut draw_hlines, mut draw_trends) = (Vec::<f64>::new(), Vec::<[[f64; 2]; 2]>::new());
        if let Some(m) = market.as_ref() {
            for d in self.drawings.get(m).into_iter().flatten() {
                match d.anchors.as_slice() {
                    [(_, price)] => draw_hlines.push(*price),
                    [(t0, p0), (t1, p1), ..] => {
                        if let (Some(x0), Some(x1)) = (map_x(*t0), map_x(*t1)) {
                            draw_trends.push([[x0, *p0], [x1, *p1]]);
                        }
                    }
                    [] => {}
                }
            }
        }

        // Volume bars over the visible slice, tinted by candle direction.
        let vol_bars: Vec<Bar> = (gstart..gend)
            .map(|g| {
                let c = &candles[g];
                let up = c.close >= c.open;
                let color = if up { UP_COLOR } else { DOWN_COLOR };
                Bar::new((x_base + g as i64) as f64, c.volume as f64)
                    .width(0.8)
                    .fill(color.gamma_multiply(0.6))
                    .stroke(egui::Stroke::NONE)
            })
            .collect();

        // Lock (autolock) the view to the newest bars when a fresh dataset
        // arrives or the user asked to jump back to "Latest".
        let should_lock = !candles.is_empty()
            && (snap.chart_generation != self.last_locked_generation || self.chart_follow);
        let lock_bounds = should_lock.then(|| latest_bounds(candles, x_base));

        // Crosshair readout: OHLCV + time for the bar under the cursor, always
        // suffixed with the cursor's price. egui_plot draws the crosshair itself.
        let label_fmt = |_name: &str, p: &egui_plot::PlotPoint| -> String {
            let cursor = format!("@ {}", fmt_price(p.y));
            match candle_index(p.x, x_base, candles.len()) {
                Some(i) => {
                    let c = &candles[i];
                    format!(
                        "O {}  H {}\nL {}  C {}\nvol {}\n{}\n{cursor}",
                        fmt_price(c.open),
                        fmt_price(c.high),
                        fmt_price(c.low),
                        fmt_price(c.close),
                        c.volume,
                        fmt_ms(c.time_ms),
                    )
                }
                None => cursor,
            }
        };
        // Show the bar's time on the x-axis instead of its integer index.
        let x_fmt = |mark: egui_plot::GridMark, _range: &std::ops::RangeInclusive<f64>| -> String {
            match candle_index(mark.value, x_base, candles.len()) {
                Some(i) => fmt_ms(candles[i].time_ms),
                None => String::new(),
            }
        };
        // Price ticks on the y-axis, formatted like prices (not raw floats).
        let y_fmt = |mark: egui_plot::GridMark, _range: &std::ops::RangeInclusive<f64>| -> String {
            fmt_price(mark.value)
        };

        // Split the area: price on top, optional short panes (volume, RSI, MACD)
        // stacked below. Each shown pane takes a slice and a 6px gap.
        let total_h = ui.available_height();
        let gap = 6.0;
        let vol_h = if self.show_volume {
            (total_h * 0.22).clamp(60.0, 240.0)
        } else {
            0.0
        };
        let osc_h = |on: bool| if on { (total_h * 0.18).clamp(60.0, 160.0) } else { 0.0 };
        let rsi_h = osc_h(self.rsi_on);
        let macd_h = osc_h(self.macd_on);
        let n_panes = [self.show_volume, self.rsi_on, self.macd_on]
            .iter()
            .filter(|b| **b)
            .count();
        let price_h = (total_h - vol_h - rsi_h - macd_h - gap * n_panes as f32).max(80.0);

        let chart_style = self.chart_style;
        let draw_mode = self.draw_mode;
        // A click in the price pane while a drawing tool is active — captured
        // here and applied to `self.drawings` after the plot closure returns.
        let mut click_coord: Option<(f64, f64)> = None;
        let price_resp = Plot::new("price_chart")
            .height(price_h)
            .auto_bounds(egui::Vec2b::new(false, false))
            // Wheel pans by default; we take it over for zoom below instead.
            .allow_scroll(false)
            .link_axis("chart_x", true, false)
            .link_cursor("chart_x", true, false)
            // When the volume pane is shown it carries the shared time axis.
            .show_axes(egui::Vec2b::new(!self.show_volume, true))
            .label_formatter(label_fmt)
            .x_axis_formatter(x_fmt)
            .y_axis_formatter(y_fmt)
            .show(ui, |plot_ui| {
                match chart_style {
                    ChartStyle::Candles | ChartStyle::HeikinAshi => {
                        if !elems.is_empty() {
                            plot_ui.box_plot(BoxPlot::new(elems).name("OHLC"));
                        }
                    }
                    ChartStyle::Line => {
                        if !line_pts.is_empty() {
                            plot_ui.line(
                                Line::new(PlotPoints::new(line_pts))
                                    .color(Color32::from_rgb(0x42, 0xa5, 0xf5))
                                    .width(1.5)
                                    .name("Close"),
                            );
                        }
                    }
                }
                if let Some(pts) = ma_fast_pts {
                    plot_ui.line(
                        Line::new(PlotPoints::new(pts))
                            .color(Color32::from_rgb(0xff, 0xb3, 0x00))
                            .width(1.5)
                            .name(format!("MA{MA_FAST}")),
                    );
                }
                if let Some(pts) = ma_slow_pts {
                    plot_ui.line(
                        Line::new(PlotPoints::new(pts))
                            .color(Color32::from_rgb(0xab, 0x47, 0xbc))
                            .width(1.5)
                            .name(format!("MA{MA_SLOW}")),
                    );
                }
                if let Some(pts) = ema_pts {
                    plot_ui.line(
                        Line::new(PlotPoints::new(pts))
                            .color(Color32::from_rgb(0x00, 0xbc, 0xd4))
                            .width(1.5)
                            .name(format!("EMA{EMA_PERIOD}")),
                    );
                }
                if let Some(pts) = vwap_pts {
                    plot_ui.line(
                        Line::new(PlotPoints::new(pts))
                            .color(Color32::from_rgb(0xff, 0x70, 0x43))
                            .width(1.5)
                            .name("VWAP"),
                    );
                }
                if let Some((mid, up, lo)) = boll {
                    let band = Color32::from_rgb(0x90, 0xa4, 0xae);
                    plot_ui.line(
                        Line::new(PlotPoints::new(up)).color(band).width(1.0).name("Boll+"),
                    );
                    plot_ui.line(
                        Line::new(PlotPoints::new(mid))
                            .color(band.gamma_multiply(0.7))
                            .width(1.0)
                            .name("BollMid"),
                    );
                    plot_ui.line(
                        Line::new(PlotPoints::new(lo)).color(band).width(1.0).name("Boll-"),
                    );
                }
                // Working-order price lines (green Buy / red Sell), dashed.
                for (price, is_buy) in &order_lines {
                    let color = if *is_buy {
                        Color32::from_rgb(0, 150, 0)
                    } else {
                        Color32::from_rgb(200, 40, 40)
                    };
                    plot_ui.hline(
                        HLine::new(*price)
                            .color(color.gamma_multiply(0.9))
                            .width(1.0)
                            .style(LineStyle::dashed_dense()),
                    );
                }
                // Position average-price line.
                if let Some(p) = pos_line {
                    plot_ui.hline(
                        HLine::new(p)
                            .color(Color32::from_rgb(0x21, 0x96, 0xf3))
                            .width(1.5)
                            .name("Avg"),
                    );
                }
                // Own-fill markers.
                if !fill_buy.is_empty() {
                    plot_ui.points(
                        Points::new(fill_buy)
                            .color(Color32::from_rgb(0, 150, 0))
                            .radius(3.5)
                            .shape(MarkerShape::Circle)
                            .name("Buy fill"),
                    );
                }
                if !fill_sell.is_empty() {
                    plot_ui.points(
                        Points::new(fill_sell)
                            .color(Color32::from_rgb(200, 40, 40))
                            .radius(3.5)
                            .shape(MarkerShape::Circle)
                            .name("Sell fill"),
                    );
                }
                // User drawings (amber): horizontal lines and trendline segments.
                let draw_color = Color32::from_rgb(0xfd, 0xd8, 0x35);
                for price in &draw_hlines {
                    plot_ui.hline(HLine::new(*price).color(draw_color).width(1.2));
                }
                for seg in &draw_trends {
                    plot_ui.line(
                        Line::new(PlotPoints::new(seg.to_vec()))
                            .color(draw_color)
                            .width(1.5),
                    );
                }
                // Capture a click for the drawing tools (only when one is active,
                // so normal pan/zoom is untouched otherwise).
                if draw_mode != DrawMode::Off && plot_ui.response().clicked() {
                    if let Some(p) = plot_ui.pointer_coordinate() {
                        click_coord = Some((p.x, p.y));
                    }
                }
                if let Some(bounds) = lock_bounds {
                    plot_ui.set_plot_bounds(bounds);
                } else if plot_ui.response().hovered() {
                    // Mouse-wheel zoom, centered on the cursor. The volume pane
                    // follows via the shared "chart_x" axis link.
                    let scroll = plot_ui.ctx().input(|i| i.smooth_scroll_delta.y);
                    if scroll != 0.0 {
                        let factor = (scroll * ZOOM_SENSITIVITY).exp();
                        plot_ui.zoom_bounds_around_hovered(egui::Vec2::splat(factor));
                    }
                }
            });

        // The price plot's resolved bounds *after* this frame's pan/zoom. We
        // reuse its x-range for the volume pane (so both panes stay perfectly in
        // sync) and to decide when to lazy-load older history.
        let price_bounds = *price_resp.transform.bounds();
        let (visible_min_x, visible_max_x) = (price_bounds.min()[0], price_bounds.max()[0]);
        // Remember this frame's range so the next frame can slice geometry to the
        // viewport (see `visible_range`).
        self.last_visible_x = Some((visible_min_x, visible_max_x));

        // Apply a drawing-tool click: anchor on the nearest bar's time + price.
        if let (Some((x, y)), Some(m)) = (click_coord, market.clone()) {
            let t = candle_index(x, x_base, candles.len())
                .map(|i| candles[i].time_ms)
                .unwrap_or(0);
            match self.draw_mode {
                DrawMode::HLine => {
                    self.drawings.entry(m).or_default().push(Drawing {
                        anchors: vec![(t, y)],
                    });
                }
                DrawMode::Trend => {
                    if let Some(first) = self.pending_anchor.take() {
                        self.drawings.entry(m).or_default().push(Drawing {
                            anchors: vec![first, (t, y)],
                        });
                    } else {
                        self.pending_anchor = Some((t, y));
                    }
                }
                DrawMode::Off => {}
            }
        }

        // Volume pane: shares the price plot's x-range so panning/zooming keeps
        // the two in lockstep. We drive its bounds explicitly rather than letting
        // egui auto-fit: the y-axis is pinned at 0 (volume is never negative) and
        // its top is fitted to the tallest bar *currently visible*, so the bars
        // always fill the pane instead of being dwarfed by an off-screen spike.
        if self.show_volume {
            ui.add_space(gap);

            let max_vol = candles
                .iter()
                .enumerate()
                .filter(|(i, _)| {
                    let x = (x_base + *i as i64) as f64;
                    x >= visible_min_x && x <= visible_max_x
                })
                .map(|(_, c)| c.volume as f64)
                .fold(0.0_f64, f64::max);
            // 5% headroom above the tallest bar; fall back to a unit range when
            // nothing is visible (e.g. before the first bars load).
            let vol_top = if max_vol > 0.0 { max_vol * 1.05 } else { 1.0 };
            let vol_bounds =
                PlotBounds::from_min_max([visible_min_x, 0.0], [visible_max_x, vol_top]);

            Plot::new("volume_chart")
                .height(vol_h)
                .auto_bounds(egui::Vec2b::new(false, false))
                // Only the *time* axis is navigable here: horizontal drag/scroll
                // pans time and propagates to the price pane through the shared
                // "chart_x" link. The y-axis stays pinned (0-based, auto-fitted),
                // so vertical zoom/scroll is disabled.
                .allow_drag(egui::Vec2b::new(true, false))
                .allow_scroll(egui::Vec2b::new(true, false))
                .allow_zoom(false)
                .allow_boxed_zoom(false)
                .link_axis("chart_x", true, false)
                .link_cursor("chart_x", true, false)
                .x_axis_formatter(x_fmt)
                .show(ui, |plot_ui| {
                    if !vol_bars.is_empty() {
                        plot_ui.bar_chart(BarChart::new(vol_bars).name("Volume"));
                    }
                    // Applied before egui's own drag/scroll handling, so a
                    // horizontal pan this frame lands on top of these bounds.
                    plot_ui.set_plot_bounds(vol_bounds);
                });
        }

        // RSI sub-pane: pinned 0–100 with 30/70 guides, sharing the time axis.
        if let Some(pts) = rsi_pts {
            ui.add_space(gap);
            let rsi_bounds =
                PlotBounds::from_min_max([visible_min_x, 0.0], [visible_max_x, 100.0]);
            Plot::new("rsi_chart")
                .height(rsi_h)
                .auto_bounds(egui::Vec2b::new(false, false))
                .allow_drag(egui::Vec2b::new(true, false))
                .allow_scroll(egui::Vec2b::new(true, false))
                .allow_zoom(false)
                .allow_boxed_zoom(false)
                .link_axis("chart_x", true, false)
                .link_cursor("chart_x", true, false)
                .x_axis_formatter(x_fmt)
                .show(ui, |plot_ui| {
                    plot_ui.hline(HLine::new(70.0).color(Color32::from_gray(120)).width(0.8));
                    plot_ui.hline(HLine::new(30.0).color(Color32::from_gray(120)).width(0.8));
                    if !pts.is_empty() {
                        plot_ui.line(
                            Line::new(PlotPoints::new(pts))
                                .color(Color32::from_rgb(0x7e, 0x57, 0xc2))
                                .width(1.5)
                                .name(format!("RSI{RSI_PERIOD}")),
                        );
                    }
                    plot_ui.set_plot_bounds(rsi_bounds);
                });
        }

        // MACD sub-pane: histogram + MACD & signal lines around a zero line.
        if let Some((line, sig, hist)) = macd_data {
            ui.add_space(gap);
            let mut lo = f64::INFINITY;
            let mut hi = f64::NEG_INFINITY;
            for series in [&line, &sig, &hist] {
                for p in series.iter() {
                    if p[0] >= visible_min_x && p[0] <= visible_max_x {
                        lo = lo.min(p[1]);
                        hi = hi.max(p[1]);
                    }
                }
            }
            if !lo.is_finite() {
                lo = -1.0;
                hi = 1.0;
            }
            let pad = ((hi - lo) * 0.1).max(1e-9);
            let macd_bounds =
                PlotBounds::from_min_max([visible_min_x, lo - pad], [visible_max_x, hi + pad]);
            let hist_bars: Vec<Bar> = hist
                .iter()
                .map(|p| {
                    let color = if p[1] >= 0.0 { UP_COLOR } else { DOWN_COLOR };
                    Bar::new(p[0], p[1])
                        .width(0.8)
                        .fill(color.gamma_multiply(0.6))
                        .stroke(egui::Stroke::NONE)
                })
                .collect();
            Plot::new("macd_chart")
                .height(macd_h)
                .auto_bounds(egui::Vec2b::new(false, false))
                .allow_drag(egui::Vec2b::new(true, false))
                .allow_scroll(egui::Vec2b::new(true, false))
                .allow_zoom(false)
                .allow_boxed_zoom(false)
                .link_axis("chart_x", true, false)
                .link_cursor("chart_x", true, false)
                .x_axis_formatter(x_fmt)
                .show(ui, |plot_ui| {
                    if !hist_bars.is_empty() {
                        plot_ui.bar_chart(BarChart::new(hist_bars).name("Hist"));
                    }
                    plot_ui.hline(HLine::new(0.0).color(Color32::from_gray(120)).width(0.8));
                    plot_ui.line(
                        Line::new(PlotPoints::new(line))
                            .color(Color32::from_rgb(0x42, 0xa5, 0xf5))
                            .width(1.5)
                            .name("MACD"),
                    );
                    plot_ui.line(
                        Line::new(PlotPoints::new(sig))
                            .color(Color32::from_rgb(0xff, 0xb3, 0x00))
                            .width(1.5)
                            .name("Signal"),
                    );
                    plot_ui.set_plot_bounds(macd_bounds);
                });
        }

        if should_lock {
            self.last_locked_generation = snap.chart_generation;
            self.chart_follow = false;
            // Fresh dataset: drop the stale viewport so next frame's slice falls
            // back to the newly locked newest-bars window.
            self.last_visible_x = None;
        }

        // Lazy-load older history when the view nears the oldest loaded bar.
        if !snap.candles.is_empty()
            && !snap.chart_loading_older
            && !snap.chart_no_more
            && visible_min_x <= x_base as f64 + SCROLL_BUFFER
        {
            self.send(Command::LoadOlderChart);
        }
    }
}

/// A titled, bordered quadrant that fills its column.
fn panel(ui: &mut egui::Ui, title: &str, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::group(ui.style()).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.vertical(|ui| {
            ui.strong(title);
            ui.separator();
            add(ui);
        });
    });
}

/// The `[start, end)` candle indices to build geometry for this frame: the bars
/// covered by `last` (last frame's visible x-range, mapped back through `x_base`)
/// plus [`RENDER_MARGIN`] on each side. When `last` is `None` (first frame after
/// a fresh load), falls back to the newest [`CHART_VIEW_BARS`] window so the very
/// first paint already draws the locked view. `end` is exclusive.
fn visible_range(last: Option<(f64, f64)>, n: usize, x_base: i64) -> (usize, usize) {
    if n == 0 {
        return (0, 0);
    }
    match last {
        Some((lo_x, hi_x)) => {
            // Index of a bar at plot-x `x` is `x - x_base`.
            let lo = (lo_x.floor() as i64 - x_base - RENDER_MARGIN).max(0) as usize;
            let hi = (hi_x.ceil() as i64 - x_base + RENDER_MARGIN).max(0) as usize;
            (lo.min(n), (hi + 1).min(n))
        }
        None => (n.saturating_sub(CHART_VIEW_BARS), n),
    }
}

/// Plot bounds framing the newest [`CHART_VIEW_BARS`] candles, with a small
/// right margin and ~5% vertical padding. Bars sit at `x_base + index`, so the
/// x extent is offset by `x_base`. `candles` must be non-empty.
fn latest_bounds(candles: &[Candle], x_base: i64) -> PlotBounds {
    let n = candles.len();
    let start = n.saturating_sub(CHART_VIEW_BARS);
    let view = &candles[start..];
    let lo = view.iter().map(|c| c.low).fold(f64::INFINITY, f64::min);
    let hi = view.iter().map(|c| c.high).fold(f64::NEG_INFINITY, f64::max);
    let pad = ((hi - lo) * 0.05).max(1e-9);
    let x0 = (x_base + start as i64) as f64 - 0.5;
    let x1 = (x_base + n as i64) as f64 + 0.5; // one bar of breathing room right
    PlotBounds::from_min_max([x0, lo - pad], [x1, hi + pad])
}

/// Map a plot x-coordinate back to a candle index. Bars sit at `x_base + index`,
/// so this rounds to the nearest bar and bounds-checks it.
fn candle_index(x: f64, x_base: i64, len: usize) -> Option<usize> {
    let i = (x - x_base as f64).round();
    if i < 0.0 {
        return None;
    }
    let i = i as usize;
    (i < len).then_some(i)
}

/// Transform raw OHLC into Heikin-Ashi candles (same length, same `time_ms` and
/// `volume`). HA close is the bar's average price; HA open is the running mean of
/// the previous HA bar; HA high/low extend to include the HA open/close.
fn heikin_ashi(candles: &[Candle]) -> Vec<Candle> {
    let mut out: Vec<Candle> = Vec::with_capacity(candles.len());
    for (i, c) in candles.iter().enumerate() {
        let ha_close = (c.open + c.high + c.low + c.close) / 4.0;
        let ha_open = if i == 0 {
            (c.open + c.close) / 2.0
        } else {
            let p = &out[i - 1];
            (p.open + p.close) / 2.0
        };
        out.push(Candle {
            time_ms: c.time_ms,
            open: ha_open,
            high: c.high.max(ha_open).max(ha_close),
            low: c.low.min(ha_open).min(ha_close),
            close: ha_close,
            volume: c.volume,
        });
    }
    out
}

/// Simple moving average of closes as `[x, avg]` points at `x_base + index`, for
/// every index where a full `period`-bar window is available.
fn sma(candles: &[Candle], x_base: i64, period: usize) -> Vec<[f64; 2]> {
    if period == 0 || candles.len() < period {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(candles.len() - period + 1);
    let mut sum: f64 = candles[..period].iter().map(|c| c.close).sum();
    out.push([(x_base + (period - 1) as i64) as f64, sum / period as f64]);
    for i in period..candles.len() {
        sum += candles[i].close - candles[i - period].close;
        out.push([(x_base + i as i64) as f64, sum / period as f64]);
    }
    out
}

/// Exponentially-weighted moving average of a value series (seeded with the
/// first value, alpha = 2/(period+1)). Same length as `values`.
fn ema_series(values: &[f64], period: usize) -> Vec<f64> {
    if period == 0 || values.is_empty() {
        return Vec::new();
    }
    let alpha = 2.0 / (period as f64 + 1.0);
    let mut out = Vec::with_capacity(values.len());
    let mut prev = values[0];
    for (i, &v) in values.iter().enumerate() {
        prev = if i == 0 { v } else { alpha * v + (1.0 - alpha) * prev };
        out.push(prev);
    }
    out
}

/// EMA of closes as `[x, ema]` points at `x_base + index`.
fn ema(candles: &[Candle], x_base: i64, period: usize) -> Vec<[f64; 2]> {
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    ema_series(&closes, period)
        .into_iter()
        .enumerate()
        .map(|(i, v)| [(x_base + i as i64) as f64, v])
        .collect()
}

/// Cumulative session VWAP (typical price × volume) as `[x, vwap]` points. The
/// running sums must start at bar 0 to stay correct, but only points from index
/// `from` on are emitted (the visible slice), so the output stays viewport-sized.
fn vwap(candles: &[Candle], x_base: i64, from: usize) -> Vec<[f64; 2]> {
    let mut out = Vec::with_capacity(candles.len().saturating_sub(from));
    let (mut cum_pv, mut cum_v) = (0.0_f64, 0.0_f64);
    for (i, c) in candles.iter().enumerate() {
        let tp = (c.high + c.low + c.close) / 3.0;
        cum_pv += tp * c.volume as f64;
        cum_v += c.volume as f64;
        if i < from {
            continue;
        }
        let v = if cum_v > 0.0 { cum_pv / cum_v } else { tp };
        out.push([(x_base + i as i64) as f64, v]);
    }
    out
}

/// Bollinger bands over `period` closes: `(mid, upper, lower)` point series,
/// where mid = SMA and upper/lower = mid ± k·(population stddev).
#[allow(clippy::type_complexity)]
fn bollinger(
    candles: &[Candle],
    x_base: i64,
    period: usize,
    k: f64,
) -> (Vec<[f64; 2]>, Vec<[f64; 2]>, Vec<[f64; 2]>) {
    let (mut mid, mut up, mut lo) = (Vec::new(), Vec::new(), Vec::new());
    if period == 0 || candles.len() < period {
        return (mid, up, lo);
    }
    for i in (period - 1)..candles.len() {
        let win = &candles[i + 1 - period..=i];
        let mean = win.iter().map(|c| c.close).sum::<f64>() / period as f64;
        let var = win.iter().map(|c| (c.close - mean).powi(2)).sum::<f64>() / period as f64;
        let sd = var.sqrt();
        let x = (x_base + i as i64) as f64;
        mid.push([x, mean]);
        up.push([x, mean + k * sd]);
        lo.push([x, mean - k * sd]);
    }
    (mid, up, lo)
}

/// Wilder-smoothed RSI (0–100) over `period`, as `[x, rsi]` points.
fn rsi(candles: &[Candle], x_base: i64, period: usize) -> Vec<[f64; 2]> {
    let mut out = Vec::new();
    if period == 0 || candles.len() <= period {
        return out;
    }
    let (mut gain, mut loss) = (0.0_f64, 0.0_f64);
    for i in 1..=period {
        let d = candles[i].close - candles[i - 1].close;
        if d >= 0.0 {
            gain += d;
        } else {
            loss -= d;
        }
    }
    let mut avg_gain = gain / period as f64;
    let mut avg_loss = loss / period as f64;
    let point = |i: usize, ag: f64, al: f64| {
        let r = if al == 0.0 {
            100.0
        } else {
            100.0 - 100.0 / (1.0 + ag / al)
        };
        [(x_base + i as i64) as f64, r]
    };
    out.push(point(period, avg_gain, avg_loss));
    for i in (period + 1)..candles.len() {
        let d = candles[i].close - candles[i - 1].close;
        let (g, l) = if d >= 0.0 { (d, 0.0) } else { (0.0, -d) };
        avg_gain = (avg_gain * (period as f64 - 1.0) + g) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + l) / period as f64;
        out.push(point(i, avg_gain, avg_loss));
    }
    out
}

/// MACD: `(macd line, signal line, histogram)` point series aligned at
/// `x_base + index`. macd = EMA(fast) − EMA(slow); signal = EMA(macd, signal).
#[allow(clippy::type_complexity)]
fn macd(
    candles: &[Candle],
    x_base: i64,
    fast: usize,
    slow: usize,
    signal: usize,
) -> (Vec<[f64; 2]>, Vec<[f64; 2]>, Vec<[f64; 2]>) {
    if candles.is_empty() {
        return (Vec::new(), Vec::new(), Vec::new());
    }
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    let ef = ema_series(&closes, fast);
    let es = ema_series(&closes, slow);
    let macd_vals: Vec<f64> = ef.iter().zip(&es).map(|(a, b)| a - b).collect();
    let sig_vals = ema_series(&macd_vals, signal);
    let mut line = Vec::with_capacity(candles.len());
    let mut sig = Vec::with_capacity(candles.len());
    let mut hist = Vec::with_capacity(candles.len());
    for i in 0..candles.len() {
        let x = (x_base + i as i64) as f64;
        line.push([x, macd_vals[i]]);
        sig.push([x, sig_vals[i]]);
        hist.push([x, macd_vals[i] - sig_vals[i]]);
    }
    (line, sig, hist)
}

/// Format a price with up to 5 decimals, trimming trailing zeros.
fn fmt_price(v: f64) -> String {
    let s = format!("{v:.5}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Format a unix-ms timestamp as a short local-agnostic label.
fn fmt_ms(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.format("%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

/// Format a unix-ms timestamp as HH:MM:SS (for the activity feed).
fn fmt_hms(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "-".to_string())
}

/// Label for a contract row: "Description (ID)" or just the id/exchange.
fn contract_label(h: &ContractHit) -> String {
    if h.description.is_empty() {
        format!("{} · {}", h.exchange_id, h.contract_id)
    } else {
        format!("{} ({})", h.description, h.contract_id)
    }
}

/// Human-readable name for a strategy type (ported verbatim from the sibling
/// demos' `getStrategyDisplayName`); unknown types pass through unchanged.
fn strategy_display_name(strategy_type: &str) -> &str {
    match strategy_type {
        "None" => "Outright",
        "CalendarSpread" => "Calendar Spread",
        "RtCalendarSpread" => "RT Calendar Spread",
        "InterContractSpread" => "Inter Contract Spread",
        "Butterfly" => "Butterfly",
        "Condor" => "Condor",
        "DoubleButterfly" => "Double Butterfly",
        "Horizontal" => "Horizontal",
        "Bundle" => "Bundle",
        "MonthVsPack" => "Month vs Pack",
        "Pack" => "Pack",
        "PackSpread" => "Pack Spread",
        "PackButterfly" => "Pack Butterfly",
        "BundleSpread" => "Bundle Spread",
        "Strip" => "Strip",
        "Crack" => "Crack",
        "TreasurySpread" => "Treasury Spread",
        "Crush" => "Crush",
        "ThreeWay" => "Three Way",
        "ThreeWayStraddleVsCall" => "Three Way Straddle vs Call",
        "ThreeWayStraddleVsPut" => "Three Way Straddle vs Put",
        "Box" => "Box",
        "XmasTree" => "Christmas Tree",
        "ConditionalCurve" => "Conditional Curve",
        "Double" => "Double",
        "HorizontalStraddle" => "Horizontal Straddle",
        "IronCondor" => "Iron Condor",
        "Ratio1X2" => "Ratio 1x2",
        "Ratio1X3" => "Ratio 1x3",
        "Ratio2X3" => "Ratio 2x3",
        "RiskReversal" => "Risk Reversal",
        "StraddleStrip" => "Straddle Strip",
        "Straddle" => "Straddle",
        "Strangle" => "Strangle",
        "Vertical" => "Vertical",
        "JellyRoll" => "Jelly Roll",
        "IronButterfly" => "Iron Butterfly",
        "Guts" => "Guts",
        "Generic" => "Generic",
        "Diagonal" => "Diagonal",
        other => other,
    }
}

/// The market's current price for seeding the order form: last trade, else the
/// best bid, else the best offer. Empty when nothing has arrived yet.
fn current_price(q: &Quote) -> String {
    for p in [&q.last_price, &q.bid_price, &q.ask_price] {
        if !p.is_empty() {
            return p.clone();
        }
    }
    String::new()
}

/// Show a dash for empty price strings.
fn disp(s: &str) -> String {
    if s.is_empty() {
        "—".to_string()
    } else {
        s.to_string()
    }
}

// -- Market-data card styling (mirrors the C++ demo's colored cards) ---------

/// How long a Bid/Ask/Last card stays highlighted after its value changes.
const FLASH_SECS: f64 = 0.3;

const BID_BORDER: Color32 = Color32::from_rgb(0x4C, 0xAF, 0x50);
const BID_BG: Color32 = Color32::from_rgb(0xE8, 0xF5, 0xE9);
const BID_TEXT: Color32 = Color32::from_rgb(0x2E, 0x7D, 0x32);
const BID_FLASH: Color32 = Color32::from_rgb(0xCC, 0xFF, 0xCC);

const ASK_BORDER: Color32 = Color32::from_rgb(0xF4, 0x43, 0x36);
const ASK_BG: Color32 = Color32::from_rgb(0xFF, 0xEB, 0xEE);
const ASK_TEXT: Color32 = Color32::from_rgb(0xC6, 0x28, 0x28);
const ASK_FLASH: Color32 = Color32::from_rgb(0xFF, 0xCC, 0xCC);

const LAST_BORDER: Color32 = Color32::from_rgb(0x19, 0x76, 0xD2);
const LAST_BG: Color32 = Color32::from_rgb(0xE3, 0xF2, 0xFD);
const LAST_TEXT: Color32 = Color32::from_rgb(0x0D, 0x47, 0xA1);
const LAST_FLASH: Color32 = Color32::from_rgb(0xCC, 0xE5, 0xFF);

/// One big Bid/Ask/Last card: colored border, tinted (optionally flashing) fill,
/// large bold price with the volume beneath.
#[allow(clippy::too_many_arguments)]
fn quote_card(
    ui: &mut egui::Ui,
    title: &str,
    price: &str,
    volume: i32,
    border: Color32,
    fill: Color32,
    text: Color32,
) {
    egui::Frame::none()
        .fill(fill)
        .stroke(egui::Stroke::new(2.0, border))
        .rounding(egui::Rounding::same(4.0))
        .inner_margin(egui::Margin::same(6.0))
        .show(ui, |ui| {
            ui.set_min_height(90.0);
            ui.set_width(ui.available_width());
            ui.vertical_centered(|ui| {
                ui.label(egui::RichText::new(title).size(11.0).strong().color(text));
                ui.add_space(6.0);
                ui.label(egui::RichText::new(disp(price)).size(20.0).strong().color(text));
                ui.add_space(2.0);
                ui.label(egui::RichText::new(format!("×{volume}")).size(11.0).color(text));
            });
        });
}

/// Linearly interpolate between two colors (`t` clamped to 0..=1).
fn lerp_color(a: Color32, b: Color32, t: f32) -> Color32 {
    let t = t.clamp(0.0, 1.0);
    let mix = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
    Color32::from_rgb(mix(a.r(), b.r()), mix(a.g(), b.g()), mix(a.b(), b.b()))
}
