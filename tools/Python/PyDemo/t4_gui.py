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
        self.status_label = ttk.Label(self.root, text="Status: Disconnected", font=("Arial", 12))
        self.status_label.pack(pady=10)

        self.connect_button = ttk.Button(self.root, text="Connect", command=self.start_connection)
        self.connect_button.pack(pady=10)

        self.accounts_box = tk.Listbox(self.root, width=50)
        self.accounts_box.pack(pady=10)

    def start_connection(self):
        self.status_label.config(text="Status: Connecting...")
        asyncio.create_task(self.connect_and_listen())

    async def connect_and_listen(self):
        await self.client.connect()
        print(self.client.running)
        if self.client.running:
            self.status_label.config(text="Status: Connected", foreground="green")
            self.populate_accounts()
        else:
            self.status_label.config(text="Status: Failed to connect", foreground="red")

