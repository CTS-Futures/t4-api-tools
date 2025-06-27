    //Start with Configuration and the constructor
    /*
     * Constructor has hearbeats that test the connections every 2 miliseconds 
     * What are tyhe message timeouts? 
     * 
     */

package com.t4;

// Protobuf-generated classes (adjust these based on actual generated package structure)
import t4proto.v1.auth.Auth; // For LoginRequest, AuthenticationTokenRequest, AuthenticationToken
import t4proto.v1.common.PriceOuterClass; // For PriceFormat
import t4proto.v1.common.Enums.PriceFormat;
import t4proto.v1.service.Service; // For ClientMessage
import t4proto.v1.account.Account;//import static t4proto.v1.service.Service.ServerMessage.PayloadCase.*;

// WebSocket imports
import javax.websocket.*;

import com.google.protobuf.ProtoSyntax;
// Helper class you’ve written
import com.t4.helpers.ClientMessageHelper;

import java.io.IOException;
// Java stdlib
import java.net.URI;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Timer;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import com.t4.helpers.TestDecoder;

//Having some threading problems

     @ClientEndpoint
     public class T4APIClientTest{
        //Configuration variables 
        /* public String wsUrl;
        public String apiUrl;
        public String apiKey;
        public String firm;
        public String userName;
        public String password;
        public String appName;
        public String appLicense;
        public String priceFormat;
        public int heartbeatIntervalMs;
        public int messageTimeoutMs;
        public String mdExchangeId;
        public String mdContractId;
        
     
     public T4APIClient(){
        configuration from Config file
        this.wsUrl = T4_CONFIG.wsUrl;
        this.apiUrl = T4_CONFIG.apiUrl;
        this.apiKey =T4_CONFIG.apiKey;
        this.firm = T4_CONFIG.firm;
        this.userName = T4_CONFIG.userName;
        this.password = T4_CONFIG.password;
        this.appName = T4_CONFIG.appName;
        this.appLicense = T4_CONFIG.appLicense;
        this.priceFormat = T4_CONFIG.priceFormat;
        this.heartbeatIntervalMs = 20000;
        this.messageTimeoutMs = 60000;
        this.mdExchangeId = T4_CONFIG.mdExchangeId;
        this.mdContractId = T4_CONFIG.mdContractId;
     }
 */
     

      // Connection state
        private Object ws = null; //placeholder for the WebSocket connection
        private boolean isConnected = false;
        private Object loginResponse = null;
        private Map<String, Object> accounts = new HashMap<>();
        private Object selectedAccount = null;

        // JWT token management
        private Object jwtToken = null;
        private Object jwtExpiration = null;
        private Object pendingTokenRequest = null;

        // Market data
        private Map<String, Object> marketSnapshots = new HashMap<>();
        private Object currentSubscription = null;
        private Map<String, Object> marketDetails = new HashMap<>();
        private String currentMarketId = null;

        // Order/Position tracking
        private Map<String, Object> positions = new HashMap<>();
        private Map<String, Object> orders = new HashMap<>();

        // Heartbeat management
        private Object heartbeatTimer = null;
        private long lastMessageReceived = System.currentTimeMillis();

        // Event handlers
        private Object onConnectionStatusChanged = null;
        private Object onAccountUpdate = null;
        private Object onMarketHeaderUpdate = null;
        private Object onMarketUpdate = null;
        private Object onMessageSent = null;
        private Object onMessageReceived = null;
        private Object onError = null;
        private Object onLog = null;

        // Connection retry
        private int reconnectAttempts = 0;
        private int maxReconnectAttempts = 10;
        private int reconnectDelay = 1000;

        private boolean isDisposed = false;



      //Step 1: Connect to WebSocket
      //Step 2: give it auth keys and info
      //Step 3: listen for messsage
      //Step 4:
        @OnOpen

        public void onOpen(Session session){
         System.out.println("Connected to Websocket");

         try{
            Auth.LoginRequest loginRequest = Auth.LoginRequest.newBuilder()
            .setApiKey("")
            .setFirm("CTS")
            .setUsername("JGarner")
            .setPassword("Temp123$")
            .setAppName("T4WebSite")
            .setAppLicense("81CE8199-0D41-498C-8A0B-EC5510A395F4")
            .setPriceFormat(PriceFormat.PRICE_FORMAT_DECIMAL)
            .build();

            Service.ClientMessage clientMessage = ClientMessageHelper.wrapLoginRequest(loginRequest);

            session.getAsyncRemote().sendBinary(ByteBuffer.wrap(clientMessage.toByteArray()));
            startHeartbeatMonitor(session);
            startClientHeartbeat(session);
            System.out.println("Login message sent.");
         }
         catch(Exception e){
             e.printStackTrace();
         }
        }

        @OnMessage

        public void onMessage(ByteBuffer bytes) {
      System.out.println("Received binary message:");
      try {
         Service.ClientMessage clientMessage = Service.ClientMessage.parseFrom(bytes.array());
         Service.ServerMessage serverMessage = Service.ServerMessage.parseFrom(bytes.array());
         Service.ClientMessage.PayloadCase payloadCase = clientMessage.getPayloadCase();

         switch (payloadCase) {
               case LOGIN_REQUEST:
                  Auth.LoginRequest loginRequest = clientMessage.getLoginRequest();
                  System.out.println("Received LoginRequest: " + loginRequest);
                  break;

               case HEARTBEAT:
                  lastMessageReceived = System.currentTimeMillis();
                   System.out.println("Received Heartbeat: " + clientMessage.getHeartbeat());
                   break;

               case PAYLOAD_NOT_SET:
                   System.out.println("Payload is not set");
                   break;
               
               case AUTHENTICATION_TOKEN_REQUEST:
                  Auth.AuthenticationToken token = serverMessage.getAuthenticationToken();
                  System.out.println("Received token: " + token);
                  try {
                     Map<String, Object> decoded = TestDecoder.decodeToken(token.getToken());
                     System.out.println("🔓 Decoded token: " + decoded);
               } catch (Exception e) {
                     System.err.println("❌ Failed to decode token:");
                     e.printStackTrace();
               }
                   break;

               default:
                   System.out.println("Received unknown payload: " + payloadCase);
         }

      } 
         catch (Exception e) {
            System.err.println("Failed to parse message:");
            e.printStackTrace();
         }
      }

        /* Attempt 1
        
        public void onMessage(ByteBuffer bytes)  {
         System.out.println("Received binary message:");
         try {
        // Parse the Protobuf message
            Service.ClientMessage clientMessage = Service.ClientMessage.parseFrom(bytes.array());

            if(clientMessage.hasLoginResponse()){
               Auth.LoginResponse loginResponse = clientMessage.getLoginResponse();
               System.out.println(" Login response parsed: " + loginResponse);
            }
            else{
               System.out.println(" Received non-login message: " + clientMessage);
            }
            
         } catch (Exception e) {
            System.err.println(" Failed to parse login response:");
            e.printStackTrace();
         }
      } */

     /*  public void onMessage(String message, ByteBuffer bytes){
         System.out.println("Recieved message:" + message);
         try {
        // Attempt to parse as LoginResponse
            Auth.LoginResponse response = Auth.LoginResponse.parseFrom(bytes.array());
            System.out.println(" Login response received: " + response.toString());

        // TODO: check if login was successful and move to subscribe to data
        } catch (Exception e) {
            System.err.println("Could not parse incoming message.");
            e.printStackTrace();
         }


        } */


        @OnError

        public void onError(Session session, Throwable error){
         System.out.println("Error occurred: ");
         error.printStackTrace();
         reconnect();
        }

        @OnClose
        public void onClose(Session session, CloseReason reason){
         System.out.println("Disconnected: " + reason);
         //reconnect();

        }

        private void reconnect() {
         try {
           Thread.sleep(2000); // small backoff
           WebSocketContainer container = ContainerProvider.getWebSocketContainer();
           container.connectToServer(this, URI.create("wss://wss-sim.t4login.com/v1"));
           System.out.println("Reconnecting...");
         } catch (Exception e) {
           System.err.println("Reconnection failed:");
           e.printStackTrace();
          }
      }

        private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

        private void startHeartbeatMonitor(Session session) {
            scheduler.scheduleAtFixedRate(() -> {
            long now = System.currentTimeMillis();
            if (now - lastMessageReceived > 30000) { // 30 seconds without heartbeat
               System.err.println(" No heartbeat received in 30s. Reconnecting...");
               try {
                   session.close();
               } catch (IOException e) {
                   e.printStackTrace();
               }
               reconnect();
            }
         }, 10, 10, TimeUnit.SECONDS);
      }

      private void startClientHeartbeat(Session session) 
      {
         scheduler.scheduleAtFixedRate(() -> {
         try {
            // Construct and send a protobuf Heartbeat
            Service.Heartbeat heartbeat = Service.Heartbeat.newBuilder()
                .setTimestamp(System.currentTimeMillis())
                .build();
            Service.ClientMessage ping = Service.ClientMessage.newBuilder()
                .setHeartbeat(heartbeat)
                .build();
            session.getAsyncRemote().sendBinary(ByteBuffer.wrap(ping.toByteArray()));
            System.out.println("Sent heartbeat ping");
         } catch (Exception e) {
            System.err.println("Failed to send heartbeat ping");
            e.printStackTrace();
         }
         }, 0, 20, TimeUnit.SECONDS); // every 20s
      }


       public void handleIncomingMessage(String jwtToken) 
       {
         Map<String, Object> claims = TestDecoder.decodeToken(jwtToken);

         if (claims.containsKey("error")) 
         {
            System.out.println("Error decoding token: " + claims.get("error"));
         } 
        else 
        {
            System.out.println("Decoded Username: " + claims.get("t4_Username"));
            System.out.println("Token Expires At: " + claims.get("exp"));
        }
      }




        public static void main(String[] args){
         try{
            WebSocketContainer container = ContainerProvider.getWebSocketContainer();
            container.connectToServer(T4APIClientTest.class, URI.create("wss://wss-sim.t4login.com/v1"));
            Thread.sleep(5000);
         }
         catch(Exception e){
            e.printStackTrace();
         }

      }


      }

     


