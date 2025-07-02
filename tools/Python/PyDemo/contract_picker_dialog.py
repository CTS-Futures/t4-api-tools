import asyncio
import tkinter as tk
from tkinter import ttk
from contract_picker import Contract_Picker

class Contract_Picker_Dialog(tk.Toplevel):

    def __init__(self, master=None, client=None , on_contract_selected=None):
        super().__init__(master)
       
        #creates the pop up window
       
        self.title("Select a Contract")
        self.geometry("500x600")
        self.transient(master) #ensures its on top of the root
        self.grab_set() #locks user to the pop up
        
        self.client = client
        self.contract_picker = Contract_Picker(self.client)

        self.selected_contract = None
        self.selected_contract_meta = None

    
        self.is_search_mode = None
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", lambda *_: asyncio.create_task(self.render_search_results(self.search_var.get())))


        self.build_ui()
        asyncio.create_task(self.load_and_render_exchanges())

          
        

    def build_ui(self):
        tk.Label(self, text="Search contracts:").pack(padx=10, pady=(10, 0), anchor='w')
        tk.Entry(self, textvariable=self.search_var).pack(fill="x", padx=10)

        self.tree = ttk.Treeview(self)
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)
        self.tree.bind("<<TreeviewOpen>>", self.on_expand)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        #button frame
        btn_frame = tk.Frame(self)
        btn_frame.pack(fill="x", padx=10, pady=10)
        tk.Button(btn_frame, text="Cancel", command=self.destroy).pack(side="right")
        #confirm button
        self.select_btn = tk.Button(btn_frame, text="Select", command=self.confirm_selection, state="disabled")
        self.select_btn.pack(side="right", padx=5)

    
    #displays all exchnages 
    def render_exchanges(self, filter_text=""):
        self.tree.delete(*self.tree.get_children())
        for ex in self.contract_picker.exchanges:
            eid = ex.get("exchangeId", "")
            desc = ex.get("description", "")
            if not eid or not desc:
                continue

            if filter_text.lower() in desc.lower():
                #Add dummy child so the item can be expanded
                self.tree.insert("", "end", iid=eid, text=desc, values=("exchange", eid))
                self.tree.insert(eid, "end")  # dummy child
    
    #loads search results
    async def render_search_results(self, search_term):
        if len(search_term) < 2:
            await self.load_and_render_exchanges()
            return
        self.tree.delete(*self.tree.get_children())
        try:
            results = await self.contract_picker.handle_search(search_term) #calls search function from contract picker
            if not results:
                print("no search results")
            else: # try to display all the results
                grouped = {}

                #loop through results to group them for easy ui display
                for contract in results:
                    exchange_id = contract["exchangeID"]

                    if exchange_id not in grouped: # initialize dictionary key
                        grouped[exchange_id] = []
                    
                    grouped[exchange_id].append(contract)

                #display the grouped results
                for exchange_id, contracts in grouped.items():
                    # Insert exchangeID as the group label
                    parent_id = self.tree.insert(
                        "", "end", text=f"Exchange: {exchange_id}",
                        values=("exchange", exchange_id), open=True
                    )

                    # Add contracts under each exchange
                    for contract in contracts:
                        label = f"{contract.get('description', '')} ({contract.get('contractID', '')})"
                        self.tree.insert(
                            parent_id, "end", text=label,
                            values=("contract", contract.get("exchangeID", ""), contract.get("contractID", ""), contract.get("contractType", ""))
                        )


        except Exception as e:
            print("render search problem, ", e)
    def on_search(self):
        # TODO: implement search logic (if needed)
        filter_text = self.search_var.get().strip().lower()
        self.render_exchanges(filter_text)
        asyncio.create_task(self.search_and_render_results(filter_text))
    def on_select(self, event):
        selected = self.tree.selection()
        if not selected:
            return

        item_id = selected[0]
        values = self.tree.item(item_id, "values")

        if values and values[0] == "contract":
            self.selected_contract = self.tree.item(item_id, "text")
            self.selected_contract_meta = {
                "exchangeId": values[1],
                "contractId": values[2],
                "contractType": values[3],
            }
            self.select_btn.config(state="normal")
        else:
            self.selected_contract = None
            self.select_btn.config(state="disabled")

    #once hte user confirms the selection, it'll remove the dialog
    def confirm_selection(self):
        self.destroy()
        print(self.selected_contract_meta)
        
        asyncio.create_task(
            self.contract_picker.on_contract_selected(
                self.selected_contract_meta['exchangeId'],
                self.selected_contract_meta['contractId']
            )
        )
                    

    #button to expand market
    def on_expand(self, event):
        item_id = self.tree.focus()
        values = self.tree.item(item_id, "values")
        if values and values[0] == "exchange":
            if self.tree.get_children(item_id):
                for child in self.tree.get_children(item_id):
                    self.tree.delete(child)
                    exchange_id = values[1]
                    asyncio.create_task(self.expand_contracts(item_id, exchange_id))

    #loads all of the contracts for a particular exchange
    async def expand_contracts(self, parent_id, exchange_id):
        try:
            contracts = await self.contract_picker.load_contracts_for_exchanges(exchange_id)
            if not contracts:
                print(f"No contracts found for exchange {exchange_id}")
                return

            for contract in contracts:
                name = f"{contract.get('description', '')} ({contract.get('contractID', '')})"
                self.tree.insert(
                    parent_id, "end", text=name,
                    values=("contract", exchange_id, contract.get("contractID"), contract.get("contractType"))
                )
        except Exception as e:
            print(f"Failed to load contracts for {exchange_id}: {e}")
                
    async def load_and_render_exchanges(self):
        await self.contract_picker.load_exchanges()
        self.render_exchanges()


        