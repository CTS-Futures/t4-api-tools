//! The market-conversion contract used for price conversion.
//!
//! Port of `i_market_conversion.hpp`. A market context (a
//! [`ChartDataState`](crate::ChartDataState) or
//! [`MarketDefinition`](crate::MarketDefinition)) exposes this so
//! [`Price::from_ticks`](crate::Price::from_ticks) / `from_increments` can
//! convert ticks and increments.

use crate::price::Price;
use crate::vpt::Vpt;

/// What a market must expose to drive price conversion.
pub trait MarketConversion {
    /// The price denominator.
    fn denominator(&self) -> i64;
    /// The minimum price increment (scale-18 price).
    fn min_price_increment(&self) -> Price;
    /// The market's VPT, if any (`None` when it has none).
    fn vpt(&self) -> Option<&Vpt>;
}
