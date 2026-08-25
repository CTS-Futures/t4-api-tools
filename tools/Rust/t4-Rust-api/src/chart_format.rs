//! T4Bin (non-aggregated) record tags, trade-flag bits, and the bar-start-time
//! truncation helper.
//!
//! Port of `chart_format.{hpp,cpp}`. Values are copied verbatim from the Java
//! original as the canonical set.

use crate::enums::ChartDataType;
use crate::n_date_time::NDateTime;

/// Trade-flag bits (attribute byte on tick data points).
pub mod trade_flags {
    pub const NONE: i32 = 0;
    pub const DUE_TO_SPREAD: i32 = 1;
    pub const AT_BID: i32 = 2;
    pub const AT_OFFER: i32 = 4;
}

/// T4Bin record tag constants.
pub mod tags {
    pub const T4BIN_VERSION: i32 = 1;

    pub const SOF: i32 = 1;
    pub const MARKET_DEFINITION: i32 = 2;
    pub const CONSOLIDATED: i32 = 7;
    pub const MARKET_SWITCH: i32 = 8;
    pub const MARKET_KEY: i32 = 9;

    pub const TICKDATAPOINT_7BIT: i32 = 11;
    pub const TICKDATAPOINT_NEG_7BIT: i32 = 12;
    pub const TICKDATAPOINT_ALT_7BIT: i32 = 17;
    pub const TICKDATAPOINT_ALT_NEG_7BIT: i32 = 18;
    pub const TICKCHANGEDATAPOINT_7BIT: i32 = 14;
    pub const TICKCHANGEDATAPOINT_NEG_7BIT: i32 = 15;

    pub const BARDATAPOINT_7BIT_DELTA_LOW: i32 = 21;
    pub const BARDATAPOINT_NEG_7BIT_DELTA_LOW: i32 = 22;

    pub const TPO_START: i32 = 30;
    pub const TPO_START_NEGBASE: i32 = 31;
    pub const TPO_DATAPOINT: i32 = 32;
    pub const TPO_DATAPOINT_OPEN: i32 = 33;
    pub const TPO_DATAPOINT_CLOSE: i32 = 34;
    pub const TPO_DATAPOINT_OPENCLOSE: i32 = 35;

    pub const QUOTE_7BIT: i32 = 50;
    pub const QUOTE_NEG_7BIT: i32 = 51;
    pub const QUOTE_VOLUME_DELTA: i32 = 52;
    pub const QUOTE_PRICE: i32 = 53;
    pub const QUOTE_PRICE_DEC: i32 = 54;

    pub const TRADE_PRICE: i32 = 60;
    pub const TRADE_PRICE_DEC: i32 = 61;
    pub const TRADE_PRICE_ALT: i32 = 62;
    pub const TRADE_PRICE_DEC_ALT: i32 = 63;

    pub const BAR_PRICE: i32 = 65;
    pub const BAR_PRICE_DEC: i32 = 66;

    pub const MARKET_MODE: i32 = 100;
    pub const MARKET_SETTLEMENT: i32 = 101;
    pub const MARKET_HELD_SETTLEMENT: i32 = 102;
    pub const MARKET_CLEARED_VOLUME: i32 = 103;
    pub const MARKET_OPEN_INTEREST: i32 = 104;
    pub const MARKET_VWAP: i32 = 105;
    pub const MARKET_RFQ: i32 = 106;
    pub const SETTLEMENT_PRICE: i32 = 107;
    pub const HELD_SETTLEMENT_PRICE: i32 = 108;
    pub const VWAP_PRICE: i32 = 109;

    pub const PRICE_CHANGE: i32 = 140;
    pub const PRICE_CHANGE_DEC: i32 = 141;

    pub const TPO_START_PRICE: i32 = 190;
    pub const TPO_START_PRICE_DEC: i32 = 191;
    pub const TPO_PRICE: i32 = 192;
    pub const TPO_OPEN_PRICE: i32 = 193;
    pub const TPO_CLOSE_PRICE: i32 = 194;
    pub const TPO_OPENCLOSE_PRICE: i32 = 195;
}

/// Truncate a bar/time tick value to the start of its bar for the given
/// aggregation type. Returns `trade_date_ticks` for Day, the raw time otherwise.
pub fn get_bar_start_time(
    time_ticks: i64,
    trade_date_ticks: i64,
    data_type: ChartDataType,
) -> i64 {
    match data_type {
        ChartDataType::Second => {
            let t = NDateTime::from_ticks(time_ticks);
            NDateTime::from_ymd_hms(t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second(), 0)
                .ticks()
        }
        ChartDataType::Minute | ChartDataType::Tpo => {
            let t = NDateTime::from_ticks(time_ticks);
            NDateTime::from_ymd_hms(t.year(), t.month(), t.day(), t.hour(), t.minute(), 0, 0).ticks()
        }
        ChartDataType::Hour => {
            let t = NDateTime::from_ticks(time_ticks);
            NDateTime::from_ymd_hms(t.year(), t.month(), t.day(), t.hour(), 0, 0, 0).ticks()
        }
        ChartDataType::Day => trade_date_ticks,
        _ => time_ticks,
    }
}
