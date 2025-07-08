import asyncio
import tkinter as tk
from tkinter import ttk
from expiry_picker import Expiry_Picker


class Expiry_Picker_Dialog(tk.Toplevel):

    def __init__(self, master=None, client=None, on_select=None):
        super().__init__(master)
        self.title("Select Expiry")
        self.geometry("500x600")
        self.transient(master)
        self.grab_set()

        self.on_select_callback = on_select
        self.client = client
        self.exchange_id = self.client.md_exchange_id
        self.contract_id = self.client.md_contract_id
        self.expiry_picker = Expiry_Picker(client, self.exchange_id, self.contract_id)
        self.selected_item = None

        self.build_ui()
        asyncio.create_task(self.load_and_render_groups())

    def build_ui(self):
        # Title
        tk.Label(self, text="Select Expiry", font=("Segoe UI", 12, "bold")).pack(
            anchor="w", padx=10, pady=(10, 5)
        )

        # Treeview frame with scrollbar
        tree_container = tk.Frame(self)
        tree_container.pack(fill="both", expand=True, padx=10, pady=(0, 0))

        tree_scrollbar = tk.Scrollbar(tree_container)
        tree_scrollbar.pack(side="right", fill="y")

        self.tree = ttk.Treeview(tree_container, yscrollcommand=tree_scrollbar.set)
        self.tree.pack(fill="both", expand=True)
        tree_scrollbar.config(command=self.tree.yview)

        self.tree.bind("<<TreeviewOpen>>", self.on_expand)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        # Fixed bottom button bar
        separator = ttk.Separator(self, orient="horizontal")
        separator.pack(fill="x", pady=(5, 0))

        btn_frame = tk.Frame(self)
        btn_frame.pack(fill="x", padx=10, pady=10)

        tk.Button(btn_frame, text="Cancel", command=self.destroy).pack(side="right")
        self.select_btn = tk.Button(
            btn_frame, text="Select", command=self.confirm_selection, state="disabled"
        )
        self.select_btn.pack(side="right", padx=5)
    async def load_and_render_groups(self):
        groups = await self.expiry_picker.load_groups()
        if not groups:
            return

        self.tree.delete(*self.tree.get_children())

        for group in groups:
            strategy = group.get("strategyType")
            expiry = group.get("expiryDate", "")
            label = self.expiry_picker.get_strategy_display_name(strategy)
            node_id = f"{strategy}_{expiry or 'none'}"
            parent_id = self.tree.insert("", "end", iid=node_id, text=label, values=("group", strategy, expiry))
            self.tree.insert(parent_id, "end")  # Dummy child for expansion
    def on_expand(self, event):
        item_id = self.tree.focus()
        values = self.tree.item(item_id, "values")
        if values and values[0] == "group":
            self.tree.delete(*self.tree.get_children(item_id))
            strategy, expiry = values[1], values[2]
            asyncio.create_task(self.load_and_render_markets(item_id, strategy, expiry))
    
    async def load_and_render_markets(self, parent_id, strategy, expiry):
        markets = await self.expiry_picker.load_markets_for_groups(strategy, expiry)
        if not markets:
            return

        for m in markets:
            label = m.get("description", m.get("marketID", ""))
            self.tree.insert(
                parent_id, "end", text=label,
                values=("market", m.get("marketID"), m.get("expiryDate"), m.get("description"))
            )

    def on_select(self, event):
        selected = self.tree.selection()
        if not selected:
            return
        item_id = selected[0]
        values = self.tree.item(item_id, "values")

        if values and values[0] == "market":
            self.selected_expiry = {
                "marketId": values[1],
                "expiryDate": values[2],
                "description": values[3],
                "exchangeId": self.exchange_id,
                "contractId": self.contract_id
            }
            print(self.selected_expiry)
            self.select_btn.config(state="normal")
        else:
            self.selected_expiry = None
            self.select_btn.config(state="disabled")

    def confirm_selection(self):
        self.destroy()
        market_id = self.selected_expiry["marketId"]
        asyncio.create_task(self.expiry_picker.on_expiry_selection(self.exchange_id, self.contract_id, market_id))