//! T4BinAggr tags, the [`Bar`] data object, and [`MarketDefinition`].
//!
//! Port of `chart_format_aggr.hpp`.

use crate::big_int::BigInt;
use crate::decimal::Decimal;
use crate::market::MarketConversion;
use crate::n_date_time::NDateTime;
use crate::price::Price;
use crate::vpt::Vpt;

/// T4BinAggr record tag constants.
pub mod tags {
    pub const T4BINAGGR_VERSION: i32 = 1;
    pub const SOF: i32 = 1;
    pub const MARKET_DEFINITION: i32 = 2;
    pub const MARKET_SWITCH: i32 = 3;
    pub const TRADEDATE_SWITCH: i32 = 4;
    pub const BAR_DELTA: i32 = 10;
    pub const BAR: i32 = 11;
    pub const MARKET_MODE: i32 = 20;
    pub const OPEN_INTEREST: i32 = 21;
    pub const SETTLEMENT_PRICE: i32 = 22;
}

/// A single aggregated OHLCV bar. Field names match the reference sources.
#[derive(Clone, Debug, Default)]
pub struct Bar {
    pub trade_date: NDateTime,
    pub time: NDateTime,
    pub close_time: NDateTime,
    pub market_id: String,
    pub open_price: Price,
    pub high_price: Price,
    pub low_price: Price,
    pub close_price: Price,
    pub volume: i32,
    pub volume_at_bid: i32,
    pub volume_at_offer: i32,
    pub trades: i32,
    pub trades_at_bid: i32,
    pub trades_at_offer: i32,
}

/// Market parameters for price conversion (mirrors the Java inner class).
#[derive(Clone, Debug, Default)]
pub struct MarketDefinition {
    pub market_id: String,
    pub numerator: i32,
    pub denominator: i32,
    pub price_code: String,
    pub tick_value: Decimal,
    pub vpt_str: String,
    pub min_cab_price: Option<Price>,
    min_price_increment: Price,
    vpt: Option<Vpt>,
}

impl MarketDefinition {
    /// Build a market definition, eagerly computing the min price increment and
    /// (if the market publishes one) its VPT.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        market_id: String,
        numerator: i32,
        denominator: i32,
        price_code: String,
        tick_value: Decimal,
        vpt_str: String,
        min_cab_price: Option<Price>,
    ) -> Self {
        let min_price_increment = Price::new(Decimal::divide_int(
            &BigInt::from_i64(numerator as i64),
            denominator as u64,
            Price::SCALE,
        ));
        let vpt = if !vpt_str.is_empty() || min_cab_price.is_some() {
            Some(Vpt::new(vpt_str.clone()))
        } else {
            None
        };
        MarketDefinition {
            market_id,
            numerator,
            denominator,
            price_code,
            tick_value,
            vpt_str,
            min_cab_price,
            min_price_increment,
            vpt,
        }
    }
}

impl MarketConversion for MarketDefinition {
    fn denominator(&self) -> i64 {
        self.denominator as i64
    }

    fn min_price_increment(&self) -> Price {
        self.min_price_increment.clone()
    }

    fn vpt(&self) -> Option<&Vpt> {
        self.vpt.as_ref()
    }
}
