# T4 Rust Demo

A native desktop demo of the T4 API in Rust, built with [egui](https://github.com/emilk/egui).
It mirrors the C++/Python/JavaScript demos: it logs in over WebSocket, streams
live market data, fetches & plots OHLCV charts, and submits/cancels orders.

## Features

- **WebSocket login** with token refresh and 20s heartbeat.
- **Market depth** subscription (best bid / offer / last trade) for the configured
  product (defaults to `ES` on `CME_Eq`).
- **Account** subscription — positions, working orders, and **funds (balance /
  margin / available)** update live.
- **Order entry** — Buy/Sell in **Market / Limit / Stop / Stop-Limit**, with a
  **time-in-force** selector (Day / GTC / IOC / FOK), an optional **trailing stop**,
  and **TP/SL bracket** legs submitted as an AUTO_OCO group. Includes quantity
  presets and an optional pre-submit **confirmation dialog**.
- **Order & position management** — revise/cancel a working order, **cancel-all**,
  and one-click **flatten** / **reverse** of a net position.
- **Orders & Fills blotter** — each order shows its current live state (superseded
  as it fills; a finished order leaves just its fill rows), interleaved with own
  executions; the header flashes on a new fill.
- **Charts** — auto-loads `/chart/barchart` once the market resolves, decodes the
  binary T4BinAggr payload with the sibling [`t4decoder`](../t4-Rust-api) crate, and
  renders **candles / line / Heikin-Ashi** with a volume pane, older-history paging,
  live-tick folding, and a crosshair OHLC + price readout. The view **autolocks to
  the newest bars on load** (a "Latest" button re-snaps after you pan/zoom away).
  - **Indicators** — MA(20/50), EMA, VWAP and Bollinger overlays, plus **RSI** and
    **MACD** in linked sub-panes.
  - **Trade overlays** — working-order price lines, the position average line, and
    buy/sell fill markers for the active market.
  - **Drawing tools** — horizontal lines and trendlines, time-anchored per market.

## Layout

Mirrors the C++ demo: a top connection/account bar (with the live funds readout) and a
**Trading** / **Chart** tab selector. The Trading tab is a 2×2 grid (Market Data · Order
Entry · Positions · Orders) above a full-width **Orders & Fills** blotter; the Chart tab
holds the interval / style / indicator / drawing-tool controls and the plot with its
volume, RSI and MACD panes. The log is pinned to the bottom.

## Architecture

The egui UI runs on the main thread; a background tokio runtime owns the network
client. They share `AppState` behind a mutex and communicate UI actions over an
mpsc `Command` channel.

| File | Responsibility |
|------|----------------|
| `src/main.rs`   | Loads config, spawns the tokio net thread, launches eframe. |
| `src/config.rs` | `config.json` (serde). |
| `src/proto.rs`  | Re-nests the generated prost modules; `ClientMessage` helper. |
| `src/state.rs`  | `AppState`, `Command`, and the shared handle. |
| `src/net/mod.rs`| WebSocket session: login, heartbeat, subscribes, orders, dispatch. |
| `src/net/rest.rs`| REST: market resolution + chart fetch/decode. |
| `src/app.rs`    | egui UI: top bar + Trading/Chart tabs, 2×2 trading grid, autolocking chart, log. |
| `build.rs`      | Compiles the shared protos with `protox` + `prost-build` (no external `protoc`). |

Protos are compiled from the canonical tree at `../../../proto` — nothing is vendored.

## Configuration

```bash
cp config.sample.json config.json
```

Then fill in your simulation credentials:

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

`config.json` is git-ignored.

## How to run

### 1. Prerequisites

- A **Rust toolchain** (`rustup` / `cargo`). No external `protoc` is needed — the protos are
  compiled by a pure-Rust pipeline in `build.rs`. No OpenSSL either — TLS uses the platform
  provider (SChannel on Windows via `native-tls`).
- The sibling decoder crate **`../t4-Rust-api`** must be present (it's a path dependency; the
  chart decode lives there).
- **Windows only:** this crate builds with the MSYS2 `windows-gnu` (**ucrt64**) toolchain, so
  its linker must be reachable. Install MSYS2, then put `C:\msys64\ucrt64\bin` on `PATH` for
  the shell you build from:
  ```powershell
  $env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"
  ```

### 2. Configure

Copy the sample and fill in your T4 **simulation** credentials (see the
[Configuration](#configuration) section above for the full field list):

```bash
cd tools/Rust/RustDemo
cp config.sample.json config.json
```

`config.json` must sit in the directory you run from, and is git-ignored. Without it the GUI
still launches but shows a load error.

### 3. Build & run

```bash
# from this crate's directory (it's a standalone crate, not a workspace member)
cd tools/Rust/RustDemo
cargo run           # debug build + launch
# or:
cargo run --release # optimized build
```

Useful checks without launching:

```bash
cargo check     # fast type/borrow check
cargo clippy    # lints
cargo build     # compile + link the binary
```

### 4. In the app

On launch it connects, logs in, and subscribes automatically. Then:

- Pick an **account** from the top-bar dropdown; watch the quote and the funds readout update.
- **Change market** — the **Contract** button opens a search/browse picker (exchange →
  contract); the **Expiry** button picks a specific expiry/strategy. Selecting one
  unsubscribes the old market, subscribes the new one, and reloads the chart.
- **Trading tab** — submit Market / Limit / Stop / Stop-Limit orders (with TIF, optional
  trailing stop, and TP/SL brackets), modify or cancel working orders, **Cancel All**, and
  **Flat** / **Rev** a position. The Orders & Fills blotter tracks live status + fills.
- **Chart tab** — pick an interval (15s–1D), switch style (Candles / Line / Heikin-Ashi),
  toggle indicators (MA / EMA / VWAP / Bollinger / RSI / MACD), draw trendlines / horizontal
  lines, and see your working orders, position average, and fills drawn on the chart. **Latest**
  re-snaps the view to the newest bars.
