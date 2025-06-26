import asyncio
import time
import websockets
from tools.ClientMessageHelper import ClientMessageHelper
from tools.ProtoUtils import encode_message, decode_message
from proto.t4.v1.auth import auth_pb2
from proto.t4.v1 import service_pb2

class Client:

    #initializes core attributes
    def __init__(self, config):
        self.wsUrl = config['websocket']['url']
        self.apiUrl = config['websocket']['api']
        self.firm= config['websocket']['firm']
        self.username=config['websocket']['username']
        self.password=config['websocket']['password']
        self.app_name= config['websocket']['app_name']
        self.app_license= config['websocket']['app_license']
        self.priceFormat= config['websocket']['priceFormat']
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


        #tokens
        self.jw_token = None
        self.jw_expiration = None
    
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
            asyncio.create_task(self.send_heartbeat())
            asyncio.create_task(self.listen()) 

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
                    self.jw_expiration = message.authentication_token.expire_time.seconds * 1000
                
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
        
    
    async def listen(self): #listens for any websocket messages
        
        try:
            while self.running:
                msg = await self.ws.recv()
                self.proccess_server_message(msg)
    
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed by server.")
            self.running = False
        except Exception as e:
            print("Error while listening:", e)
            self.running = False

    #this will be inside of the listen function.
    #sends each message to a handling funciton. Which will just parse the data that is needed
    def proccess_server_message(self, msg):
        msg = decode_message(msg)
        if msg.login_response:
            self.handle_login(msg.login_response)
    
        

    async def send_heartbeat(self):
        
        #will continuously send heartbeats until connection breaks
        while self.running:
            
            heartbeat_msg = service_pb2.Heartbeat(timestamp=int(time.time() * 1000))
            await self.send_message({"heartbeat": heartbeat_msg})

            print("Heartbeat sent.")
            print(self.running)
            await asyncio.sleep(self.heartbeat_time) #20 second timer



        


