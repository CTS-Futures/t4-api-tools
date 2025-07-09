import asyncio
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client
from datetime import datetime
from contract_picker_dialog import Contract_Picker_Dialog
from expiry_picker_dialog import Expiry_Picker_Dialog
from contract_picker import Contract_Picker
class T4_GUI(tk.Tk):

    def __init__(self, root, client):
        self.root = root
        self.client = client
        self.root.title("T4 API Demo")
        self.root.geometry("1350x1180")

        self.client.on_market_update = self.update_market_ui
        self.client.market_header_update = self.update_market_header_ui
        self.client.on_market_switch = self.reset_market_ui
        self.client._subscribed_once = False
        self.client.on_account_update = self.handle_account_update
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


        #market frame
        self.market_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.market_frame.place(relx=0.05, rely=0.25, relwidth=0.44, relheight=0.3)

        #allows for resizing
        self.market_frame.columnconfigure(0, weight=1)
        self.market_frame.rowconfigure(2, weight=1)

        #container for data. ensures things are touching the borders (padx and pady)
        market_container = tk.Frame(self.market_frame, bg="white", padx=20, pady=20)
        market_container.grid(row=0, column=0, sticky="nsew")

        market_title = tk.Label(market_container, text="Market Data", font=("Arial", 16, "bold"), bg="white")
        market_title.grid(row=0, column=0, sticky="w", pady=(0, 10))
        
        tk.Button(
            self.market_frame,
            text="Pick a Contract",
            command=self.open_contract_picker
        ).grid(row=5, column=0, pady=10)

        #expiry button
        tk.Button(
            self.market_frame,
            text="Expiry",
            command = self.open_expiry_picker
        ).grid(row = 6, column = 0, pady= 5)
        # market header 
        self.market_header_label = tk.Label(market_container, text="...", font=("Arial", 14), bg="white", fg="#3b82f6")
        self.market_header_label.grid(row=0, column=1, sticky="e", padx=(10, 0), pady=(0, 10))


        separator = tk.Frame(market_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, sticky="ew", pady=(0, 10))

        #we will put the dynamic changing ui within this frame. (the same pattern for the following three big frames)
        self.market_inner = tk.Frame(market_container, bg="#f9f9f9")
        self.market_inner.grid(row=2, column=0, sticky="nsew")


        #Submit frame
        self.submit_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.submit_frame.place(relx=0.51, rely=0.25, relwidth=0.44, relheight=0.3)

        submit_container = tk.Frame(self.submit_frame, bg="white", padx=20, pady=20)
        submit_container.pack(fill="both", expand=True)

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

        # Volume (Spinbox)
        tk.Label(submit_container, text="Volume:", font=("Arial", 12, "bold"), bg="white").grid(row=4, column=0, sticky="w", pady=(10, 0))
        self.volume_spinbox = tk.Spinbox(submit_container, from_=1, to=99999)
        self.volume_spinbox.delete(0, "end")
        self.volume_spinbox.insert(0, "1")
        self.volume_spinbox.grid(row=5, column=0, sticky="ew", padx=(0, 10))

        # Price (Spinbox)
        tk.Label(submit_container, text="Price:", font=("Arial", 12, "bold"), bg="white").grid(row=4, column=1, sticky="w", pady=(10, 0))
        self.price_spinbox = tk.Spinbox(submit_container, from_=0.01, to=99999.99, increment=0.01)
        self.price_spinbox.delete(0, "end")
        self.price_spinbox.insert(0, "100")
        self.price_spinbox.grid(row=5, column=1, sticky="ew")

        # Take Profit
        tk.Label(submit_container, text="Take Profit ($):", font=("Arial", 12, "bold"), bg="white").grid(row=6, column=0, sticky="w", pady=(10, 0))
        self.take_profit_entry = tk.Entry(submit_container)
        self.take_profit_entry.insert(0, "Optional")
        self.take_profit_entry.grid(row=7, column=0, sticky="ew", padx=(0, 10))

        # Stop Loss
        tk.Label(submit_container, text="Stop Loss ($):", font=("Arial", 12, "bold"), bg="white").grid(row=6, column=1, sticky="w", pady=(10, 0))
        self.stop_loss_entry = tk.Entry(submit_container)
        self.stop_loss_entry.insert(0, "Optional")
        self.stop_loss_entry.grid(row=7, column=1, sticky="ew")

        # Submit Button
        self.submit_button = tk.Button(submit_container, text="Submit Order", bg="#3b82f6", fg="white", font=("Arial", 12, "bold"), command=lambda:asyncio.create_task(self.on_submit_order()), state="disabled")
        self.submit_button.grid(row=8, column=0, columnspan=2, pady=20, sticky="ew")

        #positions frame
        self.positions_frame = tk.Frame(self.root, bg="white", bd=1, relief="groove")
        self.positions_frame.place(relx=0.05, rely=0.60, relwidth=0.44, relheight=0.3)

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
        self.orders_frame.place(relx=0.51, rely=0.60, relwidth=0.44, relheight=0.3)

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
        vol_entry = ttk.Spinbox(volume_frame, from_=1, to=9999, width=25)
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
    def on_order_action_click(self, event):
        item_id = self.orders_tree.identify_row(event.y)
        column = self.orders_tree.identify_column(event.x)

        if not item_id or not column:
            return

        col_index = int(column.replace('#', '')) - 1
        values = self.orders_tree.item(item_id, 'values')
        unique_id = item_id
        print(unique_id)
        if col_index == 6:
            action_value = values[col_index]
            if "✏️ Edit" in action_value:
                self.show_edit_dialog(unique_id, values)
            
    async def confirm_revise(self, unique_id, volume, price_entry, dialog):
        dialog.destroy()
        await self.client.revise_order(unique_id, int(volume), int(price_entry), 'limit')

    async def confirm_pull(self, unique_id, dialog):
        dialog.destroy()
        await self.client.pull_order(unique_id)
        

    #command for when the button is pressed
    def start_connection(self):
        self.status_label.config(text="Status: Connecting...")
        asyncio.create_task(self.connect_and_listen())
    
    def end_connection(self):
        self.status_label.config(text="Status: Disconnecting...", foreground="red")
        asyncio.create_task(self.disconnect())

    def handle_account_update(self, update):
        update_type = update.get("type")
        print(update)
        if update_type == "accounts":
            self.populate_accounts()
        elif update_type == "positions":
            # TODO: add this when i implement positions table
            self.update_positions_table(update)
           
        elif update_type == "orders":
            # TODO: add this when i implement orders table
          
            self.update_orders_table(update)
    #creates this task to actually connect to the client
    async def connect_and_listen(self):
        await self.client.connect()
        print(self.client.running)
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

    def update_market_ui(self, data):
        #print("Market update received in GUI:", data)

        # Example: dynamically create labels or update existing ones in self.market_inner
        for widget in self.market_inner.winfo_children():
            widget.destroy()  # clear old labels


        for label_text in [
        f"Best Bid: {data['best_bid']}",
        f"Best Offer: {data['best_offer']}",
        f"Last Trade: {data['last_trade']}"
    ]:
            box_frame = tk.Frame(self.market_inner, bg="#f9f9f9", bd=1, relief="solid", padx=6, pady=4)
            box_frame.pack(anchor="w", pady=2, padx=2, fill="x")
    
            tk.Label(box_frame, text=label_text, font=("Arial", 12), bg="#f9f9f9").pack(anchor="w")
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
        #will be adding subscribe next

    def open_contract_picker(self):
        Contract_Picker_Dialog(master=self.root, client=self.client)

    def open_expiry_picker(self):
        Expiry_Picker_Dialog(master=self.root, client=self.client)
    async def on_submit_order(self):
        print("Market ID:", self.client.current_market_id)
        print("Selected Account:", self.client.selected_account)
        print("Market Details:", self.client.market_details.get(self.client.current_market_id))

        print("submit button hit")
        #gets data from front end
        # Retrieve basic inputs
        order_type = self.type_combo.get()               # "Limit" or "Market"
        side = self.side_combo.get()                     # "Buy" or "Sell"
        volume = int(self.volume_spinbox.get())          # e.g., 1
        price = float(self.price_spinbox.get())          # e.g., 100.0

        # Handle optional fields (take profit / stop loss)
        tp_raw = self.take_profit_entry.get().strip()
        sl_raw = self.stop_loss_entry.get().strip()

        take_profit = float(tp_raw) if tp_raw and tp_raw.lower() != "optional" else None
        stop_loss = float(sl_raw) if sl_raw and sl_raw.lower() != "optional" else None

        # Print out all inputs for now
        print(f"[Order Input]")
        print(f"  Type: {order_type}")
        print(f"  Side: {side}")
        print(f"  Volume: {volume}")
        print(f"  Price: {price}")
        print(f"  Take Profit: {take_profit}")
        print(f"  Stop Loss: {stop_loss}")

        #connect to the back end
        await self.client.submit_order(side, volume, price, order_type, take_profit, stop_loss)



    def update_positions_table(self, data):
        #clears the current tree
        for row in self.positions_tree.get_children():
            self.positions_tree.delete(row)

        #loop through the data and display it:
        for pos in data['positions']:
            try:
                market = pos.market_id
                net = getattr(pos, "net_position", 0)  # Default to 0 if not present
                pnl = getattr(pos, "pnl", 0.0)  # You may compute this if not in proto
                working_buys = getattr(pos, "working_buys", 0)
                working_sells = getattr(pos, "working_sells", 0) if hasattr(pos, "working_sells") else 0
                working = f"{working_buys}/{working_sells}"

                self.positions_tree.insert("", "end", values=(market, net, f"{pnl:.2f}", working))
            except Exception as e:
                print(f"[ERROR] Failed to render position row: {e}")
    def update_orders_table(self, orders_list):
        #clear tree
        
        for row in self.orders_tree.get_children():
            self.orders_tree.delete(row)
        for order in orders_list['orders']:
            try:
                print("here")

                print(orders_list)
                print('here')
                iid=order.unique_id
                print(iid)
                submit_ts = order.submit_time.seconds
                submit_time = datetime.utcfromtimestamp(submit_ts).strftime("%H:%M:%S")

                # Market
                market = order.market_id

                # Side (buy/sell)

                side = "Buy" if order.buy_sell == 1 else "Sell"

                # Volume
                volume = order.new_volume if order.new_volume else order.current_volume

                # Price (handle .value safely)
                price = order.new_limit_price.value if order.HasField("new_limit_price") else "—"

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
