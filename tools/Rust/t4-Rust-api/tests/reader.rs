//! Non-aggregated (T4Bin) reader test — port of the C++ `test_reader.cpp`.
//!
//! Builds a synthetic stream with the public encoders and checks the decoded
//! [`TickEvent`]s after SOF, market definition, a trade, and a quote.

use t4decoder::{
    encode_7bit_int, encode_7bit_long, ChartDataChange, ChartDataType, MarketConversion, NDateTime,
    TickReader,
};

fn append(b: &mut Vec<u8>, more: &[u8]) {
    b.extend_from_slice(more);
}

fn put_le(b: &mut Vec<u8>, v: u64, n: usize) {
    for i in 0..n {
        b.push(((v >> (8 * i)) & 0xFF) as u8);
    }
}

fn put_string7(b: &mut Vec<u8>, s: &str) {
    append(b, &encode_7bit_int(s.len() as i32));
    append(b, s.as_bytes());
}

/// Frame a record: enc7(length) + enc7(tag) + payload, length = tag+payload.
fn record(tag: i32, payload: &[u8]) -> Vec<u8> {
    let mut body = encode_7bit_int(tag);
    append(&mut body, payload);
    let mut out = encode_7bit_int(body.len() as i32);
    append(&mut out, &body);
    out
}

#[test]
fn t4bin_reader_trade_and_quote() {
    let trade_ticks = NDateTime::from_ymd_hms(2025, 6, 30, 0, 0, 0, 0).ticks();

    let mut stream = Vec::new();

    // SOF: version int32 + tradeDate (8-byte tick long). body length 13 (>12).
    {
        let mut p = Vec::new();
        put_le(&mut p, 1, 4); // version
        put_le(&mut p, trade_ticks as u64, 8); // trade date
        append(&mut stream, &record(1, &p)); // CTAG_SOF
    }
    // MARKET_DEFINITION: id, numerator, denominator, priceCode, tickValue(double)
    {
        let mut p = Vec::new();
        put_string7(&mut p, "ES");
        append(&mut p, &encode_7bit_int(1)); // numerator
        append(&mut p, &encode_7bit_int(4)); // denominator
        put_string7(&mut p, "0.25"); // priceCode
        put_le(&mut p, 12.5f64.to_bits(), 8); // tickValue
        append(&mut stream, &record(2, &p)); // CTAG_MARKET_DEFINITION
    }
    // TICKDATAPOINT_7BIT: timeDelta, volume, priceDelta(ticks), ttv, attr(AT_BID)
    {
        let mut p = Vec::new();
        append(&mut p, &encode_7bit_long(1000)); // time delta
        append(&mut p, &encode_7bit_int(10)); // volume
        append(&mut p, &encode_7bit_int(20001)); // price delta in ticks -> 5000.25
        append(&mut p, &encode_7bit_int(5)); // ttv
        append(&mut p, &encode_7bit_int(2)); // attr = TRADE_AT_BID
        append(&mut stream, &record(11, &p)); // CTAG_TICKDATAPOINT_7BIT
    }
    // QUOTE_7BIT: timeDelta, bidDelta, bidReal, bidImplied, offerDelta, offerReal, offerImplied
    {
        let mut p = Vec::new();
        append(&mut p, &encode_7bit_long(10)); // time delta
        append(&mut p, &encode_7bit_int(20000)); // bid delta -> 5000.00
        append(&mut p, &encode_7bit_int(7)); // bid real vol
        append(&mut p, &encode_7bit_int(0)); // bid implied
        append(&mut p, &encode_7bit_int(1)); // offer delta -> bid + 0.25
        append(&mut p, &encode_7bit_int(8)); // offer real vol
        append(&mut p, &encode_7bit_int(0)); // offer implied
        append(&mut stream, &record(50, &p)); // CTAG_QUOTE_7BIT
    }

    let mut reader = TickReader::new(&stream, NDateTime::from_ticks(0), "ES", ChartDataType::Tick);

    // 1) SOF -> TradeDate
    let ev = reader.next().unwrap().unwrap();
    assert_eq!(ev.change, ChartDataChange::TradeDate);
    assert_eq!(ev.state.trade_date.to_string(), "2025-06-30 00:00:00");

    // 2) MARKET_DEFINITION
    let ev = reader.next().unwrap().unwrap();
    assert_eq!(ev.change, ChartDataChange::MarketDefinition);
    assert!(ev.state.market_defined);
    assert_eq!(ev.state.numerator, 1);
    assert_eq!(ev.state.denominator, 4);
    assert_eq!(ev.state.price_code, "0.25");
    assert_eq!(ev.state.min_price_increment().to_string(), "0.250000000000000000");

    // 3) Trade
    let ev = reader.next().unwrap().unwrap();
    assert_eq!(ev.change, ChartDataChange::Trade);
    assert_eq!(ev.state.trade_volume, 10);
    assert_eq!(ev.state.last_ttv, 5);
    assert_eq!(ev.state.at_bid_or_offer, t4decoder::BidOffer::Bid);
    assert_eq!(ev.state.last_trade_price.to_string(), "5000.250000000000000000");

    // 4) Quote
    let ev = reader.next().unwrap().unwrap();
    assert_eq!(ev.change, ChartDataChange::Quote);
    assert_eq!(ev.state.bid_price.to_string(), "5000.000000000000000000");
    assert_eq!(ev.state.offer_price.to_string(), "5000.250000000000000000");
    assert_eq!(ev.state.bid_real_volume, 7);
    assert_eq!(ev.state.offer_real_volume, 8);

    // End of stream.
    assert!(reader.next().is_none());
}
