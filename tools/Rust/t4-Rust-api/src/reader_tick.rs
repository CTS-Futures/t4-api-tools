//! Non-aggregated chart reader (T4Bin — `/chart/tradehistory`).
//!
//! Port of `chart_data_stream_reader.{hpp,cpp}`, reshaped as an [`Iterator`].
//! Each `next()` consumes one record and yields a [`TickEvent`] holding the
//! change kind plus a snapshot of the evolving [`ChartDataState`]. Mirrors the
//! Java/JS dispatch tag-for-tag, including the absolute-time threshold, the ALT
//! order-volume `abs()`, and multi-market state switching.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::byte_stream::{ByteReader, ByteSource, CountingReader};
use crate::chart_data_state::ChartDataState;
use crate::chart_format::{get_bar_start_time, tags, trade_flags};
use crate::encoding::{decode_7bit_int, decode_7bit_long, decode_decimal};
use crate::enums::{BidOffer, ChartDataChange, ChartDataType, MarketMode};
use crate::error::{DecodeError, Result};
use crate::message_reader::{read_datetime, read_double, read_integer, read_price, read_string};
use crate::n_date_time::NDateTime;
use crate::price::Price;

/// Any 7-bit "delta time" greater than this is an absolute tick value rather
/// than a delta (numerically ~ year 1900).
const ABSOLUTE_TIME_THRESHOLD: i64 = 599_266_080_000_000_000;

type StateRef = Rc<RefCell<ChartDataState>>;

/// One decoded T4Bin record: the change kind and the resulting state snapshot.
#[derive(Clone, Debug)]
pub struct TickEvent {
    /// What this record changed.
    pub change: ChartDataChange,
    /// A snapshot of the market state after applying the record.
    pub state: ChartDataState,
}

/// Streaming decoder for the non-aggregated (T4Bin) format.
pub struct TickReader<'a> {
    cin: CountingReader<ByteReader<'a>>,
    data_type: ChartDataType,
    state: StateRef,
    market_states: HashMap<String, StateRef>,
    market_keys: HashMap<i32, String>,
    is_consolidated: bool,
    bin_version: i32,
    done: bool,
}

/// `ticks > THRESHOLD` → absolute, else `base + ticks`.
fn get_incremental_time(base_ticks: i64, ticks: i64) -> i64 {
    if ticks > ABSOLUTE_TIME_THRESHOLD {
        ticks
    } else {
        base_ticks + ticks
    }
}

/// Ticks delta → price using the current market denominator/numerator.
fn ticks_to_price(s: &ChartDataState, ticks_delta: i64) -> Price {
    Price::from_ticks(s, ticks_delta * s.numerator as i64)
}

fn increment_time_ticks(s: &mut ChartDataState, ticks: i64) {
    s.last_time_ticks = get_incremental_time(s.last_time_ticks, ticks);
}

fn read_trade_attrs<S: ByteSource + ?Sized>(s: &mut ChartDataState, cin: &mut S) -> Result<()> {
    let attr = decode_7bit_int(cin)?;
    s.due_to_spread = attr & trade_flags::DUE_TO_SPREAD != 0;
    s.at_bid_or_offer = if attr & trade_flags::AT_BID != 0 {
        BidOffer::Bid
    } else if attr & trade_flags::AT_OFFER != 0 {
        BidOffer::Offer
    } else {
        BidOffer::Undefined
    };
    Ok(())
}

fn read_order_volumes<S: ByteSource + ?Sized>(s: &mut ChartDataState, cin: &mut S) -> Result<()> {
    let n = decode_7bit_int(cin)?;
    let mut out = Vec::with_capacity(n.max(0) as usize);
    for _ in 0..n {
        let v = decode_7bit_int(cin)?;
        out.push(v.abs()); // historical abs() fix from the Java source
    }
    s.order_volumes = out;
    Ok(())
}

fn read_bar_volumes<S: ByteSource + ?Sized>(s: &mut ChartDataState, cin: &mut S) -> Result<()> {
    s.bar_volume = decode_7bit_int(cin)?;
    s.bar_bid_volume = decode_7bit_int(cin)?;
    s.bar_offer_volume = decode_7bit_int(cin)?;
    s.bar_trades = decode_7bit_int(cin)?;
    s.bar_trades_at_bid = decode_7bit_int(cin)?;
    s.bar_trades_at_offer = decode_7bit_int(cin)?;
    Ok(())
}

fn read_tpo<S: ByteSource + ?Sized>(
    s: &mut ChartDataState,
    cin: &mut S,
    is_opening: bool,
    is_closing: bool,
) -> Result<()> {
    let d = decode_7bit_int(cin)?;
    let add = ticks_to_price(s, d as i64);
    s.tpo_price = Some(s.tpo_base_price.add(&add));
    s.tpo_volume = decode_7bit_int(cin)?;
    s.tpo_volume_at_bid = decode_7bit_int(cin)?;
    s.tpo_volume_at_offer = decode_7bit_int(cin)?;
    s.tpo_is_opening = is_opening;
    s.tpo_is_closing = is_closing;
    s.change = ChartDataChange::Tpo;
    Ok(())
}

fn read_tpo_price<S: ByteSource + ?Sized>(
    s: &mut ChartDataState,
    cin: &mut S,
    is_opening: bool,
    is_closing: bool,
) -> Result<()> {
    let d = decode_decimal(cin)?;
    let inc = s.last_tpo_base_price_increments.add(&d);
    s.tpo_price = Some(Price::from_increments(s, &inc));
    s.tpo_volume = decode_7bit_int(cin)?;
    s.tpo_volume_at_bid = decode_7bit_int(cin)?;
    s.tpo_volume_at_offer = decode_7bit_int(cin)?;
    s.tpo_is_opening = is_opening;
    s.tpo_is_closing = is_closing;
    s.change = ChartDataChange::Tpo;
    Ok(())
}

impl<'a> TickReader<'a> {
    /// Create a reader over an in-memory T4Bin buffer.
    pub fn new(
        data: &'a [u8],
        trade_date: NDateTime,
        market_id: impl Into<String>,
        data_type: ChartDataType,
    ) -> Self {
        let market_id = market_id.into();
        let mut r = TickReader {
            cin: CountingReader::new(ByteReader::new(data)),
            data_type,
            state: Rc::new(RefCell::new(ChartDataState::default())),
            market_states: HashMap::new(),
            market_keys: HashMap::new(),
            is_consolidated: false,
            bin_version: tags::T4BIN_VERSION,
            done: false,
        };
        r.get_market_state(&market_id);
        {
            let mut s = r.state.borrow_mut();
            s.trade_date = trade_date;
            s.trade_date_ticks = trade_date.ticks();
            s.market_id = market_id;
        }
        r
    }

    /// The binary format version seen in the SOF record.
    pub fn bin_version(&self) -> i32 {
        self.bin_version
    }

    fn read_frame(&mut self) -> Result<()> {
        let length = decode_7bit_int(&mut self.cin)?;
        self.cin.reset_count();

        if length > 0 {
            let tag = decode_7bit_int(&mut self.cin)?;
            self.dispatch(tag, length)?;
        }

        let n_read = self.cin.count();
        if length > 0 && n_read < length as usize {
            self.cin.skip(length as usize - n_read);
        }
        Ok(())
    }

    fn dispatch(&mut self, tag: i32, length: i32) -> Result<()> {
        match tag {
            tags::CONSOLIDATED => {
                self.is_consolidated = true;
            }

            tags::SOF => {
                if length > 12 {
                    self.bin_version = read_integer(&mut self.cin)?;
                } else {
                    self.bin_version = 0;
                }
                let trade_date = read_datetime(&mut self.cin)?;
                let market_id = self.state.borrow().market_id.clone();
                let ns = ChartDataState {
                    market_id: market_id.clone(),
                    trade_date,
                    trade_date_ticks: trade_date.ticks(),
                    change: ChartDataChange::TradeDate,
                    ..Default::default()
                };
                let rc = Rc::new(RefCell::new(ns));
                self.market_states.clear();
                self.market_states.insert(market_id, Rc::clone(&rc));
                self.state = rc;
            }

            tags::MARKET_KEY => {
                let mkt_key = decode_7bit_int(&mut self.cin)?;
                let mkt_id = read_string(&mut self.cin)?;
                self.market_keys.insert(mkt_key, mkt_id.clone());
                self.get_market_state(&mkt_id);
                self.state.borrow_mut().change = ChartDataChange::None;
            }

            tags::MARKET_SWITCH => {
                let mkt_key = decode_7bit_int(&mut self.cin)?;
                let mkt_id = self.market_keys.get(&mkt_key).cloned().unwrap_or_default();
                self.get_market_state(&mkt_id);
                self.state.borrow_mut().change = ChartDataChange::MarketSwitch;
            }

            tags::MARKET_DEFINITION => {
                let mkt_id = read_string(&mut self.cin)?;
                self.get_market_state(&mkt_id);
                let st_rc = Rc::clone(&self.state);
                let mut st = st_rc.borrow_mut();
                st.market_defined = true;
                st.numerator = decode_7bit_int(&mut self.cin)?;
                st.denominator = decode_7bit_int(&mut self.cin)?;
                st.price_code = read_string(&mut self.cin)?;
                st.tick_value = read_double(&mut self.cin)?;
                if self.cin.count() < length as usize {
                    st.vpt_spec = read_string(&mut self.cin)?;
                    st.min_cab_price = read_price(&mut self.cin)?;
                }
                st.change = ChartDataChange::MarketDefinition;
            }

            // ---------------- Tick / trade ----------------
            tags::TICKDATAPOINT_7BIT => self.trade_ticks(false, false)?,
            tags::TICKDATAPOINT_NEG_7BIT => self.trade_ticks(true, false)?,
            tags::TICKDATAPOINT_ALT_7BIT => self.trade_ticks(false, true)?,
            tags::TICKDATAPOINT_ALT_NEG_7BIT => self.trade_ticks(true, true)?,
            tags::TRADE_PRICE => self.trade_price_inc(false)?,
            tags::TRADE_PRICE_ALT => self.trade_price_inc(true)?,
            tags::TRADE_PRICE_DEC => self.trade_price_dec(false)?,
            tags::TRADE_PRICE_DEC_ALT => self.trade_price_dec(true)?,

            // ---------------- Tick-change ----------------
            tags::TICKCHANGEDATAPOINT_7BIT => self.tick_change(false)?,
            tags::TICKCHANGEDATAPOINT_NEG_7BIT => self.tick_change(true)?,
            tags::PRICE_CHANGE => self.price_change()?,
            tags::PRICE_CHANGE_DEC => self.price_change_dec()?,

            // ---------------- Bar ----------------
            tags::BARDATAPOINT_7BIT_DELTA_LOW => self.bar_delta_low(false)?,
            tags::BARDATAPOINT_NEG_7BIT_DELTA_LOW => self.bar_delta_low(true)?,
            tags::BAR_PRICE => self.bar_price()?,
            tags::BAR_PRICE_DEC => self.bar_price_dec()?,

            // ---------------- TPO ----------------
            tags::TPO_START => self.tpo_start(false)?,
            tags::TPO_START_NEGBASE => self.tpo_start(true)?,
            tags::TPO_START_PRICE => self.tpo_start_price_inc()?,
            tags::TPO_START_PRICE_DEC => self.tpo_start_price_dec()?,
            tags::TPO_DATAPOINT => self.with_state(|s, cin| read_tpo(s, cin, false, false))?,
            tags::TPO_PRICE => self.with_state(|s, cin| read_tpo_price(s, cin, false, false))?,
            tags::TPO_DATAPOINT_OPEN => self.with_state(|s, cin| read_tpo(s, cin, true, false))?,
            tags::TPO_OPEN_PRICE => self.with_state(|s, cin| read_tpo_price(s, cin, true, false))?,
            tags::TPO_DATAPOINT_CLOSE => self.with_state(|s, cin| read_tpo(s, cin, false, true))?,
            tags::TPO_CLOSE_PRICE => self.with_state(|s, cin| read_tpo_price(s, cin, false, true))?,
            tags::TPO_DATAPOINT_OPENCLOSE => {
                self.with_state(|s, cin| read_tpo(s, cin, true, true))?
            }
            tags::TPO_OPENCLOSE_PRICE => {
                self.with_state(|s, cin| read_tpo_price(s, cin, true, true))?
            }

            // ---------------- Quotes ----------------
            tags::QUOTE_7BIT => self.quote_ticks(false)?,
            tags::QUOTE_NEG_7BIT => self.quote_ticks(true)?,
            tags::QUOTE_PRICE => self.quote_price_inc()?,
            tags::QUOTE_PRICE_DEC => self.quote_price_dec()?,
            tags::QUOTE_VOLUME_DELTA => self.quote_volume_delta()?,

            // ---------------- Mode / settlement / OI / VWAP / RFQ ----------------
            tags::MARKET_MODE => self.market_mode()?,
            tags::MARKET_SETTLEMENT => self.settlement_ticks(false)?,
            tags::SETTLEMENT_PRICE => self.settlement_inc(false)?,
            tags::MARKET_HELD_SETTLEMENT => self.settlement_ticks(true)?,
            tags::HELD_SETTLEMENT_PRICE => self.settlement_inc(true)?,
            tags::MARKET_CLEARED_VOLUME => self.cleared_volume()?,
            tags::MARKET_OPEN_INTEREST => self.open_interest()?,
            tags::MARKET_VWAP => self.vwap_ticks()?,
            tags::VWAP_PRICE => self.vwap_inc()?,
            tags::MARKET_RFQ => self.rfq()?,

            _ => {
                self.state.borrow_mut().change = ChartDataChange::None;
            }
        }
        Ok(())
    }

    /// Borrow the current state and run `f(state, cin)`.
    fn with_state<F>(&mut self, f: F) -> Result<()>
    where
        F: FnOnce(&mut ChartDataState, &mut CountingReader<ByteReader<'a>>) -> Result<()>,
    {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        f(&mut s, &mut self.cin)
    }

    // ----- trade -----

    fn trade_ticks(&mut self, negative: bool, alt: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.trade_volume = decode_7bit_int(&mut self.cin)?;
        let pd = decode_7bit_int(&mut self.cin)?;
        let delta = ticks_to_price(&s, pd as i64);
        s.last_trade_price = if negative {
            s.last_trade_price.subtract(&delta)
        } else {
            s.last_trade_price.add(&delta)
        };
        let ttv = decode_7bit_int(&mut self.cin)?;
        s.last_ttv += ttv as i64;
        read_trade_attrs(&mut s, &mut self.cin)?;
        if alt {
            read_order_volumes(&mut s, &mut self.cin)?;
        } else {
            s.order_volumes.clear();
        }
        s.change = ChartDataChange::Trade;
        Ok(())
    }

    fn trade_price_inc(&mut self, alt: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.trade_volume = decode_7bit_int(&mut self.cin)?;
        let d = decode_decimal(&mut self.cin)?;
        s.last_price_increments = s.last_price_increments.add(&d);
        let inc = s.last_price_increments.clone();
        s.last_trade_price = Price::from_increments(&*s, &inc);
        let ttv = decode_7bit_int(&mut self.cin)?;
        s.last_ttv += ttv as i64;
        read_trade_attrs(&mut s, &mut self.cin)?;
        if alt {
            read_order_volumes(&mut s, &mut self.cin)?;
        } else {
            s.order_volumes.clear();
        }
        s.change = ChartDataChange::Trade;
        Ok(())
    }

    fn trade_price_dec(&mut self, alt: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.trade_volume = decode_7bit_int(&mut self.cin)?;
        let d = decode_decimal(&mut self.cin)?;
        s.last_trade_price = Price::from_increments(&*s, &d);
        let ttv = decode_7bit_int(&mut self.cin)?;
        s.last_ttv += ttv as i64;
        read_trade_attrs(&mut s, &mut self.cin)?;
        if alt {
            read_order_volumes(&mut s, &mut self.cin)?;
        } else {
            s.order_volumes.clear();
        }
        s.change = ChartDataChange::Trade;
        Ok(())
    }

    // ----- tick change -----

    fn tick_change(&mut self, negative: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let d1 = decode_7bit_long(&mut self.cin)?;
        s.bar_start_time = get_incremental_time(s.bar_close_time, d1);
        let d2 = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = s.bar_start_time + d2;
        let pd = decode_7bit_int(&mut self.cin)?;
        let delta = ticks_to_price(&s, pd as i64);
        s.bar_close_price = if negative {
            s.bar_close_price.subtract(&delta)
        } else {
            s.bar_close_price.add(&delta)
        };
        read_bar_volumes(&mut s, &mut self.cin)?;
        s.change = ChartDataChange::TickChange;
        Ok(())
    }

    fn price_change(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let d1 = decode_7bit_long(&mut self.cin)?;
        s.bar_start_time = get_incremental_time(s.bar_close_time, d1);
        let d2 = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = s.bar_start_time + d2;
        let d = decode_decimal(&mut self.cin)?;
        s.bar_close_price = s.bar_close_price.add_decimal(&d);
        read_bar_volumes(&mut s, &mut self.cin)?;
        s.change = ChartDataChange::TickChange;
        Ok(())
    }

    fn price_change_dec(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let d1 = decode_7bit_long(&mut self.cin)?;
        s.bar_start_time = get_incremental_time(s.bar_close_time, d1);
        let d2 = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = s.bar_start_time + d2;
        let d = decode_decimal(&mut self.cin)?;
        s.bar_close_price = Price::new(d);
        read_bar_volumes(&mut s, &mut self.cin)?;
        s.change = ChartDataChange::TickChange;
        Ok(())
    }

    // ----- bar -----

    fn bar_delta_low(&mut self, negative: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = get_incremental_time(s.bar_close_time, dt);
        s.bar_start_time = get_bar_start_time(s.bar_close_time, s.trade_date_ticks, self.data_type);
        let od = decode_7bit_int(&mut self.cin)?;
        let bar_open = ticks_to_price(&s, od as i64);
        let hd = decode_7bit_int(&mut self.cin)?;
        let bar_high = ticks_to_price(&s, hd as i64);
        let ld = decode_7bit_int(&mut self.cin)?;
        let low_delta = ticks_to_price(&s, ld as i64);
        s.bar_low_price = if negative {
            s.bar_low_price.subtract(&low_delta)
        } else {
            s.bar_low_price.add(&low_delta)
        };
        let cd = decode_7bit_int(&mut self.cin)?;
        let bar_close = ticks_to_price(&s, cd as i64);
        s.bar_volume = decode_7bit_int(&mut self.cin)?;
        s.bar_open_price = bar_open.add(&s.bar_low_price);
        s.bar_high_price = bar_high.add(&s.bar_low_price);
        s.bar_close_price = bar_close.add(&s.bar_low_price);
        s.bar_bid_volume = decode_7bit_int(&mut self.cin)?;
        s.bar_offer_volume = decode_7bit_int(&mut self.cin)?;
        s.bar_trades = decode_7bit_int(&mut self.cin)?;
        s.bar_trades_at_bid = decode_7bit_int(&mut self.cin)?;
        s.bar_trades_at_offer = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::TradeBar;
        Ok(())
    }

    fn bar_price(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = get_incremental_time(s.bar_close_time, dt);
        s.bar_start_time = get_bar_start_time(s.bar_close_time, s.trade_date_ticks, self.data_type);
        let open_inc = decode_decimal(&mut self.cin)?;
        let high_inc = decode_decimal(&mut self.cin)?;
        let ld = decode_decimal(&mut self.cin)?;
        let low_inc = s.last_bar_low_price_increments.add(&ld);
        s.last_bar_low_price_increments = low_inc.clone();
        let close_inc = decode_decimal(&mut self.cin)?;
        s.bar_open_price = Price::from_increments(&*s, &open_inc.add(&low_inc));
        s.bar_high_price = Price::from_increments(&*s, &high_inc.add(&low_inc));
        s.bar_low_price = Price::from_increments(&*s, &low_inc);
        s.bar_close_price = Price::from_increments(&*s, &close_inc.add(&low_inc));
        read_bar_volumes(&mut s, &mut self.cin)?;
        s.change = ChartDataChange::TradeBar;
        Ok(())
    }

    fn bar_price_dec(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.bar_close_time = get_incremental_time(s.bar_close_time, dt);
        s.bar_start_time = get_bar_start_time(s.bar_close_time, s.trade_date_ticks, self.data_type);
        let open_inc = decode_decimal(&mut self.cin)?;
        let high_inc = decode_decimal(&mut self.cin)?;
        let low_inc = decode_decimal(&mut self.cin)?;
        let close_inc = decode_decimal(&mut self.cin)?;
        s.bar_open_price = Price::from_increments(&*s, &open_inc);
        s.bar_high_price = Price::from_increments(&*s, &high_inc);
        s.bar_low_price = Price::from_increments(&*s, &low_inc);
        s.bar_close_price = Price::from_increments(&*s, &close_inc);
        read_bar_volumes(&mut s, &mut self.cin)?;
        s.change = ChartDataChange::TradeBar;
        Ok(())
    }

    // ----- TPO start -----

    fn tpo_start(&mut self, negative: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.tpo_start_time = get_incremental_time(s.tpo_start_time, dt);
        let pd = decode_7bit_int(&mut self.cin)?;
        let delta = ticks_to_price(&s, pd as i64);
        s.tpo_base_price = if negative {
            s.tpo_base_price.subtract(&delta)
        } else {
            s.tpo_base_price.add(&delta)
        };
        s.change = ChartDataChange::None;
        Ok(())
    }

    fn tpo_start_price_inc(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.tpo_start_time = get_incremental_time(s.tpo_start_time, dt);
        let d = decode_decimal(&mut self.cin)?;
        s.last_tpo_base_price_increments = s.last_tpo_base_price_increments.add(&d);
        let inc = s.last_tpo_base_price_increments.clone();
        s.tpo_base_price = Price::from_increments(&*s, &inc);
        s.change = ChartDataChange::None;
        Ok(())
    }

    fn tpo_start_price_dec(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        s.tpo_start_time = get_incremental_time(s.tpo_start_time, dt);
        let d = decode_decimal(&mut self.cin)?;
        s.tpo_base_price = Price::from_increments(&*s, &d);
        s.change = ChartDataChange::None;
        Ok(())
    }

    // ----- quotes -----

    fn quote_ticks(&mut self, negative: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let bd = decode_7bit_int(&mut self.cin)?;
        let bid_delta = ticks_to_price(&s, bd as i64);
        s.bid_price = if negative {
            s.bid_price.subtract(&bid_delta)
        } else {
            s.bid_price.add(&bid_delta)
        };
        s.bid_real_volume = decode_7bit_int(&mut self.cin)?;
        s.bid_implied_volume = decode_7bit_int(&mut self.cin)?;
        let od = decode_7bit_int(&mut self.cin)?;
        let offer_delta = ticks_to_price(&s, od as i64);
        s.offer_price = s.bid_price.add(&offer_delta);
        s.offer_real_volume = decode_7bit_int(&mut self.cin)?;
        s.offer_implied_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::Quote;
        Ok(())
    }

    fn quote_price_inc(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let d = decode_decimal(&mut self.cin)?;
        s.last_bid_price_increments = s.last_bid_price_increments.add(&d);
        let inc = s.last_bid_price_increments.clone();
        s.bid_price = Price::from_increments(&*s, &inc);
        s.bid_real_volume = decode_7bit_int(&mut self.cin)?;
        s.bid_implied_volume = decode_7bit_int(&mut self.cin)?;
        let od = decode_7bit_int(&mut self.cin)?;
        let offer_delta = ticks_to_price(&s, od as i64);
        s.offer_price = s.bid_price.add(&offer_delta);
        s.offer_real_volume = decode_7bit_int(&mut self.cin)?;
        s.offer_implied_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::Quote;
        Ok(())
    }

    fn quote_price_dec(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let d = decode_decimal(&mut self.cin)?;
        s.bid_price = Price::from_increments(&*s, &d);
        s.bid_real_volume = decode_7bit_int(&mut self.cin)?;
        s.bid_implied_volume = decode_7bit_int(&mut self.cin)?;
        let od = decode_7bit_int(&mut self.cin)?;
        let offer_delta = ticks_to_price(&s, od as i64);
        s.offer_price = s.bid_price.add(&offer_delta);
        s.offer_real_volume = decode_7bit_int(&mut self.cin)?;
        s.offer_implied_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::Quote;
        Ok(())
    }

    fn quote_volume_delta(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.bid_real_volume = decode_7bit_int(&mut self.cin)?;
        s.offer_real_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::Quote;
        Ok(())
    }

    // ----- mode / settlement / OI / VWAP / RFQ -----

    fn market_mode(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.mode = MarketMode::from_int(decode_7bit_int(&mut self.cin)?);
        s.change = ChartDataChange::MarketMode;
        Ok(())
    }

    fn settlement_ticks(&mut self, held: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let pd = decode_7bit_int(&mut self.cin)?;
        let price = ticks_to_price(&s, pd as i64);
        if held {
            s.settlement_held_price = Some(price);
            s.change = ChartDataChange::HeldSettlement;
        } else {
            s.settlement_price = Some(price);
            s.change = ChartDataChange::Settlement;
        }
        Ok(())
    }

    fn settlement_inc(&mut self, held: bool) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let d = decode_decimal(&mut self.cin)?;
        let price = Price::from_increments(&*s, &d);
        if held {
            s.settlement_held_price = Some(price);
            s.change = ChartDataChange::HeldSettlement;
        } else {
            s.settlement_price = Some(price);
            s.change = ChartDataChange::Settlement;
        }
        Ok(())
    }

    fn cleared_volume(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.cleared_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::ClearedVolume;
        Ok(())
    }

    fn open_interest(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        s.open_interest = decode_7bit_int(&mut self.cin)? as i64;
        s.change = ChartDataChange::OpenInterest;
        Ok(())
    }

    fn vwap_ticks(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let price_ticks = decode_7bit_int(&mut self.cin)? as i64;
        if s.market_defined {
            s.vwap_price = Some(Price::from_ticks(&*s, price_ticks));
            s.change = ChartDataChange::Vwap;
        }
        Ok(())
    }

    fn vwap_inc(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let d = decode_decimal(&mut self.cin)?;
        if s.market_defined {
            s.vwap_price = Some(Price::from_increments(&*s, &d));
            s.change = ChartDataChange::Vwap;
        }
        Ok(())
    }

    fn rfq(&mut self) -> Result<()> {
        let st_rc = Rc::clone(&self.state);
        let mut s = st_rc.borrow_mut();
        let dt = decode_7bit_long(&mut self.cin)?;
        increment_time_ticks(&mut s, dt);
        let attr = decode_7bit_int(&mut self.cin)?;
        s.rfq_buy_sell = if attr & trade_flags::AT_BID != 0 {
            BidOffer::Bid
        } else if attr & trade_flags::AT_OFFER != 0 {
            BidOffer::Offer
        } else {
            BidOffer::Undefined
        };
        s.rfq_volume = decode_7bit_int(&mut self.cin)?;
        s.change = ChartDataChange::Rfq;
        Ok(())
    }

    /// Resolve / create / alias the state for `market_id` and make it current.
    fn get_market_state(&mut self, market_id: &str) {
        if let Some(st) = self.market_states.get(market_id) {
            self.state = Rc::clone(st);
            return;
        }
        let empty = self.market_states.get("").cloned();
        match empty {
            Some(empty_rc) if !self.is_consolidated => {
                self.market_states
                    .insert(market_id.to_string(), Rc::clone(&empty_rc));
                self.state = empty_rc;
            }
            None => {
                let ns = ChartDataState {
                    market_id: market_id.to_string(),
                    ..Default::default()
                };
                let rc = Rc::new(RefCell::new(ns));
                self.market_states
                    .insert(market_id.to_string(), Rc::clone(&rc));
                self.state = rc;
            }
            Some(empty_rc) => {
                empty_rc.borrow_mut().market_id = market_id.to_string();
                self.market_states
                    .insert(market_id.to_string(), Rc::clone(&empty_rc));
                self.state = empty_rc;
            }
        }
    }
}

impl Iterator for TickReader<'_> {
    type Item = core::result::Result<TickEvent, DecodeError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.cin.available() == 0 {
            return None;
        }
        match self.read_frame() {
            Ok(()) => {
                let snap = self.state.borrow().clone();
                Some(Ok(TickEvent {
                    change: snap.change,
                    state: snap,
                }))
            }
            Err(e) => {
                self.done = true;
                Some(Err(e))
            }
        }
    }
}
