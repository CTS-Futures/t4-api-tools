import asyncio
import httpx
import tkinter as tk
from tkinter import ttk, scrolledtext

class Expiry_Picker:
    def __init__(self, client, exchange_id, contract_id):
        self.client = client
        self.exchange_id = exchange_id
        self.contract_id = contract_id
        self.groups_cache = {}
        self.markets_cache = {}
        self.expanded_groups = set()
        self.selected_expiry = None
        self.on_expiry_selected = None


        self.api_key = getattr(client, "apiKey", None)
        self.api_url = getattr(client, "apiUrl", None)

        self.dialog = None
        self.groups_list = None
        self.loading_indicator = None


    async def load_groups(self):
        
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
              
                response = await rest.get(f'{self.api_url}/markets/picker/groups?exchangeid={self.exchange_id}&contractid={self.contract_id}', headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                
                #get the  groups
                groups = response.json()
                
                self.groups_cache['root'] = groups
                
                return groups
            
        except Exception as e:
            print("load groups in expirty error", e)


    async def load_markets_for_groups(self, strategy_type, expiry_date):
        cache_key = f'{strategy_type}_{expiry_date or 'None'}'

        if cache_key in self.markets_cache:
            return self.markets_cache[cache_key]
        
        try:
            headers = {'Content-Type': 'application/json'}

            if self.api_key:
                headers['Authorization'] = f'APIKey {self.api_key}'
            else:
                token = await self.client.get_auth_token()
                if token:
                    headers['Authorization'] = f'Bearer {token}'
            
            
            url = f'{self.api_url}/markets/picker?exchangeid={self.exchange_id}&contractid={self.contract_id}&strategytype={strategy_type}'


            # Only include expirydate if strategytype is not "None"
            if strategy_type != 'None' and expiry_date:
                url += f'&expirydate={expiry_date}'

            async with httpx.AsyncClient() as rest:
                
                response = await rest.get(url, headers=headers)
               
                if not response.status_code == 200:
                        print('lmfg - error inside')
                        return
                markets = response.json()

                self.markets_cache[cache_key] = markets
                return markets
                
                
        except Exception as e:
            print("error: contracts for exchanges", e)
            return []
    async def get_auth_token(self):
        if (self.client and self.client.get_auth_token):
            return await self.client.get_auth_token()
        
        return None
