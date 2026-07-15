# JavaDemo

A Swing trading-terminal demo for the T4 v1 API — the Java sibling of `CPPDemo`
(Qt) and `RustDemo` (egui). It logs in over a WebSocket using protobuf, streams
live market data / account / orders, decodes chart bars with `t4-java-decoder`,
and supports order entry with TP/SL brackets.

## Architecture

- **Networking**: JDK built-ins only — `java.net.http.WebSocket` for the protobuf
  gateway and `java.net.http.HttpClient` for REST. No external WS/HTTP libraries.
- **Protobuf**: generated at build time from the repo-root `proto/` via the
  `com.google.protobuf` Gradle plugin. Some protos carry a UTF-8 BOM that `protoc`
  rejects, so a `stageProtos` task copies them into `build/proto-clean` with the
  BOM stripped and generation runs from there (same fix as RustDemo's `build.rs`).
- **Decoding**: the `/chart/barchart` REST response is the hand-rolled T4BinAggr
  binary, decoded via the reused `t4-java-decoder` (`includeBuild("../t4-java-decoder")`).
- **UI**: `MainWindow` (status + log console) hosts a **Trading** tab
  (`TradingPanel` — account/funds, quote, order entry, positions & orders tables)
  and a **Chart** tab (`ChartPanel` + custom-painted `CandleChartPanel`).
- **State**: a single lock-guarded `AppState`; background threads mutate it, the
  Swing EDT snapshots it on each change. Ported in spirit from
  `tools/Rust/RustDemo/src/{net,state}`.

## Configuration

Copy the sample config and fill in your T4 **simulator** credentials (register
free at <https://cts.sim.t4login.com/register>):

```bash
cd tools/Java/JavaDemo
cp config.sample.json config.json
```

```json
{
  "websocket": {
    "url": "wss://wss-sim.t4login.com/v1",
    "api": "https://api-sim.t4login.com",
    "firm": "YOUR_FIRM",
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD",
    "app_name": "YOUR_APP_NAME",
    "app_license": "YOUR_APP_LICENSE",
    "md_exchange_id": "CME_Eq",
    "md_contract_id": "ES",
    "priceFormat": 0
  }
}
```

`config.json` must sit in the `JavaDemo` directory you run from, and is
git-ignored — never commit real credentials. `md_exchange_id` / `md_contract_id`
choose the market subscribed at startup (defaults to `ES` on `CME_Eq`).

## How to run

### 1. Prerequisites

- A **JDK 17 or newer** (17–19 are tested; the reference box runs JDK 19). Check
  with `java -version`. The build targets Java 17 bytecode via `--release 17`, so
  17 is the floor.
- **No separate Gradle install** — use the bundled wrapper (`gradlew` /
  `gradlew.bat`), which pins **Gradle 8.0** and downloads it on first use.
- **No system `protoc`** — the `com.google.protobuf` Gradle plugin downloads a
  matching `protoc` (v3.25.3) itself.
- **Network access on the first build**: Gradle fetches its own distribution, the
  `protoc` binary, and the Maven Central dependencies (`protobuf-java`, `gson`,
  `flatlaf`). Later offline builds reuse the Gradle cache.
- The sibling decoder project **`../t4-java-decoder`** must be present — it's a
  composite build wired in via `includeBuild(...)` in `settings.gradle.kts`, and
  supplies the chart-bar decode. No separate install step; Gradle builds it too.

### 2. Configure

Create `config.json` as described in [Configuration](#configuration) above. Without
it the app fails to start (it needs credentials to log in).

### 3. Build & run

Run from the `JavaDemo` directory:

```powershell
# Windows (PowerShell)
cd tools/Java/JavaDemo
.\gradlew.bat run
```

```bash
# Git Bash / macOS / Linux
cd tools/Java/JavaDemo
./gradlew run
```

Useful variations:

```bash
./gradlew build      # compile + stage protos + generate protobuf + tests, no launch
./gradlew assemble   # compile/jar only, skip tests
./gradlew clean      # wipe build/ (forces a fresh proto-stage + generate)
```

The first invocation is slow (Gradle + `protoc` + dependency downloads, plus
building the `t4-java-decoder` composite); subsequent runs are fast.

### 4. In the app

On launch it connects, logs in, auto-subscribes the first account and the default
market (`CME_Eq`/`ES`), and auto-loads a Minute chart. Then:

- **Trading tab** — pick an account (funds update), watch bid/ask/last tick, place
  Market / Limit / Stop / Stop-Limit orders (optional TP/SL in $ → AUTO_OCO
  brackets), and cancel / flatten / reverse. Positions and orders update live, and
  the depth ladder supports click-to-trade.
- **Change market** — the **Contract** button opens a search/browse picker
  (exchange → contract); the **Expiry** button picks a specific expiry/strategy.
  Selecting one unsubscribes the old market, subscribes the new one, and reloads
  the chart.
- **Chart tab** — switch interval/period and chart type (Candles / OHLC / Line /
  Area / Heikin-Ashi), toggle indicators (MA / EMA / VWAP / Bollinger / RSI /
  MACD), draw trendlines / horizontal lines, and scroll back with the mouse wheel
  to page in older history; the in-progress bar updates live from trade ticks.
- Toggle the light/dark theme from the toolbar.
