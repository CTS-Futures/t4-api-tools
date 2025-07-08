import asyncio
import tkinter as tk
from tkinter import ttk
#from contract_picker import


class Expiry_Picker_Dialog(tk.Toplevel):

    def __init__(self, master=None, client=None, on_select=None):
        super().__init__(master)
        self.title("Select Expiry")
        self.geometry("400x300")
        self.transient(master)
        self.grab_set()

        self.on_select_callback = on_select
        self.client = client
        self.selected_item = None

        self.build_ui()

    def build_ui(self):
        # Label
        tk.Label(self, text="Select Expiry", font=("Segoe UI", 12, "bold")).pack(
            anchor="w", padx=10, pady=(10, 5)
        )

        # Treeview frame
        tree_frame = tk.Frame(self)
        tree_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.tree = ttk.Treeview(tree_frame)
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_select_item)

        # Insert two top-level nodes with dummy children
        self.outright_id = self.tree.insert("", "end", text="Outright", open=False)
        self.spread_id = self.tree.insert("", "end", text="Calendar Spread", open=False)

        # Dummy example items — replace with real data later
        self.tree.insert(self.outright_id, "end", text="(U25)", values=("U25",))
        self.tree.insert(self.spread_id, "end", text="(U25-V25)", values=("U25-V25",))

        # Button row
        btn_frame = tk.Frame(self)
        btn_frame.pack(fill="x", padx=10, pady=10)

        tk.Button(btn_frame, text="Cancel", command=self.destroy).pack(side="right")
        self.select_btn = tk.Button(
            btn_frame, text="Select", command=self.confirm_selection, state="disabled"
        )
        self.select_btn.pack(side="right", padx=5)

    def on_select_item(self, event):
        selected = self.tree.selection()
        if selected:
            item_id = selected[0]
            parent = self.tree.parent(item_id)
            # Only allow selection of leaf nodes
            if parent:
                self.selected_item = self.tree.item(item_id, "text")
                self.select_btn.config(state="normal")
            else:
                self.selected_item = None
                self.select_btn.config(state="disabled")

    def confirm_selection(self):
        if self.on_select_callback and self.selected_item:
            self.on_select_callback(self.selected_item)
        self.destroy()