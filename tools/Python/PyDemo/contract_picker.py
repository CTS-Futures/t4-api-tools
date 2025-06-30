import asyncio
import httpx
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client

class Contract_Picker:
    def __init__(self, parent, client):
        #caches and storage
        self.exchanges = []
        self.contract_caches = {}
        self.expanded_exchanges = set()
        self.selected_contract = None
        self.is_search_mode = False
        self.on_contract_selected = None

       
        #api authorization
        self.api_key = client.apiKey
        self.api_url = client.apiUrl


        #loading and menus
        self.dialog = None
        self.search_input = None
        self.exchanges_list = None
        self.loading_indicator = None
    
    async def load_exchanges(self):
        self.show_loading(True)
        try:
            headers = {'Content-Type': 'application/json'}

            if self.api_key: #try to access using the api key
                headers['Authorization'] = f'APIKey {self.api_key}'
            else: #try to access using the token
                #renew token 
                token = await self.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {token}'

            #gets a rest api call
            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.apiUrl}/markets/exchanges'
                                        , headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                
                #get the marketid.
                data = response.json()
                self.exchanges = data
                self.exchanges.sort(key=lambda x: x.description.lower())
               
                #call a function to render the exchanges

        except Exception as e:
            print("error outside", e)
        finally:
            self.show_loading(False)

    async def load_contracts_for_exchanges(self, exchange_id):
        #edge case: if we already have the info, then skip
        if self.contracts_cache.has(exchange_id):
            return self.contract_caches.get(exchange_id)
        

        try:
            headers = {'Content-Type': 'application/json'}

            if self.api_key:
                headers['Authorization'] = f'APIKey {self.api_key}'
            else:
                token = await self.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {self.api_url}'

            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.apiUrl}/markets/contracts?exchangeid={exchange_id}'
                                        , headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                contracts = response.json()
                
                #alphabetize contractss
                contracts.sort(key=lambda x: x.description.lower())

                #store contracts in the cache
                self.contract_caches[exchange_id] = contracts


                return contracts
        except Exception as e:
            print("error: contracts for exchanges", e)
            return []

                
    
    def show_loading(self, show):
        #changes whether or not we want to show a loading screen
        if self.loading_indicator:
            pass # function to show or remove the loading screen
    
    async def get_auth_token(self):
        if (Client and Client.get_auth_token):
            return await Client.get_auth_token()
        
        return None