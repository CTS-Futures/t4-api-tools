# Copilot Instructions

## API Documentation

**https://docs.t4login.com/doku.php?id=developers:api**

Key sections:
- [WebSocket Introduction](https://docs.t4login.com/doku.php?id=developers:websocket) — Protobuf overview
- [Message Reference](https://docs.t4login.com/doku.php?id=developers:websocket:messages)
- [Connecting & Authenticating](https://docs.t4login.com/doku.php?id=developers:websocket:connecting)
- [Market Data](https://docs.t4login.com/doku.php?id=developers:websocket:markets) / [Quote Feed](https://docs.t4login.com/doku.php?id=developers:websocket:quotes)
- [Account Feed](https://docs.t4login.com/doku.php?id=developers:websocket:accounts)
- [Order Routing](https://docs.t4login.com/doku.php?id=developers:websocket:orders)
- [Pricing & Data Types](https://docs.t4login.com/doku.php?id=developers:websocket:pricing)
- [Certification & Testing](https://docs.t4login.com/doku.php?id=developers:websocket:certification)

---

## Repository Overview

This repo is a multi-language set of demo clients for the **T4 API** — a WebSocket + REST futures trading API by CTS. Each language subdirectory implements the same core communication pattern independently. **`JSDemo` is the primary reference implementation** — it receives new features and bugfixes first. When behavior differs between demos, JSDemo is the source of truth.

```
proto/                        # Canonical .proto definitions (source of truth)
  t4/v1/
    service.proto             # Top-level ClientMessage / ServerMessage oneofs
    auth/, market/, account/, orderrouting/, common/
tools/
  JavaScript/
    JSDemo/                   # Vanilla JS browser demo (no build step)
    t4-protobuf-js/           # NPM package that builds the JS protobuf bundle used by JSDemo
  Python/PyDemo/              # Python tkinter GUI client (asyncio + websockets)
  Cpp/CPPDemo/                # C++ Qt6 app (Visual Studio 2022 + vcpkg)
  dotNet/
    T4APIDemo/                # .NET console app — most complete reference implementation
    T4BinaryChartDataDemo/    # .NET demo for REST-only binary chart/trade history data
    util/                     # Shared .NET helpers (ClientMessageHelper, ProtoConverters, TimeUtil)
```

---

## Build Commands

### JavaScript — `t4-protobuf-js` (protobuf bundle)
```powershell
cd tools/JavaScript/t4-protobuf-js
npm install
npm run build    # copy-proto → pbjs/pbts → webpack → tsc declarations
npm run clean    # removes dist/, types/, src/generated/, src/proto/
```
Output: `dist/t4-proto.js` (browser bundle) — this file is copied into `JSDemo/t4-proto.js`.

### JavaScript — `JSDemo` (browser demo)
No build step. Create `config.js` from `config.template.js`, then open `index.html` in a browser.

### Python — `PyDemo`
```bash
cd tools/Python/PyDemo
pip install -r requirements.txt   # httpx, websockets, pyyaml, protobuf
python main.py
```

### .NET — `T4APIDemo`
```bash
cd tools/dotNet/T4APIDemo/T4APIDemo
dotnet run
```
Or build/run via Visual Studio 2022.

### .NET — `T4BinaryChartDataDemo`
```bash
cd tools/dotNet/T4BinaryChartDataDemo
dotnet run
```

### C++ — `CPPDemo`
Build only via Visual Studio 2022. Requires vcpkg (`protobuf`) and Qt 6 MSVC 2022 64-bit. See `tools/Cpp/README.md` for full environment setup.

### Proto compilation (only needed when `.proto` files change)
Run from the `proto/` directory; `protos.txt` lists all files:
```bash
# Python
protoc --proto_path=. --python_out=<output_path> @protos.txt

# C++  (use vcpkg's protoc to match the installed version)
protoc --proto_path=. --cpp_out=<output_path> @protos.txt
```
Pre-compiled proto outputs are already checked in to each demo's local `proto/` folder — you do not need to recompile to run any demo.

---

## Architecture

### Communication Flow (all demos)
1. **REST login** → obtain a JWT from `https://api[-sim].t4login.com`
2. **WebSocket connect** to `wss://wss[-sim].t4login.com/v1`
3. **Authenticate** over WebSocket using the JWT
4. **Subscribe** via `AccountSubscribe`, `MarketDepthSubscribe`, or `MarketByOrderSubscribe`
5. **Heartbeat** every 20 seconds; server-side timeout fires at ~60 seconds (3×)

All WebSocket frames are **raw binary Protobuf** (no length-prefix framing beyond what WebSocket provides). Messages are wrapped in the top-level `ClientMessage` (client→server) or `ServerMessage` (server→client) `oneof` defined in `service.proto`.

### Proto Message Grouping
Field numbers in `service.proto` are grouped by domain — this is intentional and must be preserved when adding messages:
- `1–3`: heartbeat / auth
- `100+`: market data
- `200+`: account data
- `300+`: order routing

### Proto Package vs. Folder Path
The `.proto` package declaration is **`t4proto.v1.*`** (note `t4proto`, not `t4`), even though the folder path is `t4/v1/`. Generated C# namespaces follow `T4Proto.V1.*`. Keep these consistent when adding new proto files.

### `ClientMessageHelper` Pattern
All languages use a helper to wrap a domain message into the `ClientMessage` oneof before sending. When adding new outbound message types, update this helper in each language:
- **C#** (`tools/dotNet/util/ClientMessageHelper.cs`): reflection-driven; auto-discovers `ClientMessage` properties — no manual wiring needed when new proto properties are added.
- **Python** (`tools/Python/PyDemo/tools/ClientMessageHelper.py`): manual dispatch.
- **JavaScript** (`t4-protobuf-js/src/`): manual dispatch in `ClientMessageHelper.createClientMessage()`.

### .NET DI Structure
`T4APIDemo` uses `Microsoft.Extensions.Hosting`:
- `ICredentialProvider` abstracts credential sourcing (swap for secrets management without touching `T4APIClient`)
- `T4APIClient` is a singleton; `DemoClient` is the `IHostedService` that drives it
- Polly `AsyncRetryPolicy` handles WebSocket reconnection
- Local dev credentials: `dotnet user-secrets` (`config.AddUserSecrets<Program>(optional: true)`)

---

## Key Conventions

### Configuration Template Pattern
Every demo uses a **template + gitignored actual config**:
| Demo | Template | Actual (gitignored) |
|---|---|---|
| JSDemo | `config.template.js` | `config.js` |
| PyDemo | `config/config.template.yaml` | `config/config.yaml` |
| T4APIDemo | `appsettings.json` (blank fields) | user-secrets or local override |
| CPPDemo | (JSON template in README) | `config/config.json` |

Never commit credentials. Both **API key** auth and **firm/username/password/appName/appLicense** credential auth are supported in all demos; use one or the other.

### Environments
- **Simulator**: `wss://wss-sim.t4login.com/v1` / `https://api-sim.t4login.com`
- **Live**: `wss://wss.t4login.com/v1` / `https://api.t4login.com`

### `priceFormat` Field
Controls price display formatting, used consistently across all demos:
- `0` = Decimal
- `1` = Real (use when ES prices appear as `6030.75`)
- `2` = (default in all config templates)

### JSDemo: `t4-proto.js` Is a Build Artifact
`tools/JavaScript/JSDemo/t4-proto.js` is the pre-built browser bundle from `t4-protobuf-js`. If proto definitions change, rebuild `t4-protobuf-js` and copy the new `dist/t4-proto.js` into `JSDemo/`.
