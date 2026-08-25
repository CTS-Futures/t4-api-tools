//! Dependency-free Rust port of the T4 chart-data decoder.
//!
//! Ports the canonical Java original (`com.t4login.definitions.chartdata`,
//! at `t4-java-api`), using the tested C++ port (`tools/Cpp/t4-cpp-api`) as the
//! structural guide and the JS/Python ports as tie-breakers.
//!
//! Decodes the two hand-rolled, tag-based binary formats (NOT protobuf):
//!
//! - [`TickReader`] — **T4Bin**, tick-level tradehistory (trades, quotes, TPO,
//!   settlement, RFQ, …).
//! - [`AggrReader`] — **T4BinAggr**, aggregated OHLCV barchart.
//!
//! Both are exposed as [`Iterator`]s yielding `Result` records, replacing the
//! mutable-state / callback style of the reference ports.
//!
//! ```no_run
//! use t4decoder::{AggrReader, AggrRecord};
//! # fn demo(bytes: &[u8]) -> Result<(), t4decoder::DecodeError> {
//! for rec in AggrReader::new(bytes) {
//!     match rec? {
//!         AggrRecord::Bar(bar) => println!("{} O={}", bar.time, bar.open_price),
//!         _ => {}
//!     }
//! }
//! # Ok(()) }
//! ```

mod big_int;
mod byte_stream;
mod chart_data_state;
mod chart_format;
mod chart_format_aggr;
mod decimal;
mod encoding;
mod enums;
mod error;
mod market;
mod message_reader;
mod n_date_time;
mod payload;
mod price;
mod reader_aggr;
mod reader_tick;
mod vpt;

#[cfg(feature = "client")]
mod client;

pub use big_int::BigInt;
pub use byte_stream::{ByteReader, ByteSource, CountingReader};
pub use chart_data_state::ChartDataState;
pub use chart_format::{get_bar_start_time, tags as tick_tags, trade_flags};
pub use chart_format_aggr::{tags as aggr_tags, Bar, MarketDefinition};
pub use decimal::Decimal;
pub use encoding::{
    decode_7bit_int, decode_7bit_long, decode_decimal, encode_7bit_int, encode_7bit_long,
    encode_decimal,
};
pub use message_reader::{
    decode_price, decode_price_n, read_7bit_datetime, read_boolean, read_datetime, read_double,
    read_integer, read_long, read_price, read_short_string, read_string,
};
pub use enums::{BidOffer, ChartDataChange, ChartDataType, MarketMode};
pub use error::DecodeError;
pub use market::MarketConversion;
pub use n_date_time::NDateTime;
pub use payload::extract_t4bin_payload;
pub use price::Price;
pub use reader_aggr::{AggrReader, AggrRecord};
pub use reader_tick::{TickEvent, TickReader};
pub use vpt::Vpt;

#[cfg(feature = "client")]
pub use client::{BarchartParams, ChartClient, TradehistoryParams};
