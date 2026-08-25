//! Mutable state populated by the non-aggregated (T4Bin) reader.
//!
//! Port of `chart_data_state.hpp`. Also implements
//! [`MarketConversion`](crate::MarketConversion) so it can drive
//! `Price::from_ticks` / `from_increments`.

use crate::big_int::BigInt;
use crate::decimal::Decimal;
use crate::enums::{BidOffer, ChartDataChange, MarketMode};
use crate::market::MarketConversion;
use crate::n_date_time::NDateTime;
use crate::price::Price;
use crate::vpt::Vpt;

/// The evolving decoded state after each T4Bin record.
#[derive(Clone, Debug, Default)]
pub struct ChartDataState {
    /// What the last record changed.
    pub change: ChartDataChange,

    // Trade date
    pub trade_date: NDateTime,
    pub trade_date_ticks: i64,

    // Market definition
    pub market_defined: bool,
    pub market_id: String,
    pub numerator: i32,
    pub denominator: i32,
    pub price_code: String,
    pub tick_value: f64,
    pub vpt_spec: String,
    pub min_cab_price: Option<Price>,

    // Last trade
    pub last_ttv: i64,
    pub last_time_ticks: i64,
    pub last_trade_price: Price,
    pub last_price_increments: Decimal,

    pub trade_volume: i32,
    pub at_bid_or_offer: BidOffer,
    pub order_volumes: Vec<i32>,
    pub due_to_spread: bool,

    // Bar
    pub bar_start_time: i64,
    pub bar_close_time: i64,
    pub bar_open_price: Price,
    pub bar_high_price: Price,
    pub bar_low_price: Price,
    pub bar_close_price: Price,
    pub bar_volume: i32,
    pub bar_bid_volume: i32,
    pub bar_offer_volume: i32,
    pub bar_trades: i32,
    pub bar_trades_at_bid: i32,
    pub bar_trades_at_offer: i32,

    // TPO
    pub tpo_start_time: i64,
    pub tpo_base_price: Price,
    pub tpo_price: Option<Price>,
    pub tpo_volume: i32,
    pub tpo_volume_at_bid: i32,
    pub tpo_volume_at_offer: i32,
    pub tpo_is_opening: bool,
    pub tpo_is_closing: bool,

    // Quote
    pub bid_price: Price,
    pub bid_real_volume: i32,
    pub bid_implied_volume: i32,
    pub offer_price: Price,
    pub offer_real_volume: i32,
    pub offer_implied_volume: i32,

    // Market mode / settlement / OI / VWAP
    pub mode: MarketMode,
    pub settlement_price: Option<Price>,
    pub settlement_held_price: Option<Price>,
    pub cleared_volume: i32,
    pub open_interest: i64,
    pub vwap_price: Option<Price>,

    // RFQ
    pub rfq_buy_sell: BidOffer,
    pub rfq_volume: i32,

    // Incremental state
    pub last_bar_low_price_increments: Decimal,
    pub last_tpo_base_price_increments: Decimal,
    pub last_bid_price_increments: Decimal,
}

impl MarketConversion for ChartDataState {
    fn denominator(&self) -> i64 {
        self.denominator as i64
    }

    fn min_price_increment(&self) -> Price {
        if self.denominator == 0 {
            return Price::default();
        }
        Price::new(Decimal::divide_int(
            &BigInt::from_i64(self.numerator as i64),
            self.denominator as u64,
            Price::SCALE,
        ))
    }

    fn vpt(&self) -> Option<&Vpt> {
        None
    }
}
