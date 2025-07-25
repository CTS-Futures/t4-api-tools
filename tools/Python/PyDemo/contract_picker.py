import asyncio
import httpx
import tkinter as tk
from tkinter import ttk, scrolledtext
from T4APIClient import Client

class Contract_Picker:
    def __init__(self, client):
        #caches and storage
        self.exchanges = []
        self.contract_caches = {}
        self.expanded_exchanges = set()
        self.selected_contract = None
        self.is_search_mode = False
       
        #api authorization
        self.client = client
        self.api_key = getattr(client, "apiKey", None)
        self.api_url = getattr(client, "apiUrl", None)
        
        #loading and menus
        self.dialog = None
        self.search_input = None
        self.exchanges_list = None
        self.loading_indicator = None
    
    #api calls for loading exchanges
    async def load_exchanges(self):
        self.show_loading(True)
        try:
            headers = {'Content-Type': 'application/json'}

            if self.api_key: #try to access using the api key
                headers['Authorization'] = f'APIKey {self.api_key}'
            else: #try to access using the token
                #renew token 
                token = await self.client.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {token}'

            #gets a rest api call
            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.api_url}/markets/exchanges'
                                        , headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                
                #get the marketid.
                data = response.json()
                
                self.exchanges = data
                
                self.exchanges.sort(key=lambda x: x["description"].lower())
               
                return self.exchanges

        except Exception as e:
            print("error outside", e)
        finally:
            self.show_loading(False)

    #api calls for exchanges
    async def load_contracts_for_exchanges(self, exchange_id):
        #edge case: if we already have the info, then skip
        if exchange_id in self.contract_caches:
            return self.contract_caches.get(exchange_id)
        

        try:
            headers = {'Content-Type': 'application/json'}

            if self.api_key:
                headers['Authorization'] = f'APIKey {self.api_key}'
            else:
                token = await self.client.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {token}'

            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.api_url}/markets/contracts?exchangeid={exchange_id}'
                                        , headers=headers)
                #check if the response is valid
                
                
                if not response.status_code == 200:
                     print('error inside')
                     return
                contracts = response.json()
                
                #alphabetize contractss
                contracts.sort(key=lambda x: x["description"].lower())

                #store contracts in the cache
                self.contract_caches[exchange_id] = contracts


                return contracts
        except Exception as e:
            print("error: contracts for exchanges", e)
            return []

    async def handle_search(self, search_term):
        search_term = search_term.strip().lower()
        
        #api call to get contracts and markets based off search term
        try:
            #headers is the information that must be sent to the rest url
            headers = {'Content-Type': 'application/json'}

            #if api_key is available then we use it
            if self.api_key:
                headers['Authorization'] = f'APIKey {self.api_key}'
            else: #otherwise we check use a token and make sure it's not expired
                token = await self.client.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {token}'

            #makes the api call
            async with httpx.AsyncClient() as rest:
            
                response = await rest.get(f'{self.api_url}/markets/contracts/search?search={search_term}'
                                        , headers=headers)
                
                #check if the response is valid
                if not response.status_code == 200:
                    print('error inside')
                    return
                search_results = response.json()
                
                #alphabetize results
                search_results.sort(key=lambda x: x["description"].lower())
                print(search_results)

                return search_results

        except Exception as e:
            print("search error, ", e)
    
    def show_loading(self, show):
        #changes whether or not we want to show a loading screen
        if self.loading_indicator:
            pass # function to show or remove the loading screen

    #subscribes to the selected contract
    async def on_contract_selected(self, exchange_id, contract_id):
        
        market_id = await self.client.get_market_id(exchange_id, contract_id)
        await self.client.subscribe_market(exchange_id, contract_id, market_id)
       

    async def get_auth_token(self):
        if (Client and Client.get_auth_token):
            return await Client.get_auth_token()
        
        return None