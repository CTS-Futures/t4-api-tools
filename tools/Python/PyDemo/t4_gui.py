import asyncio
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client


class T4_GUI(tk.Tk):

    def __init__(self, root, client):
        self.root = root
        self.client = client
        self.root.title("T4 API Demo")
        self.root.geometry("1000x750")

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
        self.main_frame = tk.Frame(self.root, bg="white")
        self.main_frame.place(relx=0.05, rely=0.25, relwidth=0.9, relheight=0.7)


        #
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

    async def disconnect(self):
        
        await self.client.disconnect()

        

        #turns status to red
        self.status_label.config(text="Status:Disconnected", foreground="red")
        self.status_icon.itemconfig(1, fill="red")

        #remove accounts 
        self.account_dropdown.set("Select Account...")

    def populate_accounts(self):
        account_names = [v.account_name for v in self.client.accounts.values()]
        print([type(v) for v in self.client.accounts.values()])

        self.account_dropdown['values'] = account_names
        if account_names:
            self.account_dropdown.set(account_names[0])
        print("here")
        print(account_names)
