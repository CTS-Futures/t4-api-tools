# t4decoder (C++)

Dependency-free C++17 port of the T4 chart-data decoder. Ports the Java
original (`t4-java-api`, `com.t4login.*`), cross-checked against the Python
(`t4-pythonConversion-api`) and JavaScript (`t4-javascript-api`) ports.

Decodes the two T4 binary formats:

- **T4Bin** — tick-level tradehistory (trades, quotes, TPO, settlement, RFQ…)
- **T4BinAggr** — aggregated OHLCV barchart

The core library needs **no external dependencies** — no Qt, no Boost, no
protobuf. Decimal/price math uses a small built-in big-integer. The HTTP
`ChartClient` (Phase 5) is the only piece that needs a third-party lib
(**libcurl**) and is gated behind `-DT4DECODER_BUILD_CLIENT=ON`.

```sh
cmake -S . -B build-client -G Ninja -DT4DECODER_BUILD_CLIENT=ON   # needs libcurl
cmake --build build-client
```

## Build & test

Requires a C++17 compiler and CMake ≥ 3.16. No other setup.

```sh
cd tools/Cpp/t4decoder
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure      # or: ./build/t4decoder_tests
```

On Windows with MSVC, the same commands work from a "Developer Command Prompt"
(or use `-G "Visual Studio 17 2022"`). With MSYS2/MinGW, add `-G Ninja` or
`-G "MinGW Makefiles"`.

## Status

Core decoder complete and verified — 24 unit tests pass, including a
golden-fixture parity test that reproduces the Python `sample_expected.csv`
field-for-field, and a smoke CLI that does the same from the command line.

| Phase | Component | State |
|---|---|---|
| 0 | CMake scaffold | ✅ |
| 1 | Byte streams, 7-bit codec, 96-bit decimal, BigInt/Decimal | ✅ |
| 2 | NDateTime, Price, enums, ChartDataState, ChartFormat, msg readers | ✅ |
| 3 | Aggregated reader (T4BinAggr) + golden-fixture parity | ✅ |
| 4 | Non-aggregated reader (T4Bin) — full tag set | ✅ |
| 5 | `extractT4BinPayload` ✅ · HTTP `ChartClient` (libcurl) ✅ compiles | done* |
| 6 | Smoke CLI + parity harness | ✅ |

\* The `ChartClient` GET is validated end-to-end over **local loopback** (a Node
server serving `sample.bin`; `t4decoder_fetch` fetches + decodes it to the same
values as the golden fixture). It has **not** been run against the live
`https://api-sim.t4login.com/chart` API — that needs a valid T4 sim Bearer
token. Run it with:

```sh
./build-client/t4decoder_fetch <baseUrl> <token> [exchangeId contractId tradeDateStart tradeDateEnd]
```

### Known limitations / follow-ups
- **VPT** (variable price tick) is a stub returning `getIsValid()==false`; markets
  with a VPT spec fall back to `increments * minPriceIncrement`. Full VPT needs
  general decimal division. Not exercised by the fixtures or `ChartDataState`.
- **HTTP transport** uses libcurl (the plan's cpp-httplib isn't packaged for
  MSYS2). The binary-payload extraction is tested; the live GET is not.
- `ChartDataState::getPointValue` (dollar conversions) not ported — not needed
  for decoding.

## Smoke CLI

```sh
./build/t4decoder_smoke aggr tests/fixtures/sample.bin      # -> CSV (== sample_expected.csv)
./build/t4decoder_smoke tick <tradehistory.bin> [marketId]  # -> per-record lines
```

## Layout

```
include/t4decoder/   public headers
src/                 library sources
tests/               dependency-free unit tests (tests/check.hpp harness)
smoke/               console decode tool (Phase 6)
```
