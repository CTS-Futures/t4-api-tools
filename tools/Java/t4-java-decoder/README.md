# t4-java-decoder

A dependency-free Java library that decodes the T4 hand-rolled binary chart
formats — **T4Bin** (tick / trade-history) and **T4BinAggr** (aggregated OHLCV
bars). It is the Java sibling of the C++ (`tools/Cpp/t4-cpp-api`) and Rust
(`tools/Rust/t4-Rust-api`) decoder ports and is used by `JavaDemo` to decode the
`/chart/barchart` REST response.

## Provenance

Unlike the C++/Rust ports (which re-implement the format), Java is the **source of
truth**: these classes are extracted verbatim from `t4-java-api`
(`com.t4login.definitions.chartdata` and its supporting `datetime`,
`priceconversion`, `util`, `messages`, `connection` helpers), so decode results
stay in exact parity. The only trims:

- `com.t4login.messages.Message` is reduced to just its static binary **read**
  helpers (the original pulls in the whole message-type hierarchy).
- `com.cts.t4decoder.T4BinPayload` is **added** — it finds the T4Bin/T4BinAggr
  Start-Of-Frame marker inside a REST octet-stream response (port of the C++/Rust
  `extractT4BinPayload`).

Everything else keeps its original `com.t4login.*` package so no imports were
rewritten.

## Usage

```java
byte[] response = /* body of GET /chart/barchart (Accept: application/octet-stream) */;
byte[] payload  = com.cts.t4decoder.T4BinPayload.extract(response);

ChartDataStreamReaderAggr.read(payload, new ChartDataStreamReaderAggr.ChartDataHandler() {
    @Override public void onBar(ChartFormatAggr.Bar bar) {
        // bar.OpenPrice / HighPrice / LowPrice / ClosePrice (Price, scale-18 BigDecimal)
        // bar.Volume, bar.Time (NDateTime), ...
    }
    @Override public void onMarketDefinition(ChartFormatAggr.MarketDefinition md) { }
    @Override public void onModeChange(String id, NDateTime td, NDateTime t, MarketMode m) { }
    @Override public void onSettlement(String id, NDateTime td, NDateTime t, Price p, boolean held) { }
    @Override public void onOpenInterest(String id, NDateTime td, NDateTime t, int oi) { }
});
```

Tick / trade-history data is decoded with `ChartDataStreamReader` (`read()` loop +
`getState()` returning a mutable `ChartDataState`).

## Build & test

```
./gradlew build      # compile + run tests
./gradlew test       # golden-fixture parity test only
```

`AggrParityTest` decodes `src/test/resources/fixtures/sample.bin` and reproduces
`sample_expected.csv` field-for-field — the same fixture the C++/Rust ports assert
against.

> Targets Java 17 bytecode (via `--release 17`) even though the box only has a
> JDK 19, so no separate toolchain needs provisioning.
