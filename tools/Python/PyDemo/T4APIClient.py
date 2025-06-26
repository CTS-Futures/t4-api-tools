import asyncio
import time
import websockets
from tools.ClientMessageHelper import ClientMessageHelper
from tools.ProtoUtils import encode_message, decode_message
from proto.t4.v1.auth import auth_pb2
from proto.t4.v1 import service_pb2
import uuid

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

        
        #main tasks
        self.listen_task = None
        self.heartbeat_task = None
        #tokens
        self.jw_token = None
        self.jw_expiration = None
        self.pending_token_request = None
        self.token_resolvers = {} #maps a requestID to a resolve/reject callback
    
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
             
        
    
    async def listen(self): #listens for any websocket messages
        
        try:
            while self.running:
                try:
                    msg = await asyncio.wait_for(self.ws.recv(), timeout=2)
                    self.proccess_server_message(msg)
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
    def proccess_server_message(self, msg):
        msg = decode_message(msg)
        if msg.login_response:
            self.handle_login(msg.login_response)
        elif msg.authentication_token:
            self.handle_authentication(msg.authentication_token)
    
        

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
            return self.jw_token\
            
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


    



