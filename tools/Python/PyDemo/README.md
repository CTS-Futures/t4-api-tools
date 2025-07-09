# T4 API GUI Client

This Python project is a GUI-based trading client for the T4 API. It allows users to connect to the T4 trading platform, browse and select contracts and expiries, submit and manage orders, and monitor account positions and market data.

---

## 📁 Project Structure

- `main.py`: Entry point for launching the application.
- `T4APIClient.py`: Handles WebSocket and REST API communication, including authentication, market data subscriptions, and order management.
- `t4_gui.py`: Main GUI layout, managing views for market data, order submission, positions, and orders.
- `contract_picker.py`: Backend logic for loading and searching contract data from the T4 API.
- `contract_picker_dialog.py`: UI dialog for selecting contracts via a searchable tree view.
- `expiry_picker.py`: Backend logic for retrieving expiry strategies and market information.
- `expiry_picker_dialog.py`: UI dialog for selecting expiries and strategies from grouped market data.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/t4-api-gui.git
cd t4-api-gui
```

### 2. Install Dependencies

Install required Python packages:

```bash
pip install -r requirements.txt
```

> If `requirements.txt` is not present, manually install the dependencies listed below.

---

## 📦 Dependencies

Make sure the following Python packages are installed:

```bash
pip install httpx websockets pyyaml protobuf
```

If using a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

---

## ⚙️ Configuration

1. Create a configuration file at `config/config.yaml` based on the provided template (`config.template.yaml`).
2. The configuration should include:
   - WebSocket URL
   - API URL
   - Firm, username, and password
   - Application name and license
   - Market display settings (e.g., `priceFormat`)
   - Default exchange and contract IDs

Example `config.yaml`:

```yaml
websocket:
  url: wss://api.t4.example.com/ws
  api: https://api.t4.example.com
  firm: YOUR_FIRM
  username: YOUR_USERNAME
  password: YOUR_PASSWORD
  app_name: YOUR_APP
  app_license: LICENSE_KEY
  priceFormat: 2
  md_exchange_id: CME
  md_contract_id: ES
```

---

## ▶️ Running the Application

To launch the GUI, simply run:

```bash
python main.py
```

This starts a `tkinter`-based GUI where you can:

- Connect to your trading account
- Pick contracts and expiry strategies
- Place, modify, or cancel orders
- Monitor market depth, positions, and account status

---

## 📌 Notes

- Make sure you have access credentials to the T4 API.
- Some features (e.g., bracket orders) rely on specific data from the T4 backend like `point_value` and `min_price_increment`.
- The application uses both REST and WebSocket protocols for full data access.

---

## 🛠️ Development Tips

- Python 3.10+ is recommended.
- GUI rendering uses `tkinter` and should work cross-platform.
- Asynchronous logic (`asyncio`) is used heavily, especially for REST/WebSocket I/O and GUI updates.

---

## 🧾 License

This project is proprietary and requires credentials to access the T4 API services. Contact your trading administrator for integration access.
