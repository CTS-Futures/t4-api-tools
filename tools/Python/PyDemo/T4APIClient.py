import asyncio
import time
import websockets
from tools.ClientMessageHelper import ClientMessageHelper
from tools.ProtoUtils import encode_message, decode_message
from proto.t4.v1.auth import auth_pb2
from proto.t4.v1 import service_pb2
from proto.t4.v1.market import market_pb2
from proto.t4.v1.common.enums_pb2 import DepthBuffer, DepthLevels
import uuid
import httpx

class Client:

    #initializes core attributes
    def __init__(self, config):
        #config file settings
        self.wsUrl = config['websocket']['url']
        self.apiUrl = config['websocket']['api']
        self.apiKey = None
        self.firm= config['websocket']['firm']
        self.username=config['websocket']['username']
        self.password=config['websocket']['password']
        self.app_name= config['websocket']['app_name']
        self.app_license= config['websocket']['app_license']
        self.priceFormat= config['websocket']['priceFormat']
        self.md_exchange_id = config['websocket']['md_exchange_id']
        self.md_contract_id = config['websocket']['md_contract_id']

        self.ws = None
        self.lastMessage = None
        self.running = False
        self.heartbeat_time = 20 
        self.login_event = asyncio.Event()
        #accounts
        self.accounts = {}
        self.selected_account = None
        #connection
        self.login_response = None

        
        #main tasks
        self.listen_task = None
        self.heartbeat_task = None
        #tokens
        self.jw_token = None
        self.jw_expiration = None
        self.pending_token_request = None
        self.token_resolvers = {} #maps a requestID to a resolve/reject callback

        self.market_update = None
        self.market_header_update = None

        #market data
        self.current_market_id = None
        self.current_subscription = None
        self.market_details = {}
        self.market_snapshots = {}

        

    
    #connects to api
    async def connect(self):
    
        try:
            # async with websockets.connect(self.wsUrl) as self.ws:
            #     await asyncio.gather(
            #         self.authenticate(),
            #         self.send_heartbeat(),
            #         self.listen()
            # )
            self.ws = await websockets.connect(self.wsUrl)
            self.running = True

            # Start background tasks
            asyncio.create_task(self.authenticate())
            self.heartbeat_task = asyncio.create_task(self.send_heartbeat())
            self.listen_task = asyncio.create_task(self.listen()) 

            #wait for log in to complete.
            try:
                await asyncio.wait_for(self.login_event.wait(), timeout=10)
            except asyncio.TimeoutError:
                print("Login timed out.")
                self.running = False   
            if not self.running: #if authentication fails give error message
                print("authentication failed")
        except Exception as e:
            print("Failure", e)


    async def disconnect(self):
        self.running = False #turns off all the loops going
        if self.ws:
            await self.ws.close(code=1000, reason="client disconnect")
            print("disconnect success")
        else:
            print("already disconnected")
        
        #cancels the recurring listening and heartbeat monitors.
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
        if self.listen_task:
            self.listen_task.cancel()

        #gathers the tasks together to cancel
        await asyncio.gather(self.listen_task, self.heartbeat_task)
        print("check 2")

    #envelopes, encrypts, and sends message to the server
    async def send_message(self, message):
        request = ClientMessageHelper.create_client_message(message)
        encrypted_request = encode_message(request)
        await self.ws.send(encrypted_request)

    #sends login request
    async def authenticate(self):
        login_info = auth_pb2.LoginRequest(
          firm = self.firm,
          username = self.username,
          password =self.password,
          app_name = self.app_name,
          app_license = self.app_license
        )

        #envelope and encrypt request
        await self.send_message({"login_request": login_info})

        self.running = True
       

    def handle_login(self, message):
        
        #successful connection
        print(message)
        if message.result == 0:
            self.login_response = message
            
            # store token   
            if message.authentication_token and message.authentication_token.token:
            
                self.jw_token = message.authentication_token.token
                if message.authentication_token.expire_time:
                    self.jw_expiration = int(message.authentication_token.expire_time.seconds) * 1000
                
            #store accounts
            if message.accounts:
                for acc in message.accounts:
                    self.accounts[acc.account_id] = acc

            self.login_event.set()
            print(self.accounts)
            
        
            # if self.on_account_update:
            #     self.on_account_update({
            #         'type': 'accounts',
            #         'accounts': list(self.accounts.values())
            #     })
        else:
            print("login failed")
    
    def handle_authentication_token(self, message):
        
        #reinitialize the new token
        self.jw_token = message.token

        #reinitialize the expire time
        self.jw_expiration = int(message.expire_time.seconds) * 1000

        request_id = getattr(message, "request_id", None)
        if request_id and request_id in self.token_resolvers:
            future = self.token_resolvers.pop(request_id)
            if not future.done():
                future.set_result(message.token)

    def handle_market_detail(self, message): 
        self.market_details[message.market_id] = message
        print('market details stored')

    def handle_market_snapshot(self, message):
        #print(message)
        print("received market snapshot")

        #each message snapshot has a markte detph
        if message.messages:
            for msg in message.messages:
                if hasattr(msg, "market_settlement"):
                    pass
                elif msg and hasattr(msg, "market_depth"):
                    print(msg)
                    self.handle_market_depth(msg.market_depth)
        
        #if we have all the necessary info, we will update the market header
        market_details = self.market_details.get(message.market_id)
        if market_details and market_details.contract_id and market_details.expiry_date:
            self.update_market_header(market_details.contract_id, market_details.expiry_date)


    def handle_market_depth(self, message):
        # Store the latest market snapshot
        self.market_snapshots[message.market_id] = message

        # Get market details (could be None)
        market_detail = self.market_details.get(message.market_id)
    
        # Update market header if all required fields exist
        if market_detail and market_detail.contract_id and market_detail.expiry_date:
            self.update_market_header(market_detail.contract_id, market_detail.expiry_date)

        # Notify listener if set
        if self.on_market_update:
            best_bid = (
                f"{message.bids[0].volume}@{message.bids[0].price.value}"
                if len(message.bids) > 0
                else "-"
            )
            best_offer = (
                f"{message.offers[0].volume}@{message.offers[0].price.value}"
                if len(message.offers) > 0
                else "-"
            )
            last_trade = (
                f"{message.trade_data.last_trade_volume}@{message.trade_data.last_trade_price.value}"
                if message.HasField("trade_data") and message.trade_data.HasField("last_trade_price")
                else "-"
            )

            self.on_market_update({
                "market_id": message.market_id,
                "contract_id": market_detail.contract_id,
                "expiry_date": market_detail.expiry_date,
                "best_bid": best_bid,
                "best_offer": best_offer,
                "last_trade": last_trade,
            })


    def handle_subscribe_response(self, message):
        print(message)
    

    #TODO update the market header
    async def listen(self): #listens for any websocket messages
        
        try:
            while self.running:
                try:
                    msg = await asyncio.wait_for(self.ws.recv(), timeout=2)
                    self.process_server_message(msg)
                except asyncio.TimeoutError:
                    continue  # keep looping to check `self.running`
    
        except asyncio.CancelledError:
            print("listen() task cancelled.")
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed by server.")
            self.running = False
        except Exception as e:
            print("Error while listening:", e)
            self.running = False

    #this will be inside of the listen function.
    #sends each message to a handling funciton. Which will just parse the data that is needed
    def process_server_message(self, msg):
        msg = decode_message(msg)
      #  print(msg)
        # if msg.login_response:
        #     self.handle_login(msg.login_response)
        # elif msg.authentication_token:
        #     self.handle_authentication(msg.authentication_token)
        # elif msg.subscribe_response:
        #     self.handle_subscribe_response(msg.subscribe_response)
        message_type = msg.WhichOneof("payload")
     
        if message_type == "login_response":
            self.handle_login(msg.login_response)
        elif message_type == "authentication_token":
            self.handle_authentication(msg.authentication_token)
        elif message_type == "account_subscribe_response":
            self.handle_subscribe_response(msg.account_subscribe_response)
        elif message_type == "market_details":
            self.handle_market_detail(msg.market_details)    
        elif message_type == "market_snapshot":
            self.handle_market_snapshot(msg.market_snapshot)
       
        elif message_type == "market_depth":
            self.handle_market_depth(msg.market_depth)
        
        
        else:
            print(msg)
        

    async def send_heartbeat(self):
        
        #will continuously send heartbeats until connection breaks
    
        try:
            while self.running:
                heartbeat_msg = service_pb2.Heartbeat(timestamp=int(time.time() * 1000))
                await self.send_message({"heartbeat": heartbeat_msg})
                print("Heartbeat sent.")
                await asyncio.sleep(self.heartbeat_time)
        except asyncio.CancelledError:
            print("heartbeat() task cancelled.")
        finally:
            print("Exiting heartbeat()")


    #the following have to do with token things
    async def refresh_token(self):   
        ID = str(uuid.uuid4()) #gets uuid from python library (random)

        future = asyncio.get_event_loop().create_future()
        self.token_resolvers[ID] = future

        ID = auth_pb2.AuthenticationTokenRequest(requestID=ID)
        await self.send_message({"authentication_token_request": ID})


        try:
            #waits up to 30 seconds for a response
            token = await asyncio.wait_for(future, timeout=30)
            return token

        except asyncio.TimeoutError:
            del self.token_resolvers[ID]
            raise Exception("Token request timeout")



    async def get_auth_token(self):

        # check if there is a valid jwt token from login
        # condtions: it exists and it hasnt expired yet
        # if the expiration time is farther then the curernt time, then it hasnt expired yet
        if self.jw_token and self.jw_expiration and self.jw_expiration > time.time() + 30:
            return self.jw_token
            
        #make sure that we don't already have a token request present
        elif self.pending_token_request:
            return await self.pending_token_request
        
        #let's try to get a new token now
        self.pending_token_request = asyncio.create_task(self.refresh_token())
        try:
            token = await self.pending_token_request
            return token
        finally:
            self.pending_token_request = None


    async def get_market_id(self, exchange_id, contract_id):
        

        try:

            #this section checks which authorization type to use
            headers = {'Content-type': 'application/json'}

            if (self.apiKey):
                headers['Authorization'] = f'APIKey {self.apikey}'
            else:
                token = await self.get_auth_token()
                if (token):
                    headers['Authorization'] = f'Bearer {token}'
            
            #now let's do an async request
            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.apiUrl}/markets/picker/firstmarket?exchangeid={exchange_id}&contractid={contract_id}'
                                        , headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                
                #get the marketid.
                data = response.json()
                self.current_market_id = data.get("marketID")
               
                return data

        except Exception as e:
            print("error outside:", e)
    
    async def subscribe_market(self, exchange_id, contract_id, market_id):
        key = f'{exchange_id}_{contract_id}_{market_id}'
      
       # if currently subscribed, let's unsubscribe and subscribe to the other
        if self.current_subscription:
            #TODO: add unsubscribe functionality for when subscribing tod differnt markets.
            depth_unsub = market_pb2.MarketDepthSubscribe(
                exchange_id= exchange_id,
                contract_id= contract_id,
                market_id = market_id,
                buffer = DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION,
                depth_levels= DepthLevels.DEPTH_LEVELS_UNDEFINED
            )
            await self.send_message({"market_depth_subscribe": depth_unsub})
            print("unsubscribed from market")
            self.current_subscription = None
        
        self.current_subscription = {exchange_id, contract_id, market_id}
        self.current_market_id = market_id

        # creates subscripton message
        depth_sub = market_pb2.MarketDepthSubscribe(
            exchange_id= exchange_id,
            contract_id= contract_id,
            market_id = market_id,
            buffer = DepthBuffer.DEPTH_BUFFER_SMART,
            depth_levels= DepthLevels.DEPTH_LEVELS_BEST_ONLY
        )

        # sends the message out
        await self.send_message({"market_depth_subscribe": depth_sub})


    def update_market_header(self, contract_id, expiry_date):

        #extracts the first 6 digits from the expiry date(YYYYMM FORMAT)
        expiry_short = str(expiry_date)[:6] if expiry_date else ""

        #format as a contract + expirty (e.g. "ESM25")
        display_text = contract_id or ""

        if expiry_short and len(expiry_short) == 6:
            year = expiry_short[2:4] ##gets last two digits of the year
            month = expiry_short[4:6] # gets month

            #CONVERST THE MONTHS TO ITS CORRESPONDING LETTER
            month_codes = {
                '01': 'F', '02': 'G', '03': 'H', '04': 'J', '05': 'K', '06': 'M',
                '07': 'N', '08': 'Q', '09': 'U', '10': 'V', '11': 'X', '12': 'Z'
            }
            month_code = month_codes[month] or month
            display_text += month_code + year

        if self.market_header_update:
            self.market_header_update(display_text)