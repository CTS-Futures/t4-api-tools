import asyncio
import math
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client
from datetime import datetime
from contract_picker_dialog import Contract_Picker_Dialog
from expiry_picker_dialog import Expiry_Picker_Dialog
from contract_picker import Contract_Picker
class T4_GUI(tk.Tk):

    def __init__(self, root, client, loop=None):
        self.root = root
        self.client = client
        # The asyncio loop, used by open_chart() to schedule the chart window's
        # async run(). Falls back to asyncio.get_event_loop() if not supplied.
        self.loop = loop
        self.root.title("T4 API Demo")
        self.root.geometry("1750x1380")

        # Seed the order-entry price once per market from the first valid trade.
        # A manual edit for that market always takes precedence.
        self.auto_price_market_id = None
        self.auto_price_user_edited_market_id = None

        self.client.on_market_update = self.update_market_ui
        self.client.market_header_update = self.update_market_header_ui
        self.client.on_market_switch = self.reset_market_ui
        self.client._subscribed_once = False
        self.client.on_account_update = self.handle_account_update
        self.client.on_batch_update = self.handle_batch_update
        self.contract_picker = Contract_Picker(self.client)
        self.create_widgets()

    def create_widgets(self):
         #create top frame for connection (20% of height)
        self.connect_frame = tk.Frame(self.root, bg="white", bd=2, relief="groove", padx=20, pady=20)
        self.connect_frame.place(relx=0.05, rely=0.02, relwidth=0.9, relheight=0.2)

        #title
        title = tk.Label(self.connect_frame, text="Connection & Account", font=("Arial", 16, "bold"), bg="white")
        title.grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 10))

        #separator (horizontal line)
        separator = tk.Frame(self.connect_frame, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, columnspan=4, sticky="ew", pady=(0, 10))

        # Connection Status (icon + label)
        self.status_icon = tk.Canvas(self.connect_frame, width=10, height=10, bg="white", highlightthickness=0)
        self.status_icon.create_oval(2, 2, 10, 10, fill="gray")
        self.status_icon.grid(row=2, column=0, sticky="w", padx=(0, 10))

        self.status_label = tk.Label(self.connect_frame, text="Disconnected", font=("Arial", 12), bg="white")
        self.status_label.grid(row=2, column=1, sticky="w")

        # Account Dropdown
        tk.Label(self.connect_frame, text="Account:", font=("Arial", 12), bg="white").grid(row=3, column=0, pady=10, sticky="w")
        self.account_dropdown = ttk.Combobox(self.connect_frame, values=["Select Account..."])
        self.account_dropdown.bind("<<ComboboxSelected>>", lambda e: asyncio.create_task(self.on_account_selected()))

        self.account_dropdown.set("Select Account...")
        self.account_dropdown.grid(row=3, column=1, padx=10, sticky="w")

        #connect Button
        self.connect_button = tk.Button(self.connect_frame, text="Connect", bg="#6b7280", fg="white", command=self.start_connection)
        self.connect_button.grid(row=3, column=2, padx=(10, 5))

        #disconnect Button
        self.disconnect_button = tk.Button(self.connect_frame, text="Disconnect", bg="#3b82f6", fg="white", command=self.end_connection)
        self.disconnect_button.grid(row=3, column=3, padx=5)

        #portfolio study (walk-forward rotation backtest viewer). A global tool,
        #not market-specific (CSV mode needs no market/login), so it lives on the
        #top connection bar rather than crowding the Market Data box.
        self.portfolio_study_button = tk.Button(self.connect_frame, text="Portfolio Study", bg="#6b7280", fg="white", command=self.open_portfolio_study)
        self.portfolio_study_button.grid(row=3, column=4, padx=(20, 5))

        #single-instrument backtester (JSDemo-parity strategies on T4 bars).
        #Same global tool / guarded-lazy-import pattern as Portfolio Study.
        self.backtester_button = tk.Button(self.connect_frame, text="Backtester", bg="#6b7280", fg="white", command=self.open_backtester)
        self.backtester_button.grid(row=3, column=5, padx=5)

        #companion chart window (lightweight-charts). Opens on demand rather than
        #at startup — same global tool / guarded-lazy-import pattern as the others.
        self.chart_button = tk.Button(self.connect_frame, text="Chart", bg="#6b7280", fg="white", command=self.open_chart)
        self.chart_button.grid(row=3, column=6, padx=5)


        #market frame
        self.market_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.market_frame.place(relx=0.05, rely=0.25, relwidth=0.44, relheight=0.3)

        #allows for resizing — let the container fill the whole frame, and let the
        #quotes row (market_inner) absorb the vertical slack.
        self.market_frame.columnconfigure(0, weight=1)
        self.market_frame.rowconfigure(0, weight=1)

        #container for data. ensures things are touching the borders (padx and pady)
        market_container = tk.Frame(self.market_frame, bg="white", padx=20, pady=20)
        market_container.grid(row=0, column=0, sticky="nsew")
        market_container.columnconfigure(0, weight=1)
        market_container.rowconfigure(2, weight=1)

        market_title = tk.Label(market_container, text="Market Data", font=("Arial", 16, "bold"), bg="white")
        market_title.grid(row=0, column=0, sticky="w", pady=(0, 10))
        
        # market header
        self.market_header_label = tk.Label(market_container, text="...", font=("Arial", 14), bg="white", fg="#3b82f6")
        self.market_header_label.grid(row=0, column=1, sticky="e", padx=(10, 0), pady=(0, 10))

        separator = tk.Frame(market_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 10))

        #we will put the dynamic changing ui within this frame. (the same pattern for the following three big frames)
        self.market_inner = tk.Frame(market_container, bg="#f9f9f9")
        self.market_inner.grid(row=2, column=0, columnspan=2, sticky="nsew")

        #button bar beneath the quotes: contract + expiry side by side, so they no
        #longer crowd the quote area or sit on stray market_frame rows.
        button_bar = tk.Frame(market_container, bg="white")
        button_bar.grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))
        tk.Button(button_bar, text="Pick a Contract", command=self.open_contract_picker).grid(row=0, column=0, padx=(0, 8))
        tk.Button(button_bar, text="Expiry", command=self.open_expiry_picker).grid(row=0, column=1)

        # v2 MarketSubscribe has two independent controls: quote depth and the
        # optional standalone MarketTrade ticker.
        tk.Label(button_bar, text="Quotes:", bg="white").grid(row=0, column=2, padx=(18, 4))
        self.subscription_type_combo = ttk.Combobox(
            button_bar,
            values=["top_of_book", "full_order_book", "mbo"],
            state="readonly",
            width=16,
        )
        self.subscription_type_combo.set(self.client.market_subscription_type)
        self.subscription_type_combo.grid(row=0, column=3, padx=(0, 8))
        self.subscription_type_combo.bind(
            "<<ComboboxSelected>>",
            lambda _event: asyncio.create_task(self.on_market_subscription_changed()),
        )
        self.subscription_ticker_var = tk.BooleanVar(value=self.client.market_ticker)
        ttk.Checkbutton(
            button_bar,
            text="Trades",
            variable=self.subscription_ticker_var,
            command=lambda: asyncio.create_task(self.on_market_subscription_changed()),
        ).grid(row=0, column=4)


        #Submit frame
        self.submit_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.submit_frame.place(relx=0.51, rely=0.25, relwidth=0.44, relheight=0.38)

        submit_container = tk.Frame(self.submit_frame, bg="white", padx=20, pady=20)
        submit_container.pack(fill="both", expand=True)
        submit_container.grid_columnconfigure(0, weight=1)
        submit_container.grid_columnconfigure(1, weight=1)

        submit_title = tk.Label(submit_container, text="Submit Order", font=("Arial", 16, "bold"), bg="white")
        submit_title.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))

        separator = tk.Frame(submit_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 10))

        # Type (Limit/Market)
        tk.Label(submit_container, text="Type:", font=("Arial", 12, "bold"), bg="white").grid(row=2, column=0, sticky="w")
        self.type_combo = ttk.Combobox(submit_container, values=["Limit", "Market"], state="readonly")
        self.type_combo.set("Limit")
        self.type_combo.grid(row=3, column=0, sticky="ew", padx=(0, 10))

        # Side (Buy/Sell)
        tk.Label(submit_container, text="Side:", font=("Arial", 12, "bold"), bg="white").grid(row=2, column=1, sticky="w")
        self.side_combo = ttk.Combobox(submit_container, values=["Buy", "Sell"], state="readonly")
        self.side_combo.set("Buy")
        self.side_combo.grid(row=3, column=1, sticky="ew")

        # Volume (Spinbox). v2 carries order quantity as Decimal, so fractional
        # quantities are valid for markets that support them.
        tk.Label(submit_container, text="Volume:", font=("Arial", 12, "bold"), bg="white").grid(row=4, column=0, sticky="w", pady=(10, 0))
        self.volume_spinbox = tk.Spinbox(submit_container, from_=0.01, to=99999, increment=0.01)
        self.volume_spinbox.delete(0, "end")
        self.volume_spinbox.insert(0, "1")
        self.volume_spinbox.grid(row=5, column=0, sticky="ew", padx=(0, 10))

        # Price (Spinbox)
        tk.Label(submit_container, text="Price:", font=("Arial", 12, "bold"), bg="white").grid(row=4, column=1, sticky="w", pady=(10, 0))
        self.price_spinbox = tk.Spinbox(submit_container, from_=0.01, to=99999.99, increment=0.01)
        self.price_spinbox.delete(0, "end")
        self.price_spinbox.insert(0, "100")
        self.price_spinbox.grid(row=5, column=1, sticky="ew")
        self.price_spinbox.bind("<KeyRelease>", self._mark_price_edited)
        self.price_spinbox.bind("<ButtonRelease-1>", self._mark_price_edited)

        # Take Profit
        self.take_profit_label = tk.Label(submit_container, text="Take Profit ($):", font=("Arial", 12, "bold"), bg="white")
        self.take_profit_label.grid(row=6, column=0, sticky="w", pady=(10, 0))
        self.take_profit_entry = tk.Entry(submit_container)
        self.take_profit_entry.insert(0, "Optional")
        self.take_profit_entry.grid(row=7, column=0, sticky="ew", padx=(0, 10))

        # Stop Loss
        self.stop_loss_label = tk.Label(submit_container, text="Stop Loss ($):", font=("Arial", 12, "bold"), bg="white")
        self.stop_loss_label.grid(row=6, column=1, sticky="w", pady=(10, 0))
        self.stop_loss_entry = tk.Entry(submit_container)
        self.stop_loss_entry.insert(0, "Optional")
        self.stop_loss_entry.grid(row=7, column=1, sticky="ew")

        # v2 AOCO bracket modes: dollar distances use AUTO_OCO; absolute prices
        # use AUTO_OCO_P. The client performs the corresponding conversion.
        tk.Label(submit_container, text="Bracket Mode:", font=("Arial", 12, "bold"), bg="white").grid(row=8, column=0, sticky="w", pady=(10, 0))
        self.bracket_mode_combo = ttk.Combobox(
            submit_container,
            values=["dollars", "price"],
            state="readonly",
            width=18,
        )
        self.bracket_mode_combo.set("dollars")
        self.bracket_mode_combo.grid(row=9, column=0, sticky="ew", padx=(0, 10))
        self.bracket_mode_combo.bind("<<ComboboxSelected>>", self.update_bracket_labels)
        self.trailing_stop_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            submit_container,
            text="Trailing stop",
            variable=self.trailing_stop_var,
        ).grid(row=9, column=1, sticky="w")

        # Submit Button
        self.submit_button = tk.Button(submit_container, text="Submit Order", bg="#3b82f6", fg="white", font=("Arial", 12, "bold"), command=lambda:asyncio.create_task(self.on_submit_order()), state="disabled")
        self.submit_button.grid(row=10, column=0, columnspan=2, pady=20, sticky="ew")

        # Batch staging controls. Each click snapshots the current account,
        # market, order fields, and bracket mode; Submit Batch sends one atomic
        # v2 OrderBatch.
        batch_bar = tk.Frame(submit_container, bg="white")
        batch_bar.grid(row=11, column=0, columnspan=2, sticky="ew")
        self.add_batch_button = tk.Button(batch_bar, text="Add to Batch", command=self.add_current_order_to_batch)
        self.add_batch_button.pack(side="left", padx=(0, 6))
        self.submit_batch_button = tk.Button(batch_bar, text="Submit Batch (0)", command=lambda: asyncio.create_task(self.submit_current_batch()), state="disabled")
        self.submit_batch_button.pack(side="left", padx=(0, 6))
        self.clear_batch_button = tk.Button(batch_bar, text="Clear Batch", command=self.clear_batch)
        self.clear_batch_button.pack(side="left")
        self.batch_status_label = tk.Label(submit_container, text="", bg="white", anchor="w")
        self.batch_status_label.grid(row=12, column=0, columnspan=2, sticky="ew")
        self.batch_rows = []
        self.oco_legs = None
        self.oco_button = tk.Button(batch_bar, text="Configure OCO...", command=self.open_oco_dialog)
        self.oco_button.pack(side="left", padx=(6, 0))

        #positions frame
        self.positions_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.positions_frame.place(relx=0.05, rely=0.65, relwidth=0.44, relheight=0.25)

        self.positions_frame.columnconfigure(0, weight=1)
        self.positions_frame.rowconfigure(2, weight=1)

        positions_container = tk.Frame(self.positions_frame, bg="white", padx=20, pady=20)
        positions_container.grid(row=0, column=0, sticky="nsew")

        positions_title = tk.Label(positions_container, text="Positions", font=("Arial", 16, "bold"), bg="white")
        positions_title.grid(row=0, column=0, sticky="w", pady=(0, 10))

        separator = tk.Frame(positions_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, sticky="ew", pady=(0, 10))

        self.positions_inner = tk.Frame(positions_container, bg="#f9f9f9")
        self.positions_inner.grid(row=2, column=0, sticky="nsew")
        columns = ("Market", "Net", "P&L", "Working")
        self.positions_tree = ttk.Treeview(self.positions_inner, columns=columns, show="headings", height=5)
        self.positions_tree.tag_configure("pnl_positive", foreground="#16a34a")  # Green
        self.positions_tree.tag_configure("pnl_negative", foreground="#dc2626")  # Red
        self.positions_tree.tag_configure("pnl_neutral", foreground="black")     # Default
        for col in columns:
            self.positions_tree.heading(col, text=col)
            self.positions_tree.column(col, width=100, anchor="center")
        # Create a vertical scrollbar
        scrollbar_pos = ttk.Scrollbar(self.positions_inner, orient="vertical", command=self.positions_tree.yview)
        self.positions_tree.configure(yscrollcommand=scrollbar_pos.set)

        # Layout the tree and scrollbar side by side
        self.positions_tree.grid(row=0, column=0, sticky="nsew")
        scrollbar_pos.grid(row=0, column=1, sticky="ns")

        # Allow the Treeview to expand within its container
        self.positions_inner.grid_rowconfigure(0, weight=1)
        self.positions_inner.grid_columnconfigure(0, weight=1)


        # orders frame
        self.orders_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.orders_frame.place(relx=0.51, rely=0.65, relwidth=0.44, relheight=0.25)

        self.orders_frame.columnconfigure(0, weight=1)
        self.orders_frame.rowconfigure(2, weight=1)

        orders_container = tk.Frame(self.orders_frame, bg="white", padx=20, pady=20)
        orders_container.grid(row=0, column=0, sticky="nsew")

        orders_title = tk.Label(orders_container, text="Orders", font=("Arial", 16, "bold"), bg="white")
        orders_title.grid(row=0, column=0, sticky="w", pady=(0, 10))

        separator = tk.Frame(orders_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, sticky="ew", pady=(0, 10))

        self.orders_inner = tk.Frame(orders_container, bg="#f9f9f9")
        self.orders_inner.grid(row=2, column=0, sticky="nsew")
        columns = ("Time", "Market", "Side", "Volume", "Price", "Status", "Action")
        self.orders_tree = ttk.Treeview(self.orders_inner, columns=columns, show="headings", height=8)

        for col in columns:
            self.orders_tree.heading(col, text=col)
            self.orders_tree.column(col, anchor="center", width=80)

        scrollbar = ttk.Scrollbar(self.orders_inner, orient="vertical", command=self.orders_tree.yview)
        self.orders_tree.configure(yscroll=scrollbar.set)

        self.orders_tree.grid(row=0, column=0, sticky="nsew")
        self.orders_tree.bind("<ButtonRelease-1>", self.on_order_action_click)
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.orders_inner.grid_rowconfigure(0, weight=1)
        self.orders_inner.grid_columnconfigure(0, weight=1)
    
    #dialog for edit orders (revise and pull)
    def show_edit_dialog(self, unique_id, order_values):
        dialog = tk.Toplevel(self.root)
        dialog.title("Modify Order")
        dialog.geometry("300x250")
        dialog.configure(bg="white")
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.grab_set()

        # Header
        header = tk.Label(dialog, text="Modify Order", font=("Arial", 16, "bold"), bg="white")
        header.pack(pady=(15, 10))

        # Volume
        volume_frame = tk.Frame(dialog, bg="white")
        volume_frame.pack(padx=20, anchor="w")
        tk.Label(volume_frame, text="Volume:", font=("Arial", 12, "bold"), bg="white").pack(anchor="w")
        vol_entry = ttk.Spinbox(volume_frame, from_=0.01, to=9999, increment=0.01, width=25)
        vol_entry.insert(0, order_values[3])
        vol_entry.pack(pady=(0, 10))

        # Price
        price_frame = tk.Frame(dialog, bg="white")
        price_frame.pack(padx=20, anchor="w")
        tk.Label(price_frame, text="Price:", font=("Arial", 12, "bold"), bg="white").pack(anchor="w")
        price_entry = ttk.Entry(price_frame, width=28)
        price_entry.insert(0, order_values[4])
        price_entry.pack(pady=(0, 10))

        # Button Row
        button_frame = tk.Frame(dialog, bg="white")
        button_frame.pack(pady=10)

        # Pull Button
        pull_btn = tk.Button(
            button_frame,
            text="Pull",
            bg="#dc2626", fg="white", width=8,
            command=lambda: asyncio.create_task(self.confirm_pull(unique_id, dialog))
        )
        pull_btn.pack(side="left", padx=5)

        # Revise Button
        revise_btn = tk.Button(
            button_frame,
            text="Revise",
            bg="#2563eb", fg="white", width=8,
            command=lambda: asyncio.create_task(self.confirm_revise(unique_id, vol_entry.get(), price_entry.get(), dialog))
        )
        revise_btn.pack(side="left", padx=5)

        # Cancel Button
        cancel_btn = tk.Button(
            button_frame,
            text="Cancel",
            bg="#e5e7eb", fg="black", width=8,
            command=dialog.destroy
        )
        cancel_btn.pack(side="left", padx=5)
    
    #edit order button
    def on_order_action_click(self, event):
        item_id = self.orders_tree.identify_row(event.y)
        column = self.orders_tree.identify_column(event.x)

        if not item_id or not column:
            return

        col_index = int(column.replace('#', '')) - 1
        values = self.orders_tree.item(item_id, 'values')
        unique_id = item_id
       
        if col_index == 6:
            action_value = values[col_index]
            if "✏️ Edit" in action_value:
                self.show_edit_dialog(unique_id, values)

    #calls from client to revise the order
    async def confirm_revise(self, unique_id, volume, price_entry, dialog):
        dialog.destroy()
        await self.client.revise_order(unique_id, float(volume), float(price_entry), 'limit')

    #calls client to pull the order
    async def confirm_pull(self, unique_id, dialog):
        dialog.destroy()
        await self.client.pull_order(unique_id)
        

    #command for when the button is pressed
    def start_connection(self):
        self.status_label.config(text="Status: Connecting...")
        asyncio.create_task(self.connect_and_listen())
    
    #disconnects from websocket and updates ui
    def end_connection(self):
        self.status_label.config(text="Status: Disconnecting...", foreground="red")
        asyncio.create_task(self.disconnect())

    def handle_account_update(self, update):
        update_type = update.get("type")

        if update_type == "accounts":
            self.populate_accounts()
        elif update_type == "positions":
            self.update_positions_table(update)
        elif update_type == "orders":
            self.update_orders_table(update)

    def handle_batch_update(self, event):
        """Render v2 batch acknowledgements/rejections on the Tk thread."""
        status = event.get("status")
        batch_id = event.get("batch_id", "")
        message = event.get("message")
        if status == "acknowledged":
            accepted = sum(
                len(item.unique_id)
                for item in getattr(message, "accepted", [])
            )
            self.batch_rows.clear()
            self.batch_status_label.config(
                text=f"Batch {batch_id} acknowledged ({accepted} orders)"
            )
        else:
            reason = getattr(message, "reason", "unknown reason")
            errors = getattr(message, "errors", [])
            if errors:
                reason = f"{reason} ({len(errors)} row error(s))"
            self.batch_status_label.config(
                text=f"Batch {batch_id} rejected: {reason}"
            )
        self._set_batch_status(self.batch_status_label.cget("text"))

    async def on_market_subscription_changed(self):
        """Apply the selected quote depth and standalone trade ticker."""
        try:
            await self.client.set_market_subscription(
                subscription_type=self.subscription_type_combo.get(),
                ticker=self.subscription_ticker_var.get(),
            )
        except Exception as exc:  # noqa: BLE001 - surface errors in the demo console
            print(f"Market subscription update failed: {exc}")

    def update_bracket_labels(self, _event=None):
        suffix = "($)" if self.bracket_mode_combo.get() == "dollars" else "(price)"
        for label, text in (
            (self.take_profit_label, f"Take Profit {suffix}"),
            (self.stop_loss_label, f"Stop Loss {suffix}"),
        ):
            label.config(text=f"{text}:")

    def _set_batch_status(self, text):
        self.batch_status_label.config(text=text)
        self.submit_batch_button.config(
            text=f"Submit Batch ({len(self.batch_rows)})",
            state=("normal" if self.client.running and self.client.selected_account and self.batch_rows else "disabled"),
        )

    def add_current_order_to_batch(self):
        """Stage the current order form as one v2 OrderBatch row."""
        if not self.client.selected_account or not self.client.current_market_id:
            self._set_batch_status("Select an account and market first")
            return

        order_type = self.type_combo.get().lower()
        side = self.side_combo.get().lower()
        try:
            volume = float(self.volume_spinbox.get())
            if not math.isfinite(volume) or volume <= 0:
                raise ValueError("volume must be positive")
            price = None if order_type == "market" else float(self.price_spinbox.get())
            if price is not None and (not math.isfinite(price) or price <= 0):
                raise ValueError("price must be positive")

            def optional_float(entry):
                raw = entry.get().strip()
                return None if not raw or raw.lower() == "optional" else float(raw)

            take_profit = optional_float(self.take_profit_entry)
            stop_loss = optional_float(self.stop_loss_entry)
            for name, value in (("take profit", take_profit), ("stop loss", stop_loss)):
                if value is not None and not math.isfinite(value):
                    raise ValueError(f"{name} must be finite")
        except ValueError as exc:
            self._set_batch_status(f"Cannot add order: {exc}")
            return

        self.batch_rows.append(
            {
                "account_id": self.client.selected_account,
                "market_id": self.client.current_market_id,
                "side": side,
                "volume": volume,
                "price": price,
                "price_type": order_type,
                "take_profit_dollars": take_profit,
                "stop_loss_dollars": stop_loss,
                "trailing_stop": self.trailing_stop_var.get(),
                "bracket_mode": self.bracket_mode_combo.get(),
            }
        )
        self._set_batch_status(f"{len(self.batch_rows)} order(s) staged")

    async def submit_current_batch(self):
        if not self.batch_rows:
            self._set_batch_status("Add at least one order first")
            return
        try:
            batch_id = await self.client.submit_batch(list(self.batch_rows))
            self.batch_status_label.config(text=f"Batch {batch_id} submitted; waiting for acknowledgement")
            self.submit_batch_button.config(state="disabled")
        except Exception as exc:  # noqa: BLE001 - show demo errors without killing Tk
            self._set_batch_status(f"Batch submission failed: {exc}")

    def clear_batch(self):
        self.batch_rows.clear()
        self._set_batch_status("Batch cleared")

    def open_oco_dialog(self):
        """Collect two independent legs for a true v2 ORDER_LINK_OCO order."""
        dialog = tk.Toplevel(self.root)
        dialog.title("Configure OCO")
        dialog.transient(self.root)
        dialog.grab_set()

        fields = []
        for index in range(2):
            frame = tk.LabelFrame(dialog, text=f"Leg {index + 1}", padx=8, pady=8)
            frame.pack(fill="x", padx=10, pady=(10 if index == 0 else 4, 4))
            side = ttk.Combobox(frame, values=["Buy", "Sell"], state="readonly", width=8)
            side.set("Buy" if index == 0 else "Sell")
            side.grid(row=0, column=0, padx=3)
            order_type = ttk.Combobox(frame, values=["Limit", "Market", "Stop"], state="readonly", width=8)
            order_type.set("Limit")
            order_type.grid(row=0, column=1, padx=3)
            volume = tk.Entry(frame, width=10)
            volume.insert(0, "1")
            volume.grid(row=0, column=2, padx=3)
            price = tk.Entry(frame, width=12)
            price.insert(0, "100")
            price.grid(row=0, column=3, padx=3)
            fields.append((side, order_type, volume, price))

        action_frame = tk.Frame(dialog)
        action_frame.pack(fill="x", padx=10, pady=10)

        def read_legs():
            legs = []
            for side, order_type, volume, price in fields:
                price_type = order_type.get().lower()
                raw_price = price.get().strip()
                legs.append(
                    {
                        "side": side.get().lower(),
                        "price_type": price_type,
                        "volume": float(volume.get()),
                        "price": None if price_type == "market" else float(raw_price),
                    }
                )
            return legs

        def collect_legs():
            try:
                legs = read_legs()
                for leg in legs:
                    if leg["volume"] <= 0 or not math.isfinite(leg["volume"]):
                        raise ValueError("volume must be positive")
                    if leg["price"] is not None and (not math.isfinite(leg["price"]) or leg["price"] <= 0):
                        raise ValueError("limit/stop price must be positive")
                return legs
            except (TypeError, ValueError) as exc:
                self.batch_status_label.config(text=f"OCO error: {exc}")
                return None

        def stage_oco():
            if not self.client.selected_account or not self.client.current_market_id:
                self.batch_status_label.config(text="Select an account and market first")
                return
            legs = collect_legs()
            if legs is None:
                return
            self.batch_rows.append(
                {
                    "is_oco": True,
                    "account_id": self.client.selected_account,
                    "market_id": self.client.current_market_id,
                    "legs": legs,
                }
            )
            dialog.destroy()
            self._set_batch_status(f"OCO staged ({len(self.batch_rows)} row(s))")

        async def submit_oco():
            if not self.client.selected_account or not self.client.current_market_id:
                self.batch_status_label.config(text="Select an account and market first")
                return
            legs = collect_legs()
            if legs is None:
                return
            try:
                await self.client.submit_oco_order(legs)
                dialog.destroy()
            except Exception as exc:  # noqa: BLE001
                self.batch_status_label.config(text=f"OCO submission failed: {exc}")

        tk.Button(action_frame, text="Add OCO to Batch", command=stage_oco).pack(side="left", padx=4)
        tk.Button(action_frame, text="Submit OCO", command=lambda: asyncio.create_task(submit_oco())).pack(side="left", padx=4)
        tk.Button(action_frame, text="Cancel", command=dialog.destroy).pack(side="right", padx=4)

    #creates this task to actually connect to the client
    async def connect_and_listen(self):
        try:
            await self.client.connect()
        except Exception as exc:
            self.status_label.config(text="Status: Failed to connect", foreground="red")
            print(f"Connection failed: {exc}")
            return
        
        if self.client.running:
            self.status_label.config(text="Status: Connected", foreground="green")
            self.status_icon.itemconfig(1, fill="green")
            self.update_submit_button_state()
            self.populate_accounts()
        else:
            self.status_label.config(text="Status: Failed to connect", foreground="red")
            return
        
        # subscribe only on the first run
        if not self.client._subscribed_once:
            self.client._subscribed_once = True
            await self.get_and_subscribe()

    async def disconnect(self):
        #turns status to red
        self.status_label.config(text="Status:Disconnected", foreground="red")
        self.status_icon.itemconfig(1, fill="red")

        #remove accounts 
        self.account_dropdown.set("Select Account...")
        await self.client.disconnect()
        self.update_submit_button_state()

    def _mark_price_edited(self, _event=None):
        """Remember that the user changed the price for the active market."""
        market_id = self.client.current_market_id
        if market_id:
            self.auto_price_user_edited_market_id = market_id

    def _populate_price_from_first_trade(self, data):
        """Initialize the order price from the first trade seen for a market."""
        price_spinbox = getattr(self, "price_spinbox", None)
        if price_spinbox is None:
            return

        market_id = data.get("market_id") or self.client.current_market_id
        if (
            not market_id
            or self.auto_price_market_id == market_id
            or self.auto_price_user_edited_market_id == market_id
        ):
            return

        raw_price = data.get("last_trade_price")
        if raw_price is None:
            last_trade = data.get("last_trade") or ""
            if "@" in last_trade:
                raw_price = last_trade.rsplit("@", 1)[1]

        try:
            price = float(raw_price)
        except (TypeError, ValueError):
            return
        if not math.isfinite(price):
            return

        price_text = str(raw_price)
        price_spinbox.delete(0, "end")
        price_spinbox.insert(0, price_text)
        self.auto_price_market_id = market_id

    def update_market_ui(self, data):
        self._populate_price_from_first_trade(data)

        # Clear previous widgets
        for widget in self.market_inner.winfo_children():
            widget.destroy()

        # Extract values
        bid_qty, bid_price = data["best_bid"].split("@") if "@" in data["best_bid"] else ("-", "-")
        ask_qty, ask_price = data["best_offer"].split("@") if "@" in data["best_offer"] else ("-", "-")
        last_qty, last_price = data["last_trade"].split("@") if "@" in data["last_trade"] else ("-", "-")

        # Container for alignment
        box_container = tk.Frame(self.market_inner, bg="white")
        box_container.pack(expand=True, fill="both", pady=6)

        # Set up a 3-column grid layout (equal widths so the boxes share the frame
        # evenly and never overflow it).
        box_container.columnconfigure(0, weight=1)
        box_container.columnconfigure(1, weight=1)
        box_container.columnconfigure(2, weight=1)
        box_container.rowconfigure(0, weight=1)

        def create_box(parent, col, title, qty, price, color):
            # Tight padding + a smaller price font keep three boxes readable inside
            # the narrow Market Data frame (it can't grow — Submit sits beside it).
            box = tk.Frame(parent, bg="white", bd=1, relief="solid", padx=8, pady=8)
            box.grid(row=0, column=col, padx=6, sticky="nsew")

            tk.Label(box, text=title, font=("Arial", 11, "bold"), bg="white").pack()
            tk.Label(
                box,
                text=f"{qty}@{price}",
                font=("Arial", 14, "bold"),
                fg=color,
                bg="white"
            ).pack()

        create_box(box_container, 0, "Best Bid", bid_qty, bid_price, "#2563eb")   # Blue
        create_box(box_container, 1, "Best Offer", ask_qty, ask_price, "#dc2626") # Red
        create_box(box_container, 2, "Last Trade", last_qty, last_price, "#16a34a") # Green
    
    def update_market_header_ui(self, title):
        self.market_header_label.config(text=title)

    def populate_accounts(self):
        account_names = [v.account_name for v in self.client.accounts.values()]

        self.account_dropdown['values'] = account_names
        if account_names:
            self.account_dropdown.set(account_names[0])
            asyncio.create_task(self.on_account_selected())
        
    async def on_account_selected(self):
        selected_name = self.account_dropdown.get()

        # Look up the corresponding account ID by name
        for acc_id, acc in self.client.accounts.items():
            full_name = f"{acc.account_name}"
            if full_name == selected_name:
                if self.client.selected_account == acc_id:
                    print("Already subscribed to this account, skipping.")
                    return  # prevent redundant subscription
                await self.client.subscribe_account(acc_id)
                self.client.selected_account = acc_id
                
                print(f"Subscribed to account: {acc_id}")
                
                break

        self.update_submit_button_state()

    async def get_and_subscribe(self):
        await asyncio.sleep(2)

        market_id = await self.client.get_market_id(self.client.md_exchange_id, self.client.md_contract_id)
        await self.client.subscribe_market(self.client.md_exchange_id, self.client.md_contract_id, market_id)

    #opens the contract dialog
    def open_contract_picker(self):
        Contract_Picker_Dialog(master=self.root, client=self.client)

    #opens the expirty dialog
    def open_expiry_picker(self):
        Expiry_Picker_Dialog(master=self.root, client=self.client)

    #opens the walk-forward portfolio study results viewer. Imported lazily and
    #guarded so a missing matplotlib (or the sibling algo-py package) disables the
    #feature gracefully instead of breaking the whole GUI — same pattern as
    #main.py::_start_chart.
    def open_portfolio_study(self):
        try:
            from study.study_window import PortfolioStudyWindow
        except Exception as exc:  # noqa: BLE001
            from tkinter import messagebox
            messagebox.showerror(
                "Portfolio Study unavailable",
                f"Could not open the study viewer: {exc}\n\n"
                "It needs matplotlib installed (pip install matplotlib) and the "
                "algo-py research package alongside PyDemo.",
            )
            return
        PortfolioStudyWindow(self.root, self.client)

    #opens the single-instrument backtester. Same guarded lazy import as the
    #portfolio study so a missing matplotlib / algo-py package degrades to a
    #dialog instead of breaking the GUI.
    def open_backtester(self):
        try:
            from backtest.backtest_window import BacktestWindow
        except Exception as exc:  # noqa: BLE001
            from tkinter import messagebox
            messagebox.showerror(
                "Backtester unavailable",
                f"Could not open the backtester: {exc}\n\n"
                "It needs matplotlib installed (pip install matplotlib).",
            )
            return
        BacktestWindow(self.root, self.client)

    #opens the companion chart window (lightweight-charts) on demand. Previously
    #launched at startup by main.py::_start_chart; now button-triggered. Builds the
    #ChartWindow, chains its market/account callbacks onto the GUI's own handlers so
    #the quote boxes and tables keep updating, exposes it as client.chart_window for
    #the Backtester/Study, and schedules its async run(). Guarded lazy import like
    #the other tool buttons; a re-open guard avoids spawning a second window.
    def open_chart(self):
        existing = getattr(self.client, "chart_window", None)
        if existing is not None and existing._chart_live():
            return  # a chart window is already open

        try:
            from chart.chart_window import ChartWindow
        except Exception as exc:  # noqa: BLE001
            from tkinter import messagebox
            messagebox.showerror(
                "Chart unavailable",
                f"Could not open the chart: {exc}\n\n"
                "It needs lightweight-charts installed (pip install lightweight-charts).",
            )
            return

        config = getattr(self.client, "config", {}) or {}
        chart_cfg = config.get("chart", {}) if isinstance(config, dict) else {}

        loop = self.loop or asyncio.get_event_loop()
        cw = ChartWindow(
            self.client, loop,
            default_interval_seconds=chart_cfg.get("interval_seconds", 60),
            initial_load_days=chart_cfg.get("initial_load_days", 2),
            tz_offset_hours=chart_cfg.get("tz_offset_hours", 0.0),
            target_bars=chart_cfg.get("target_bars", 500),
            max_load_days=chart_cfg.get("max_load_days", 120),
            chunk_days=chart_cfg.get("chunk_days", 1),
            scroll_buffer_days=chart_cfg.get("scroll_buffer_days", 1.0),
            history_floor=chart_cfg.get("history_floor", "2000-01-01"),
        )

        # Chain onto the GUI's OWN handlers (not the current client callbacks) so
        # re-opening after a close never stacks wrappers — each open rebuilds the
        # chain from a single, known base.
        def _mkt(data, _gui=self.update_market_ui, _cw=cw):
            _gui(data)
            _cw.on_market_update(data)

        def _acct(data, _gui=self.handle_account_update, _cw=cw):
            _gui(data)
            _cw.on_account_update(data)

        self.client.on_market_update = _mkt
        self.client.on_account_update = _acct
        # Expose the chart window so other tools (Backtester / Study) can read its
        # already-loaded bars without refetching.
        self.client.chart_window = cw
        asyncio.ensure_future(cw.run(), loop=loop)

    async def on_submit_order(self):
        print("Market ID:", self.client.current_market_id)
        print("Selected Account:", self.client.selected_account)
        print("Market Details:", self.client.market_details.get(self.client.current_market_id))

        print("submit button hit")
        #gets data from front end
        # Retrieve basic inputs
        order_type = self.type_combo.get()               # "Limit" or "Market"
        side = self.side_combo.get()                     # "Buy" or "Sell"
        volume = float(self.volume_spinbox.get())        # e.g., 1 or 1.5
        price = float(self.price_spinbox.get())          # e.g., 100.0

        # Handle optional fields (take profit / stop loss)
        tp_raw = self.take_profit_entry.get().strip()
        sl_raw = self.stop_loss_entry.get().strip()

        take_profit = float(tp_raw) if tp_raw and tp_raw.lower() != "optional" else None
        stop_loss = float(sl_raw) if sl_raw and sl_raw.lower() != "optional" else None
        bracket_mode = self.bracket_mode_combo.get()
        trailing_stop = self.trailing_stop_var.get()

        # Print out all inputs for now
        print(f"[Order Input]")
        print(f"  Type: {order_type}")
        print(f"  Side: {side}")
        print(f"  Volume: {volume}")
        print(f"  Price: {price}")
        print(f"  Take Profit: {take_profit}")
        print(f"  Stop Loss: {stop_loss}")
        print(f"  Bracket Mode: {bracket_mode}")
        print(f"  Trailing Stop: {trailing_stop}")

        #connect to the back end
        await self.client.submit_order(
            side,
            volume,
            price,
            order_type,
            take_profit,
            stop_loss,
            trailing_stop,
            bracket_mode,
        )

    #updates positions ui
    def update_positions_table(self, data):
        #clears the current tree
        for row in self.positions_tree.get_children():
            self.positions_tree.delete(row)

        #loop through the data and display it:
        for pos in data['positions']:
            try:
                market = pos["market_id"]
                net = pos.get("buys", 0) - pos.get("sells", 0)
                pnl = pos.get("total_pnl", 0.0)
                working_buys = pos.get("working_buys", 0)
                working_sells = pos.get("working_sells", 0)
                working =f"{working_buys}/{working_sells}"
                # Determine tag based on P&L
                if pnl > 0:
                    tag = "pnl_positive"
                elif pnl < 0:
                    tag = "pnl_negative"
                else:
                    tag = "pnl_neutral"
                self.positions_tree.insert("", "end", values=(market, net, f"{pnl:.2f}", working), tags = (tag,))
            except Exception as e:
                print(f"[ERROR] Failed to render position row: {e}")

    #updates orders ui
    def update_orders_table(self, orders_list):
        #clear tree
        
        for row in self.orders_tree.get_children():
            self.orders_tree.delete(row)
        for order in orders_list['orders']:
            try:

                iid=order.unique_id
                submit_ts = order.submit_time.seconds
                submit_time = datetime.utcfromtimestamp(submit_ts).strftime("%H:%M:%S")

                # Market
                market = order.market_id

                # Side (buy/sell)

                side = "Buy" if order.buy_sell == 1 else "Sell"

                # Volume
                if order.HasField("new_volume"):
                    volume = order.new_volume.value
                elif order.HasField("current_volume"):
                    volume = order.current_volume.value
                else:
                    volume = "—"

                # Price (handle .value safely)
                if order.HasField("new_limit_price"):
                    price = order.new_limit_price.value
                elif order.HasField("current_limit_price"):
                    price = order.current_limit_price.value
                elif order.HasField("new_stop_price"):
                    price = order.new_stop_price.value
                elif order.HasField("current_stop_price"):
                    price = order.current_stop_price.value
                else:
                    price = "—"

                # Status
                status = order.status

                # Action (you can later add Cancel/Edit buttons here)
                action = "✏️ Edit" if status == 1 else "--"

                # Insert into table
                self.orders_tree.insert("", "end", values=(
                    submit_time, market, side, volume, price, status, action
                ))
            except Exception as e:
                print(f"[ERROR] Failed to render order: {e}")

    def update_submit_button_state(self):
        if self.client.running and self.client.selected_account:
            self.submit_button.config(state="normal")
        else:
            self.submit_button.config(state="disabled")
        self.submit_batch_button.config(
            state=("normal" if self.client.running and self.client.selected_account and self.batch_rows else "disabled")
        )

    def reset_market_ui(self):
       
        for widget in self.market_inner.winfo_children():
            widget.destroy()

        for label_text in [
            "Best Bid: -",
            "Best Offer: -",
            "Last Trade: -"
            ]:
            box_frame = tk.Frame(self.market_inner, bg="#f9f9f9", bd=1, relief="solid", padx=6, pady=4)
            box_frame.pack(anchor="w", pady=2, padx=2, fill="x")
            tk.Label(box_frame, text=label_text, font=("Arial", 12), bg="#f9f9f9").pack(anchor="w")
