//! Golden-fixture parity: decode `tests/fixtures/sample.bin` with the aggregated
//! reader and reproduce `sample_expected.csv` field-for-field.
//!
//! Mirrors the C++ `test_aggr.cpp` parity harness (records grouped by type:
//! defs, bars, modes, settlements, open-interest).

use t4decoder::{AggrReader, AggrRecord};

const HEADER: &str = "type,market_id,trade_date,time,close_time,open,high,low,close,volume,\
volume_at_bid,volume_at_offer,trades,trades_at_bid,trades_at_offer,\
numerator,denominator,price_code,tick_value,vpt,min_cab_price,mode,\
settlement_price,held,open_interest";

/// A 25-column CSV row; unused fields stay empty (CSV_COLUMNS order).
#[derive(Default)]
struct Row {
    type_: String,
    market_id: String,
    trade_date: String,
    time: String,
    close_time: String,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
    volume_at_bid: String,
    volume_at_offer: String,
    trades: String,
    trades_at_bid: String,
    trades_at_offer: String,
    numerator: String,
    denominator: String,
    price_code: String,
    tick_value: String,
    vpt: String,
    min_cab_price: String,
    mode: String,
    settlement_price: String,
    held: String,
    open_interest: String,
}

impl Row {
    fn join(&self) -> String {
        [
            &self.type_,
            &self.market_id,
            &self.trade_date,
            &self.time,
            &self.close_time,
            &self.open,
            &self.high,
            &self.low,
            &self.close,
            &self.volume,
            &self.volume_at_bid,
            &self.volume_at_offer,
            &self.trades,
            &self.trades_at_bid,
            &self.trades_at_offer,
            &self.numerator,
            &self.denominator,
            &self.price_code,
            &self.tick_value,
            &self.vpt,
            &self.min_cab_price,
            &self.mode,
            &self.settlement_price,
            &self.held,
            &self.open_interest,
        ]
        .map(String::as_str)
        .join(",")
    }
}

#[test]
fn aggr_golden_fixture_parity() {
    let data = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/sample.bin"))
        .expect("read sample.bin");
    let expected =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/sample_expected.csv"))
            .expect("read sample_expected.csv");

    let (mut mds, mut bars, mut modes, mut settlements, mut ois) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());

    for rec in AggrReader::new(&data) {
        match rec.expect("decode error") {
            AggrRecord::MarketDefinition(m) => {
                mds.push(Row {
                    type_: "market_definition".into(),
                    market_id: m.market_id.clone(),
                    numerator: m.numerator.to_string(),
                    denominator: m.denominator.to_string(),
                    price_code: m.price_code.clone(),
                    tick_value: m.tick_value.to_string(),
                    vpt: m.vpt_str.clone(),
                    min_cab_price: m.min_cab_price.as_ref().map(|p| p.to_string()).unwrap_or_default(),
                    ..Default::default()
                });
            }
            AggrRecord::Bar(b) => {
                bars.push(Row {
                    type_: "bar".into(),
                    market_id: b.market_id.clone(),
                    trade_date: b.trade_date.to_millis_string(),
                    time: b.time.to_millis_string(),
                    close_time: b.close_time.to_millis_string(),
                    open: b.open_price.to_string(),
                    high: b.high_price.to_string(),
                    low: b.low_price.to_string(),
                    close: b.close_price.to_string(),
                    volume: b.volume.to_string(),
                    volume_at_bid: b.volume_at_bid.to_string(),
                    volume_at_offer: b.volume_at_offer.to_string(),
                    trades: b.trades.to_string(),
                    trades_at_bid: b.trades_at_bid.to_string(),
                    trades_at_offer: b.trades_at_offer.to_string(),
                    ..Default::default()
                });
            }
            AggrRecord::ModeChange { market_id, trade_date, time, mode } => {
                modes.push(Row {
                    type_: "mode_change".into(),
                    market_id,
                    trade_date: trade_date.to_millis_string(),
                    time: time.to_millis_string(),
                    mode: mode.as_int().to_string(),
                    ..Default::default()
                });
            }
            AggrRecord::Settlement { market_id, trade_date, time, price, held } => {
                settlements.push(Row {
                    type_: "settlement".into(),
                    market_id,
                    trade_date: trade_date.to_millis_string(),
                    time: time.to_millis_string(),
                    settlement_price: price.to_string(),
                    held: if held { "true".into() } else { "false".into() },
                    ..Default::default()
                });
            }
            AggrRecord::OpenInterest { market_id, trade_date, time, open_interest } => {
                ois.push(Row {
                    type_: "open_interest".into(),
                    market_id,
                    trade_date: trade_date.to_millis_string(),
                    time: time.to_millis_string(),
                    open_interest: open_interest.to_string(),
                    ..Default::default()
                });
            }
        }
    }

    let mut got = vec![HEADER.to_string()];
    for group in [&mds, &bars, &modes, &settlements, &ois] {
        got.extend(group.iter().map(Row::join));
    }

    let expected: Vec<&str> = expected.lines().map(|l| l.trim_end_matches('\r')).collect();
    assert_eq!(got.len(), expected.len(), "row count mismatch");
    for (i, (g, e)) in got.iter().zip(expected.iter()).enumerate() {
        assert_eq!(g, e, "line {i} mismatch\n   got: {g}\n   exp: {e}");
    }
}
