import asyncio
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client
from contract_picker_dialog import Contract_Picker_Dialog
from contract_picker import Contract_Picker
class T4_GUI(tk.Tk):

    def __init__(self, root, client):
        self.root = root
        self.client = client
        self.root.title("T4 API Demo")
        self.root.geometry("1250x1080")

        self.client.on_market_update = self.update_market_ui
        self.client.market_header_update = self.update_market_header_ui
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
        self.account_dropdown.set("Select Account...")
        self.account_dropdown.grid(row=3, column=1, padx=10, sticky="w")

        #connect Button
        self.connect_button = tk.Button(self.connect_frame, text="Connect", bg="#6b7280", fg="white", command=self.start_connection)
        self.connect_button.grid(row=3, column=2, padx=(10, 5))

        #disconnect Button
        self.disconnect_button = tk.Button(self.connect_frame, text="Disconnect", bg="#3b82f6", fg="white", command=self.end_connection)
        self.disconnect_button.grid(row=3, column=3, padx=5)

        # --- Main Content Frame ---
        # self.main_frame = tk.Frame(self.root, bg="white")
        # self.main_frame.place(relx=0.05, rely=0.25, relwidth=0.9, relheight=0.7)


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

        self.submit_frame.columnconfigure(0, weight=1)
        self.submit_frame.rowconfigure(2, weight=1)

        submit_container = tk.Frame(self.submit_frame, bg="white", padx=20, pady=20)
        submit_container.grid(row=0, column=0, sticky="nsew")

        submit_title = tk.Label(submit_container, text="Submit Order", font=("Arial", 16, "bold"), bg="white")
        submit_title.grid(row=0, column=0, sticky="w", pady=(0, 10))

        separator = tk.Frame(submit_container, height=2, bg="#3b82f6", bd=0)
        separator.grid(row=1, column=0, sticky="ew", pady=(0, 10))

        self.submit_inner = tk.Frame(submit_container, bg="#f9f9f9")
        self.submit_inner.grid(row=2, column=0, sticky="nsew")


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


    #command for when the button is pressed
    def start_connection(self):
        self.status_label.config(text="Status: Connecting...")
        asyncio.create_task(self.connect_and_listen())
    
    def end_connection(self):
        self.status_label.config(text="Status: Disconnecting...", foreground="red")
        asyncio.create_task(self.disconnect())

    #creates this task to actually connect to the client
    async def connect_and_listen(self):
        await self.client.connect()
        print(self.client.running)
        if self.client.running:
            self.status_label.config(text="Status: Connected", foreground="green")
            self.status_icon.itemconfig(1, fill="green")
            self.populate_accounts()
        else:
            self.status_label.config(text="Status: Failed to connect", foreground="red")
            return
        
        await self.get_and_subscribe()

    async def disconnect(self):
        #turns status to red
        self.status_label.config(text="Status:Disconnected", foreground="red")
        self.status_icon.itemconfig(1, fill="red")

        #remove accounts 
        self.account_dropdown.set("Select Account...")
        await self.client.disconnect()

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
     #   print([type(v) for v in self.client.accounts.values()])

        self.account_dropdown['values'] = account_names
        if account_names:
            self.account_dropdown.set(account_names[0])
        #print("here")
       # print(account_names)

    async def get_and_subscribe(self):
        await asyncio.sleep(2)

        await self.client.get_market_id(self.client.md_exchange_id, self.client.md_contract_id)
        await self.client.subscribe_market(self.client.md_exchange_id, self.client.md_contract_id, self.client.current_market_id)
        #will be adding subscribe next

    def open_contract_picker(self):
        Contract_Picker_Dialog(self.root, self.contract_picker)
