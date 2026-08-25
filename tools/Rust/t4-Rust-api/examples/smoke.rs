//! Decode a T4 chart-data binary file and print it.
//!
//! ```text
//! cargo run --example smoke -- aggr <file.bin>            # barchart -> CSV
//! cargo run --example smoke -- tick <file.bin> [marketId] # tradehistory -> lines
//! ```
//!
//! The `aggr` mode reproduces the CSV schema of the fixtures, so it can
//! regenerate / diff against `sample_expected.csv`.

use std::process::ExitCode;

use t4decoder::{AggrReader, AggrRecord, ChartDataChange, ChartDataType, NDateTime, TickReader};

const HEADER: &str = "type,market_id,trade_date,time,close_time,open,high,low,close,volume,\
volume_at_bid,volume_at_offer,trades,trades_at_bid,trades_at_offer,\
numerator,denominator,price_code,tick_value,vpt,min_cab_price,mode,\
settlement_price,held,open_interest";

fn cols(fields: &[(usize, String)]) -> String {
    let mut row = vec![String::new(); 25];
    for (i, v) in fields {
        row[*i] = v.clone();
    }
    row.join(",")
}

fn ndt(dt: &NDateTime) -> String {
    dt.to_millis_string()
}

fn run_aggr(data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let (mut mds, mut bars, mut modes, mut settlements, mut ois) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for rec in AggrReader::new(data) {
        match rec? {
            AggrRecord::MarketDefinition(m) => mds.push(cols(&[
                (0, "market_definition".into()),
                (1, m.market_id),
                (15, m.numerator.to_string()),
                (16, m.denominator.to_string()),
                (17, m.price_code),
                (18, m.tick_value.to_string()),
                (19, m.vpt_str),
                (20, m.min_cab_price.map(|p| p.to_string()).unwrap_or_default()),
            ])),
            AggrRecord::Bar(b) => bars.push(cols(&[
                (0, "bar".into()),
                (1, b.market_id),
                (2, ndt(&b.trade_date)),
                (3, ndt(&b.time)),
                (4, ndt(&b.close_time)),
                (5, b.open_price.to_string()),
                (6, b.high_price.to_string()),
                (7, b.low_price.to_string()),
                (8, b.close_price.to_string()),
                (9, b.volume.to_string()),
                (10, b.volume_at_bid.to_string()),
                (11, b.volume_at_offer.to_string()),
                (12, b.trades.to_string()),
                (13, b.trades_at_bid.to_string()),
                (14, b.trades_at_offer.to_string()),
            ])),
            AggrRecord::ModeChange { market_id, trade_date, time, mode } => modes.push(cols(&[
                (0, "mode_change".into()),
                (1, market_id),
                (2, ndt(&trade_date)),
                (3, ndt(&time)),
                (21, mode.as_int().to_string()),
            ])),
            AggrRecord::Settlement { market_id, trade_date, time, price, held } => {
                settlements.push(cols(&[
                    (0, "settlement".into()),
                    (1, market_id),
                    (2, ndt(&trade_date)),
                    (3, ndt(&time)),
                    (22, price.to_string()),
                    (23, if held { "true".into() } else { "false".into() }),
                ]))
            }
            AggrRecord::OpenInterest { market_id, trade_date, time, open_interest } => {
                ois.push(cols(&[
                    (0, "open_interest".into()),
                    (1, market_id),
                    (2, ndt(&trade_date)),
                    (3, ndt(&time)),
                    (24, open_interest.to_string()),
                ]))
            }
        }
    }
    println!("{HEADER}");
    for group in [mds, bars, modes, settlements, ois] {
        for row in group {
            println!("{row}");
        }
    }
    Ok(())
}

fn run_tick(data: &[u8], market_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut recs = 0u64;
    for ev in TickReader::new(data, NDateTime::from_ticks(0), market_id, ChartDataType::Tick) {
        let s = ev?.state;
        match s.change {
            ChartDataChange::Trade => println!(
                "trade time_ticks={} price={} vol={}",
                s.last_time_ticks, s.last_trade_price, s.trade_volume
            ),
            ChartDataChange::Quote => println!(
                "quote bid={} offer={} bidvol={} offervol={}",
                s.bid_price, s.offer_price, s.bid_real_volume, s.offer_real_volume
            ),
            ChartDataChange::TradeBar => println!(
                "bar O={} H={} L={} C={} V={}",
                s.bar_open_price, s.bar_high_price, s.bar_low_price, s.bar_close_price, s.bar_volume
            ),
            ChartDataChange::MarketDefinition => println!(
                "market_definition {} num={} den={}",
                s.market_id, s.numerator, s.denominator
            ),
            _ => {}
        }
        recs += 1;
    }
    println!("({recs} records)");
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: smoke <aggr|tick> <file.bin> [marketId]");
        return ExitCode::from(2);
    }
    let data = match std::fs::read(&args[2]) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("error: cannot read {}: {e}", args[2]);
            return ExitCode::from(2);
        }
    };
    let result = match args[1].as_str() {
        "aggr" => run_aggr(&data),
        "tick" => run_tick(&data, args.get(3).map(String::as_str).unwrap_or("DEFAULT")),
        other => {
            eprintln!("unknown mode: {other} (expected aggr|tick)");
            return ExitCode::from(2);
        }
    };
    if let Err(e) = result {
        eprintln!("decode error: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
