# t4decoder (Rust)

Dependency-free Rust port of the T4 chart-data decoder. Ports the canonical
Java original (`t4-java-api`, `com.t4login.*`), using the C++ port
(`tools/Cpp/t4-cpp-api`) as the structural guide and the JS/Python ports as
tie-breakers.

Decodes the two hand-rolled, tag-based binary formats (**not** protobuf):

- **T4Bin** — tick-level tradehistory (trades, quotes, TPO, settlement, RFQ, …)
- **T4BinAggr** — aggregated OHLCV barchart

The core library has **no external dependencies** — decimal/price math uses a
small built-in big integer. The HTTP `ChartClient` is the only piece that needs
a third-party crate (`ureq`) and is gated behind the `client` feature.

## API

Both readers are `Iterator`s yielding `Result` records:

```rust
use t4decoder::{AggrReader, AggrRecord, TickReader, ChartDataType, NDateTime};

// Aggregated barchart
for rec in AggrReader::new(bytes) {
    match rec? {
        AggrRecord::Bar(bar) => println!("{} O={}", bar.time, bar.open_price),
        _ => {}
    }
}

// Tick tradehistory — each event carries the change kind + a state snapshot
let reader = TickReader::new(bytes, NDateTime::from_ticks(0), "ESM25", ChartDataType::Tick);
for ev in reader {
    let ev = ev?;
    // ev.change, ev.state.last_trade_price, ...
}
```

With `--features client`:

```rust
use t4decoder::{ChartClient, BarchartParams};
let client = ChartClient::new(token)?;                 // default sim base URL
let bars = client.barchart(&BarchartParams {
    exchange_id: "CME".into(), contract_id: "ESM25".into(),
    trade_date_start: "2025-06-01".into(), trade_date_end: "2025-06-02".into(),
    ..Default::default()
})?;
```

## Build & test

Requires a Rust toolchain (this repo's dev box uses the **GNU** toolchain —
`stable-x86_64-pc-windows-gnu` — because no MSVC linker is installed; MSYS2
UCRT64 gcc/ld back it).

```sh
cargo build                                 # core, no deps
cargo test                                  # unit tests + golden-fixture parity
cargo test --features client                # + ChartClient
cargo clippy --all-targets --all-features
cargo run --example smoke -- aggr tests/fixtures/sample.bin   # -> CSV (== sample_expected.csv)
cargo run --example smoke -- tick <tradehistory.bin> [marketId]
```

The `aggr` smoke output reproduces `tests/fixtures/sample_expected.csv`
field-for-field, matching the C++/Python golden fixture.

> **Note:** On the dev box, CrowdStrike Falcon blocks execution of freshly built
> binaries, so `cargo test` / `cargo run` cannot run there — only `cargo build`
> / `cargo check` / `cargo clippy`. Run the test suite on a machine without that
> EDR policy (or after an IT exclusion for the target dir).

## Layout

```
src/
  byte_stream.rs   ByteReader + CountingReader (ByteSource trait)
  encoding.rs      7-bit int/long varint + 96-bit decimal codec
  big_int.rs       sign-magnitude base-1e9 big integer (no general long division)
  decimal.rs       exact base-10 decimal, HALF_EVEN
  price.rs         scale-18 price + MarketConversion-driven conversions
  n_date_time.rs   .NET ticks + calendar breakdown
  enums.rs         BidOffer / MarketMode / ChartDataChange / ChartDataType
  chart_format.rs  T4Bin tags + get_bar_start_time
  chart_data_state.rs   T4Bin decoded state
  chart_format_aggr.rs  T4BinAggr tags + Bar + MarketDefinition
  reader_aggr.rs   T4BinAggr Iterator (AggrReader / AggrRecord)
  reader_tick.rs   T4Bin Iterator (TickReader / TickEvent)
  payload.rs       locate the embedded SOF payload in an HTTP body
  client.rs        HTTP ChartClient (feature `client`)
tests/             parity + unit tests, fixtures/ (sample.bin, sample_expected.csv)
examples/smoke.rs  decode CLI
```

## Known limitations (match the reference ports)

- **VPT** (variable price tick) is a stub (`Vpt::is_valid() == false`); markets
  with a VPT spec fall back to `increments * min_price_increment`.
- `get_point_value` (dollar conversions) is not ported — not needed for decoding.
- The live HTTP GET against `api-sim.t4login.com` is unverified without a sim
  Bearer token; payload extraction + decoding are covered by the offline tests.
