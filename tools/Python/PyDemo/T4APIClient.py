import asyncio
import time
import websockets
from tools.ClientMessageHelper import ClientMessageHelper
from tools.ProtoUtils import encode_message, decode_message
from proto.t4.v1.auth import auth_pb2
from proto.t4.v1 import service_pb2
from proto.t4.v1.market import market_pb2
from proto.t4.v1.common.enums_pb2 import DepthBuffer, DepthLevels, PriceType, BuySell, OrderLink, TimeType, ActivationType
from proto.t4.v1.common.price_pb2 import Price
from proto.t4.v1.account import account_pb2
from proto.t4.v1.orderrouting import orderrouting_pb2
from google.protobuf.json_format import MessageToDict
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

        #current market and exchange
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
        self.on_account_update = None
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

        #market data
        self.current_market_id = None
        self.current_subscription = None
        self.market_details = {}
        self.market_snapshots = {}
        self.market_update = None
        self.market_header_update = None
        self.on_market_switch = None  # Callback from GUI

        #orders and positions ui
        self.orders = {}
        self.positions = {}

        

    
    #connects to websocket api
    async def connect(self):
    
        try:
            #establishes websocket connection
            self.ws = await websockets.connect(self.wsUrl)
            self.running = True

            #start background tasks
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

    #disconnects from websocket safely
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
        

    #envelopes, encrypts, and sends message to the server
    async def send_message(self, message):
        request = ClientMessageHelper.create_client_message(message)
        encrypted_request = encode_message(request)
        await self.ws.send(encrypted_request)

    #sends login request
    async def authenticate(self):

        #login request info
        login_info = auth_pb2.LoginRequest(
          firm = self.firm,
          username = self.username,
          password =self.password,
          app_name = self.app_name,
          app_license = self.app_license
        )

        #envelope and encrypt request
        await self.send_message({"login_request": login_info})

        #let's program know that the websocket is now connected
        self.running = True
       

    def handle_login(self, message):
        
        #successful connection = 0    
        if message.result == 0:
            self.login_response = message
            
            # store token   
            if message.authentication_token and message.authentication_token.token:
            
                self.jw_token = message.authentication_token.token
                if message.authentication_token.expire_time:
                    self.jw_expiration = int(message.authentication_token.expire_time.seconds) * 1000
                    print(self.jw_expiration)
            
            #store accounts
            if message.accounts:
                for acc in message.accounts:
                    self.accounts[acc.account_id] = acc

            #begins the login event (allows for a buffer time to onset)
            self.login_event.set()
            
            #updates account info
            if self.on_account_update:
                self.on_account_update({
                    'type': 'accounts',
                    'accounts': list(self.accounts.values())
                })
        else:
            print("login failed")
    
    #runs when client is given new token
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

    #caches given market details
    def handle_market_detail(self, message): 
        self.market_details[message.market_id] = message
        print('market details stored')

    def handle_market_snapshot(self, message):
        print("received market snapshot")

        #each message snapshot has a market detph and other important info
        if message.messages:
            for msg in message.messages:
                if msg.market_settlement:
                    pass # skip the messages that have market settlement
                elif msg and hasattr(msg, "market_depth"): 
                    self.handle_market_depth(msg.market_depth)
        
        #if we have all the necessary info, we will update the market header
        market_details = self.market_details.get(message.market_id)
    
        if market_details and market_details.contract_id and market_details.expiry_date:
            self.update_market_header(market_details.contract_id, market_details.expiry_date)

    #client stores all of the active postiions of the user
    def handle_account_position(self, message):
        key = f'{message.account_id}_{message.market_id}'
        self.positions[key] = message
    

        if self.on_account_update:
            self.on_account_update({'type': 'positions', 
                                    'positions': [p for p in self.positions.values() if p.account_id == self.selected_account]})
    
    #snapshot/rundown of account info is sent from server on initial login.
    #this sends all of that info to its corresponding location
    def handle_account_snapshot(self, message):
        if message.messages:
            for msg in message.messages:
                message_type = msg.WhichOneof("payload")
                match message_type:
                    case "account_details":
                        self.handle_account_details(msg.account_details)
                    case "account_update":
                        self.handle_account_update(msg.account_update)
                    case "account_position":
                        self.handle_account_position(msg.account_position)
                    case "order_update_multi":
                        self.handle_order_update_multi(msg.order_update_multi)
                    case "order_update":
                        self.handle_order_update(msg.order_update)
                    case _:
                        print(f"unknown message {msg}")

        print("handled snapshot")

    def handle_account_details(self, message):
        if not message.account_id:
            return  
        if not message.account_id in self.accounts:
            return
        print(f"account details received ${message.account_id}")
    
    def handle_account_update(self, message):
        pass
        #TODO displays account info (balance, p&l, etc)
    
    #handles all the market info (bids, offers, and trades)
    #stores it for the ui
    def handle_market_depth(self, message):
        #store the latest market snapshot
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

    #subscriber response (debug)
    def handle_subscribe_response(self, message):
        pass
        print(message)
    
    #similar to account snapshot
    #order multi has many different messages nested within
    #this sends each message to its corresponding handler
    def handle_order_update_multi(self, update_multi):
        updates_processed = 0
        if update_multi.updates:
            for update in update_multi.updates:
                if update.HasField("order_update"):
                    updates_processed += 1
                    self.handle_order_update(update.order_update)
                elif update.HasField("order_update_status"):
                    updates_processed += 1
                    self.handle_order_update_status(update.order_update_status)
                elif update.HasField("order_update_trade"):
                    updates_processed += 1
                    self.handle_order_update_trade(update.order_update_trade)
                elif update.HasField("order_update_trade_leg"):
                    updates_processed += 1
                    self.handle_order_update_trade_leg(update.order_update_trade_leg)
                elif update.HasField("order_update_failed"):
                    updates_processed += 1
                    self.handle_order_update_failed(update.order_update_failed)
                else:
                    print(f"Unknown update type in message")
        if updates_processed != len(update_multi.updates):
            print(f"Order update multi mismatch: expected {len(update_multi.updates)}, processed {updates_processed}")
        else:
            print(f"Order update multi processed: {updates_processed}")

    #caches the order
    def handle_order_update(self, order_update):
        self.orders[order_update.unique_id] = order_update
        print(f"Order update received: {order_update.unique_id}, market: {order_update.market_id}")
        self.trigger_orders_update()
    
    #updates order data
    def handle_order_update_status(self, status_update):

        print(f"order status update {status_update.unique_id}")
        

        existing_order = self.orders[status_update.unique_id]
        existing_order.status = status_update.status
        existing_order.time - status_update.time
        existing_order.price_type = status_update.price_type
        existing_order.current_volume = status_update.current_volume
        existing_order.working_volume = status_update.working_volume
        # existing_order.instruction_extra = status_update.instruction_extra
        existing_order.exchange_order_id = status_update.exchange_order_id
        existing_order.status_detail = status_update.status_detail

        self.orders[status_update.unique_id] = existing_order

        self.trigger_orders_update()

    #debug functions
    def handle_order_update_trade(self, trade_update):
        print(f"Trade update: {trade_update.unique_id}, trade: {trade_update.exchange_trade_id}")

    def handle_order_update_trade_leg(self, leg_update):
        print(f"Trade leg update: {leg_update.unique_id}, leg index: {leg_update.leg_index}")

    def handle_order_update_failed(self, failed_update):
        print(f"Order failed: {failed_update.unique_id}, status: {failed_update.status}")

    
    def trigger_orders_update(self):
        if self.on_account_update:
            self.on_account_update({
                "type": "orders",
                "orders": [o for o in self.orders.values() if o.account_id == self.selected_account]
            })

    #key function
    #listens for any websocket messages
    async def listen(self): 
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
       
        if not hasattr(msg, 'WhichOneof'):
            print("[process_server_message] msg has no WhichOneof: ", msg)
            return
        
        message_type = msg.WhichOneof("payload")
    
        match message_type:
            case "login_response":
                self.handle_login(msg.login_response)
            case "authentication_token":
                self.handle_authentication(msg.authentication_token)
            case "account_subscribe_response":
                self.handle_subscribe_response(msg.account_subscribe_response)
            case "account_update":
                self.handle_account_update(msg.account_update)
            case "account_snapshot":
                self.handle_account_snapshot(msg.account_snapshot)
            case "account_position":
                self.handle_account_position(msg.account_position)
            case "market_details":
                self.handle_market_detail(msg.market_details)
            case "market_snapshot":
                self.handle_market_snapshot(msg.market_snapshot)
            case "market_depth":
                self.handle_market_depth(msg.market_depth)
            case "order_update_multi":
                self.handle_order_update_multi(msg.order_update_multi)
            case "order_update":
                self.handle_order_update(msg.order_update)
            case _:
                print("unknown message type")

    #will continuously send heartbeats until connection breaks
    async def send_heartbeat(self):
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


    #function to retrieve a new token
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
        
        #gets a new token now
        self.pending_token_request = asyncio.create_task(self.refresh_token())
        try:
            token = await self.pending_token_request
            print("renewed the token")
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
            
            #calls api to get the market id
            async with httpx.AsyncClient() as rest:
              
                response = await rest.get(f'{self.apiUrl}/markets/picker/firstmarket?exchangeid={exchange_id}&contractid={contract_id}'
                                        , headers=headers)
                #check if the response is valid
                if not response.status_code == 200:
                     print('error inside')
                     return
                
                #get the marketid.
                data = response.json()
                #self.current_market_id = data.get("marketID")
               
                return data.get("marketID")

        except Exception as e:
            print("error outside:", e)
    
    #subsribes to an account
    async def subscribe_account(self, account_id):
        if self.selected_account == account_id:
            return  # Already subscribed

        # Unsubscribe from previous account
        if self.selected_account:
            unsub_msg = account_pb2.AccountSubscribe(
                subscribe=0,
                subscribe_all_accounts=False,
                account_id=[self.selected_account]
            )
            await self.send_message({"account_subscribe": unsub_msg})

        # Update selected
        self.selected_account = account_id

        # Subscribe to new account
        sub_msg = account_pb2.AccountSubscribe(
            subscribe=2,  # ALL_UPDATES
            subscribe_all_accounts=False,
            account_id=[account_id]
        )
        await self.send_message({"account_subscribe": sub_msg})

        print(f"Subscribed to account: {account_id}")

    #subscribes to a new market
    async def subscribe_market(self, exchange_id, contract_id, market_id):
        if self.on_market_switch:
            self.on_market_switch() #connected to gui. refreshes the ui
        
        key = f'{exchange_id}_{contract_id}_{market_id}'

        # Skip if it's the same contract
        if getattr(self, "_latest_requested_key", None) == key:
            print("[subscribe_market] Duplicate request, skipping")
            return

        # Mark as the latest request
        self._latest_requested_key = key

        # If already subscribed to something else, unsubscribe first
        if self.current_subscription:
            prev_exchange_id = self.md_exchange_id
            prev_contract_id = self.md_contract_id
            prev_market_id = self.current_market_id

            # Unsubscribe from previous contract
            depth_unsub = market_pb2.MarketDepthSubscribe(
                exchange_id=prev_exchange_id,
                contract_id=prev_contract_id,
                market_id=prev_market_id,
                buffer=DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION,
                depth_levels=DepthLevels.DEPTH_LEVELS_UNDEFINED
            )
            await self.send_message({"market_depth_subscribe": depth_unsub})
            print("Unsubscribed from previous market")

        # Only after successful unsubscribe, update current state
        self.md_exchange_id = exchange_id
        self.md_contract_id = contract_id
        self.current_market_id = market_id
        self.current_subscription = {exchange_id, contract_id, market_id}

        # Now subscribe to the new contract
        depth_sub = market_pb2.MarketDepthSubscribe(
            exchange_id=exchange_id,
            contract_id=contract_id,
            market_id=market_id,
            buffer=DepthBuffer.DEPTH_BUFFER_SMART,
            depth_levels=DepthLevels.DEPTH_LEVELS_BEST_ONLY  # or whatever default
        )

        await self.send_message({"market_depth_subscribe": depth_sub})
        print("Subscribed to new market")

    async def submit_order(self, side, volume, price, price_type = 'limit', take_profit_dollars = None, stop_loss_dollars = None):
       
        if not self.current_market_id:
            print("No market selected")
            return

        market_details = self.market_details.get(self.current_market_id)
        if not market_details:
            print("Market details not found")
            return
    
        if not self.current_market_id:
            print("error, no market selected")
        
        market_details = self.market_details.get(self.current_market_id)

        #conver string price to enum
        price_type_val = (
            PriceType.PRICE_TYPE_MARKET if price_type.lower() == "market"
            else PriceType.PRICE_TYPE_LIMIT
        )

        #convert buy/sell 
        if isinstance(side, str):
            buy_sell_value = (
                BuySell.BUY_SELL_BUY if side.lower() == "buy"
                else BuySell.BUY_SELL_SELL
            )
        else:
            buy_sell_value = side

        #determining if we need oco order linking
        has_bracket_orders = take_profit_dollars is not None or stop_loss_dollars is not None

        order_link_value = (
            OrderLink.ORDER_LINK_AUTO_OCO if has_bracket_orders
            else OrderLink.ORDER_LINK_NONE
        )

        orders = []
        #create orders array with main order first
        main_order = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=buy_sell_value,
                price_type=price_type_val,
                time_type=TimeType.TIME_TYPE_NORMAL,
                volume=volume
            )

        # Convert price to ticks
        tick_price = float(price)
            # Set limit price only if it's a LIMIT order
        if price_type_val == PriceType.PRICE_TYPE_LIMIT:
            main_order.limit_price.CopyFrom(Price(value=str(tick_price)))

        orders.append(main_order)
        #for bracket orders, we need to use the opposite side
        protection_side = (
            BuySell.BUY_SELL_SELL if buy_sell_value == BuySell.BUY_SELL_BUY
            else BuySell.BUY_SELL_BUY
        )
        #add take profit order 
        if take_profit_dollars is not None:
            take_profit_points = take_profit_dollars / market_details.point_value.value
            take_profit_price = take_profit_points * market_details.min_price_increment.value

            take_profit_order = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=protection_side,
                price_type=PriceType.PRICE_TYPE_LIMIT,
                time_type=TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                volume=0,
                activation_type=ActivationType.ACTIVATION_TYPE_HOLD,
            )
            take_profit_order.limit_price.CopyFrom(Price(value=str(take_profit_price)))
            orders.append(take_profit_order)

        # --- Stop Loss ---
        if stop_loss_dollars is not None:
            stop_loss_points = stop_loss_dollars / market_details.point_value.value
            stop_loss_price = stop_loss_points * market_details.min_price_increment.value

            stop_loss_order = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=protection_side,
                price_type=PriceType.PRICE_TYPE_STOP_MARKET,
                time_type=TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                volume=0,
                activation_type=ActivationType.ACTIVATION_TYPE_HOLD,
            )
            stop_loss_order.stop_price.CopyFrom(Price(value=str(stop_loss_price)))
            orders.append(stop_loss_order)

        order_submit = orderrouting_pb2.OrderSubmit(
            account_id = self.selected_account,
            market_id = self.current_market_id,
            order_link = order_link_value,
            manual_order_indicator = True,
            orders = orders
        )

        await self.send_message({"order_submit": order_submit})


        #print console statements
        side_text = "Buy" if buy_sell_value == BuySell.BUY_SELL_BUY else "Sell"
        price_text = "Market" if price_type_val == PriceType.PRICE_TYPE_MARKET else price

        print(f"Order submitted: {side_text} {volume} @ {price_text} (Type: {price_type})")

        if take_profit_dollars is not None:
            tp_side = "Buy" if protection_side == BuySell.BUY_SELL_BUY else "Sell"
            print(f"Take profit: ${take_profit_dollars} ({tp_side})")

        if stop_loss_dollars is not None:
            sl_side = "Buy" if protection_side == BuySell.BUY_SELL_BUY else "Sell"
            print(f"Stop loss: ${stop_loss_dollars} ({sl_side})")

        if has_bracket_orders:
            print("OCO (One Cancels Other) bracket order applied")


    async def pull_order(self, order_id):
        if not self.selected_account:
            print("error, no account selected. (pull order)")
            return
        pull = orderrouting_pb2.OrderPull.Pull(
            unique_id=order_id
        )
        order_pull = orderrouting_pb2.OrderPull(
            account_id = self.selected_account,
            market_id = self.current_market_id,
            manual_order_indicator = True,
            pulls = [pull]
        )


        await self.send_message({"order_pull": order_pull})

        print(f'order_cancelled {order_id}')
    
    async def revise_order(self, order_id, volume, price, price_type = 'limit'):
        if not self.selected_account:
            print("no selected account, (revise order)")
            return
        # Create the Price object if this is a limit order
        limit_price = Price(value=str(price)) if price_type.lower() == "limit" else None

        revise = orderrouting_pb2.OrderRevise.Revise(
            unique_id=order_id,
            volume=volume,
            limit_price=limit_price if limit_price else None
        )
        order_revise = orderrouting_pb2.OrderRevise(
            account_id = self.selected_account,
            market_id = self.current_market_id,
            manual_order_indicator = True,
            revisions = [revise]
        )

        await self.send_message({"order_revise": order_revise})

        print(f"order revised {order_id} - new vol: {volume} - new price ")

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