//! Aggregated chart reader (T4BinAggr — `/chart/barchart`).
//!
//! Port of `chart_data_stream_reader_aggr.{hpp,cpp}`, reshaped as an
//! [`Iterator`] yielding [`AggrRecord`] values instead of driving a callback
//! handler. SOF / market-switch / trade-date-switch records update internal
//! state and are not emitted; every other record produces one item.

use crate::byte_stream::{ByteReader, ByteSource, CountingReader};
use crate::chart_format_aggr::{tags, Bar, MarketDefinition};
use crate::decimal::Decimal;
use crate::encoding::{decode_7bit_int, decode_7bit_long, decode_decimal};
use crate::enums::MarketMode;
use crate::error::{DecodeError, Result};
use crate::message_reader::{
    decode_price, decode_price_n, read_7bit_datetime, read_boolean, read_integer, read_string,
};
use crate::n_date_time::NDateTime;
use crate::price::Price;

/// One decoded T4BinAggr record.
#[derive(Clone, Debug)]
pub enum AggrRecord {
    /// A market definition (also retained internally for bar price conversion).
    MarketDefinition(MarketDefinition),
    /// An aggregated OHLCV bar.
    Bar(Bar),
    /// A market-mode change.
    ModeChange {
        market_id: String,
        trade_date: NDateTime,
        time: NDateTime,
        mode: MarketMode,
    },
    /// A settlement (or held-settlement) price.
    Settlement {
        market_id: String,
        trade_date: NDateTime,
        time: NDateTime,
        price: Price,
        held: bool,
    },
    /// An open-interest update.
    OpenInterest {
        market_id: String,
        trade_date: NDateTime,
        time: NDateTime,
        open_interest: i32,
    },
}

/// Streaming decoder for the aggregated (T4BinAggr) format.
pub struct AggrReader<'a> {
    cin: CountingReader<ByteReader<'a>>,
    market: Option<MarketDefinition>,
    trade_date: NDateTime,
    market_id: String,
    done: bool,
}

impl<'a> AggrReader<'a> {
    /// Create a reader over an in-memory T4BinAggr buffer.
    pub fn new(data: &'a [u8]) -> Self {
        AggrReader {
            cin: CountingReader::new(ByteReader::new(data)),
            market: None,
            trade_date: NDateTime::from_ticks(0),
            market_id: String::new(),
            done: false,
        }
    }

    /// Read exactly one framed record, returning `None` for non-emitting ones
    /// (SOF / switches / unknown tags) and skipping any trailing record bytes.
    fn read_record(&mut self) -> Result<Option<AggrRecord>> {
        let length = decode_7bit_int(&mut self.cin)?;
        self.cin.reset_count();

        let mut out = None;
        if length > 0 {
            let tag = decode_7bit_int(&mut self.cin)?;
            out = self.dispatch(tag)?;
        }

        let n_read = self.cin.count();
        if length > 0 && n_read < length as usize {
            self.cin.skip(length as usize - n_read);
        }
        Ok(out)
    }

    fn dispatch(&mut self, tag: i32) -> Result<Option<AggrRecord>> {
        match tag {
            tags::SOF => {
                read_integer(&mut self.cin)?; // format version (unused)
                self.trade_date = NDateTime::from_ticks(0);
                self.market_id.clear();
                Ok(None)
            }
            tags::MARKET_DEFINITION => {
                let market_id = read_string(&mut self.cin)?;
                let numerator = decode_7bit_int(&mut self.cin)?;
                let denominator = decode_7bit_int(&mut self.cin)?;
                let price_code = read_string(&mut self.cin)?;
                let tick_value = decode_decimal(&mut self.cin)?;
                let vpt = read_string(&mut self.cin)?;
                let min_cab_price = decode_price_n(&mut self.cin)?;

                let market = MarketDefinition::new(
                    market_id,
                    numerator,
                    denominator,
                    price_code,
                    tick_value,
                    vpt,
                    min_cab_price,
                );
                self.market = Some(market.clone());
                Ok(Some(AggrRecord::MarketDefinition(market)))
            }
            tags::TRADEDATE_SWITCH => {
                self.trade_date = read_7bit_datetime(&mut self.cin)?;
                Ok(None)
            }
            tags::MARKET_SWITCH => {
                self.market_id = read_string(&mut self.cin)?;
                Ok(None)
            }
            tags::BAR_DELTA => {
                let time = read_7bit_datetime(&mut self.cin)?;
                let close_time =
                    NDateTime::from_ticks(time.ticks() + decode_7bit_long(&mut self.cin)?);

                let open_inc = decode_7bit_int(&mut self.cin)?;
                let high_inc = decode_7bit_int(&mut self.cin)?;
                let low_inc = decode_7bit_int(&mut self.cin)?;
                let close_inc = decode_7bit_int(&mut self.cin)?;

                let mut bar = Bar {
                    trade_date: self.trade_date,
                    time,
                    close_time,
                    market_id: self.market_id.clone(),
                    ..Default::default()
                };
                if let Some(market) = &self.market {
                    bar.open_price = Price::from_increments(
                        market,
                        &Decimal::from_i64(open_inc as i64 + low_inc as i64),
                    );
                    bar.high_price = Price::from_increments(
                        market,
                        &Decimal::from_i64(high_inc as i64 + low_inc as i64),
                    );
                    bar.low_price =
                        Price::from_increments(market, &Decimal::from_i64(low_inc as i64));
                    bar.close_price = Price::from_increments(
                        market,
                        &Decimal::from_i64(close_inc as i64 + low_inc as i64),
                    );
                }
                self.read_bar_volumes(&mut bar)?;
                Ok(Some(AggrRecord::Bar(bar)))
            }
            tags::BAR => {
                let time = read_7bit_datetime(&mut self.cin)?;
                let close_time =
                    NDateTime::from_ticks(time.ticks() + decode_7bit_long(&mut self.cin)?);

                let mut bar = Bar {
                    trade_date: self.trade_date,
                    time,
                    close_time,
                    market_id: self.market_id.clone(),
                    open_price: decode_price(&mut self.cin)?,
                    high_price: decode_price(&mut self.cin)?,
                    low_price: decode_price(&mut self.cin)?,
                    close_price: decode_price(&mut self.cin)?,
                    ..Default::default()
                };
                self.read_bar_volumes(&mut bar)?;
                Ok(Some(AggrRecord::Bar(bar)))
            }
            tags::MARKET_MODE => {
                let time = read_7bit_datetime(&mut self.cin)?;
                let mode = MarketMode::from_int(decode_7bit_int(&mut self.cin)?);
                Ok(Some(AggrRecord::ModeChange {
                    market_id: self.market_id.clone(),
                    trade_date: self.trade_date,
                    time,
                    mode,
                }))
            }
            tags::SETTLEMENT_PRICE => {
                let time = read_7bit_datetime(&mut self.cin)?;
                let price = decode_price(&mut self.cin)?;
                let held = read_boolean(&mut self.cin)?;
                Ok(Some(AggrRecord::Settlement {
                    market_id: self.market_id.clone(),
                    trade_date: self.trade_date,
                    time,
                    price,
                    held,
                }))
            }
            tags::OPEN_INTEREST => {
                let time = read_7bit_datetime(&mut self.cin)?;
                let open_interest = decode_7bit_int(&mut self.cin)?;
                Ok(Some(AggrRecord::OpenInterest {
                    market_id: self.market_id.clone(),
                    trade_date: self.trade_date,
                    time,
                    open_interest,
                }))
            }
            _ => Ok(None), // unknown tag: trailing bytes skipped by caller
        }
    }

    fn read_bar_volumes(&mut self, bar: &mut Bar) -> Result<()> {
        bar.volume = decode_7bit_int(&mut self.cin)?;
        bar.volume_at_bid = decode_7bit_int(&mut self.cin)?;
        bar.volume_at_offer = decode_7bit_int(&mut self.cin)?;
        bar.trades = decode_7bit_int(&mut self.cin)?;
        bar.trades_at_bid = decode_7bit_int(&mut self.cin)?;
        bar.trades_at_offer = decode_7bit_int(&mut self.cin)?;
        Ok(())
    }
}

impl Iterator for AggrReader<'_> {
    type Item = core::result::Result<AggrRecord, DecodeError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        while self.cin.available() > 0 {
            match self.read_record() {
                Ok(Some(rec)) => return Some(Ok(rec)),
                Ok(None) => continue,
                Err(e) => {
                    self.done = true;
                    return Some(Err(e));
                }
            }
        }
        None
    }
}
