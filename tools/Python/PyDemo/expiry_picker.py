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

    #rest calls to get groups
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

    #rest call to load the markets for the groups
    async def load_markets_for_groups(self, strategy_type, expiry_date):
        #uses a cache so that we don't have to do an api call every time
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
        
    def get_strategy_display_name(self, strategy_type):
        strategy_type_map = {
            "None": "Outright",
            "CalendarSpread": "Calendar Spread",
            "RtCalendarSpread": "RT Calendar Spread",
            "InterContractSpread": "Inter Contract Spread",
            "Butterfly": "Butterfly",
            "Condor": "Condor",
            "DoubleButterfly": "Double Butterfly",
            "Horizontal": "Horizontal",
            "Bundle": "Bundle",
            "MonthVsPack": "Month vs Pack",
            "Pack": "Pack",
            "PackSpread": "Pack Spread",
            "PackButterfly": "Pack Butterfly",
            "BundleSpread": "Bundle Spread",
            "Strip": "Strip",
            "Crack": "Crack",
            "TreasurySpread": "Treasury Spread",
            "Crush": "Crush",
            "ThreeWay": "Three Way",
            "ThreeWayStraddleVsCall": "Three Way Straddle vs Call",
            "ThreeWayStraddleVsPut": "Three Way Straddle vs Put",
            "Box": "Box",
            "XmasTree": "Christmas Tree",
            "ConditionalCurve": "Conditional Curve",
            "Double": "Double",
            "HorizontalStraddle": "Horizontal Straddle",
            "IronCondor": "Iron Condor",
            "Ratio1X2": "Ratio 1x2",
            "Ratio1X3": "Ratio 1x3",
            "Ratio2X3": "Ratio 2x3",
            "RiskReversal": "Risk Reversal",
            "StraddleStrip": "Straddle Strip",
            "Straddle": "Straddle",
            "Strangle": "Strangle",
            "Vertical": "Vertical",
            "JellyRoll": "Jelly Roll",
            "IronButterfly": "Iron Butterfly",
            "Guts": "Guts",
            "Generic": "Generic",
            "Diagonal": "Diagonal"
        }

        return strategy_type_map.get(strategy_type, strategy_type)
    
    #subscribes to the market based on the new info
    async def on_expiry_selection(self, exchange_id, contract_id, market_id):       
        await self.client.subscribe_market(exchange_id, contract_id, market_id)
       

    async def get_auth_token(self):
        if (self.client and self.client.get_auth_token):
            return await self.client.get_auth_token()
        
        return None
