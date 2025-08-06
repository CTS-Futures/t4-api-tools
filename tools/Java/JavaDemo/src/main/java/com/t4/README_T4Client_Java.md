# T4 Java Client UI

A JavaFX-based GUI application that connects to the **T4 trading platform**, enabling users to:

- Authenticate via JWT
- Select and view futures market contracts
- Monitor real-time market data
- Submit bracket orders (main + TP + SL)
- Track live orders and positions

This project mirrors functionality from the JavaScript `T4APIClient`, offering a feature-rich interface and tightly integrated real-time updates using T4 WebSocket and REST APIs.

---

## 🚀 Features

- 🔐 **Authentication** via JWT (manual config via `T4Config.java`)
- 📈 **Market Data Pane**: Real-time snapshot and depth updates
- 📑 **Contract Picker & Expiry Picker** for selecting markets and expiries
- 🧾 **Order Form**: Submit main + TP + SL bracket orders
- 📋 **Positions & Orders UI**: Live updates for order/position changes
- 🔁 **Reconnect and heartbeat** logic to maintain session

---

## 🗂️ Project Structure

```
├── Main.java                    # JavaFX entry point
├── T4APIClientTest.java        # Core WebSocket and API handler
├── T4Config.java               # Auth token & config constants
│
├── UI Components
│   ├── ConnectionUI.java
│   ├── ContractSelectorDialog.java
│   ├── ContractPicker.java
│   ├── ExpiryPicker.java
│   ├── MarketDataPane.java
│   ├── OrderFormPane.java
│   ├── PositionsAndOrdersUI.java
│
├── Data Models / Helpers
│   ├── OrderRow.java
│   ├── PositionRow.java
│   ├── Callback.java
│   ├── MarketSubscriber.java
│   ├── SearchableDialog.java
```

---

## 🛠️ Setup & Running

### Prerequisites

- Java 17+
- JavaFX SDK
- Protobuf-generated classes for `t4proto.v1.marketdata`, `t4proto.v1.orderrouting`, and `t4proto.v1.account`

### Run Instructions

1. Clone the repo
2. Configure your JWT token in `T4Config.java`
3. Ensure all required Protobuf-generated classes are in the classpath
4. Compile and run:

```bash
javac -cp "path/to/javafx-sdk/lib/*" *.java
java -cp ".:path/to/javafx-sdk/lib/*" Main
```

---

## 🧠 Application Flow

1. `Main.java` launches the app and shows the connection UI.
2. Upon clicking **Connect**, `T4APIClientTest` logs in using JWT, establishes WebSocket, and subscribes to a default market.
3. UI components are shown:
   - `MarketDataPane`: receives and displays `MarketSnapshot`
   - `ContractSelectorDialog`: allows market + expiry selection
   - `OrderFormPane`: lets user submit bracket orders
   - `PositionsAndOrdersUI`: updates from `OrderUpdateMulti` and `AccountPosition`
4. Orders and positions are tracked via `OrderRow` and `PositionRow`.

---

## 📚 Key Dependencies

- JavaFX for UI rendering
- Protobuf for message parsing (not included here)
- T4 WebSocket and REST APIs

---

## 🧹 Cleanup & Simplification Summary

- ✅ `ClientMessageHelper.java` removed (method inlined into `T4APIClientTest`)
- 🧩 `SearchableDialog.java` retained — used only by `ContractPicker`, cleanly abstracted
- 📦 `ContractPicker` and `ExpiryPicker` kept separate due to distinct roles
- 🧼 Suggestions remain for future refactor: unify styling to JavaFX and group pickers in a common package

---

## ⚠️ Known Limitations / TODOs

- No handling for `ACCOUNT_SNAPSHOT` or `ACCOUNT_UPDATE` beyond logging
- Market selection does not persist across reconnects
- Order status feedback is limited (success/error not shown to user clearly)
- No pagination or filtering for large order/position lists

---

## 📞 Contact

For questions or contributions, please contact **Plus500 US R&D**:

- 📧 Email: support@plus500.com
- 🌐 Website: [https://www.plus500.com](https://www.plus500.com)

---

## 📦 License

This project is proprietary and intended for internal use within **Plus500 US R&D**. Unauthorized distribution is prohibited.