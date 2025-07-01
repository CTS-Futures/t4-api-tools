    //Start with Configuration and the constructor
    /*
     * Constructor has hearbeats that test the connections every 2 miliseconds 
     * What are tyhe message timeouts? 
     * 
     */

package com.t4;

// Protobuf-generated classes (adjust these based on actual generated package structure)
import java.util.concurrent.CompletableFuture;
import t4proto.v1.auth.Auth; // For LoginRequest, AuthenticationTokenRequest, AuthenticationToken
import t4proto.v1.auth.Auth.AuthenticationToken;
import t4proto.v1.common.PriceOuterClass; // For PriceFormat
import t4proto.v1.common.Enums.PriceFormat;
import t4proto.v1.service.Service; // For ClientMessage
import t4proto.v1.account.Account;//import static t4proto.v1.service.Service.ServerMessage.PayloadCase.*;

// WebSocket imports
import javax.websocket.*;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.google.protobuf.ProtoSyntax;
import com.google.protobuf.Descriptors.FieldDescriptor;
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
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import com.t4.helpers.TestDecoder;
import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.interfaces.Claim;

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
        private boolean isLoggedIn = false; //starts heartbeats once loggedin and connncted

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
        private static Session session;



      //made some functions for the UI! I am going to work on the UI and token handling tomorrow! 
        @OnOpen

        public void onOpen(Session sessionO){
         System.out.println("Connected to Websocket");
         isConnected = true;
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

            sessionO.getAsyncRemote().sendBinary(ByteBuffer.wrap(clientMessage.toByteArray()));
            //startHeartbeatMonitor(session);
            startClientHeartbeat(sessionO);
            session = sessionO;
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
         Service.ServerMessage serverMessage = Service.ServerMessage.parseFrom(bytes.array());
         Service.ServerMessage.PayloadCase payloadCase = serverMessage.getPayloadCase();
         System.out.println(payloadCase);
         switch (payloadCase) {
               case HEARTBEAT:
                  lastMessageReceived = System.currentTimeMillis();
                   System.out.println("Received Heartbeat:  " + serverMessage.getHeartbeat());
                   break;

               case PAYLOAD_NOT_SET:
                   System.out.println("Payload is not set");
                   break;

               case LOGIN_RESPONSE:
                  System.out.println("Login Response Recieved: \n" + serverMessage.getLoginResponse());
                  AuthenticationToken token = serverMessage.getLoginResponse().getAuthenticationToken();
                  System.out.println("Token from the response: " + tokenHandler(token));
                  isLoggedIn = true;
                  break;

               case AUTHENTICATION_TOKEN:
                  System.out.println("Made it to the token! ");
                  jwtToken = true;
                  Auth.AuthenticationToken tokenA = serverMessage.getAuthenticationToken();
                  Map<FieldDescriptor, Object> decodedJWT = tokenA.getAllFields();
                  System.out.println(tokenA.getExpireTime().getSeconds()/60);
                  System.out.println("Recieved Token: " + decodedJWT);
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


        @OnError

        public void onError(Session session, Throwable error){
         System.out.println("Error occurred: ");
         error.printStackTrace();
         stopClientHeartbeat();
         //reconnect(); // on any error it will reconnect must change to certian errors
        }

        @OnClose
        public void onClose(Session session, CloseReason reason){
         isConnected = false; 
         isLoggedIn = false; 
         stopClientHeartbeat();
         System.out.println("Disconnected: " + reason);
        }


        public  String tokenHandler(AuthenticationToken token) {
         jwtToken = token.toString();

         if(token.hasExpireTime()){
            jwtExpiration = token.getExpireTime().getSeconds() * 1000;
         }
         //if token expires I need to request a new one
         System.out.println(jwtExpiration);

         return "Token had been handeled";
        }

        

        private void reconnect() {
         //this will be needed for when we start wokring on UI
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
         //will be used for the buttons 
         private static void connect() throws DeploymentException, IOException{
            WebSocketContainer container = ContainerProvider.getWebSocketContainer();
            container.connectToServer(T4APIClientTest.class, URI.create("wss://wss-sim.t4login.com/v1"));
         }
         //used for buttons 
         private static void disconnect(){
             try {
               if (session != null && session.isOpen()) {
                  session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, "Client requested disconnect"));
                  System.out.println("Disconnect request sent.");
               }
            } catch (IOException e) {
               System.err.println("Error while disconnecting:");
               e.printStackTrace();
            }
         }



        private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        private ScheduledFuture<?> heartbeatTask;

        /* private void startHeartbeatMonitor(Session session) {
        //Needed once we start UI
            scheduler.scheduleAtFixedRate(() -> {
            long now = System.currentTimeMillis();
            if (now - lastMessageReceived > 30000) { // 30 seconds without heartbeat
               System.err.println(" No heartbeat received in 30s.");
               try {
                   session.close();
               } catch (IOException e) {
                   e.printStackTrace();
               }
               reconnect();
            }
         }, 10, 10, TimeUnit.SECONDS);
      } */

   private void startClientHeartbeat(Session session) {
      if (heartbeatTask != null && !heartbeatTask.isCancelled()) {
         System.out.println("Heartbeat already running — skipping duplicate start.");
         return;
      }

      heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
         try {
            if (session != null && session.isOpen() && isLoggedIn) {
               Service.Heartbeat heartbeat = Service.Heartbeat.newBuilder()
                  .setTimestamp(System.currentTimeMillis())
                  .build();
               Service.ClientMessage ping = Service.ClientMessage.newBuilder()
                  .setHeartbeat(heartbeat)
                  .build();
                  session.getAsyncRemote().sendBinary(ByteBuffer.wrap(ping.toByteArray()));
                  System.out.println("\nSent heartbeat ping");
            } 
            else
            {
               System.out.println("\nHeartbeat paused — session closed or login not complete.");
            }
         } catch (Exception e) {
            System.err.println("/nFailed to send heartbeat ping");
            e.printStackTrace();
         }
      }, 0, 20, TimeUnit.SECONDS);
   }


   private void stopClientHeartbeat() {
      if (heartbeatTask != null && !heartbeatTask.isCancelled()) {
         heartbeatTask.cancel(true); // true = interrupt if running
         System.out.println("\nHeartbeat task cancelled.");
         heartbeatTask = null;
      } 
      else 
      {
         System.out.println("\nNo active heartbeat to stop.");
      }  
   }


      //this is used to decode the token trying to make the switch statement less complex 
       /* public void handleIncomingMessage(String jwtToken) 
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
      } */



        public static void main(String[] args){
         try{
            connect();
            Thread.sleep(50000);
            disconnect();
         }
         catch(Exception e){
            e.printStackTrace();
         }

      }


      }

     


