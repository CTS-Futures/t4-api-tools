    //Start with Configuration and the constructor
    /*
     * Constructor has hearbeats that test the connections every 2 miliseconds 
     * What are tyhe message timeouts? 
     * 
     */

package com.t4;

// Protobuf-generated classes (adjust these based on actual generated package structure)
import t4proto.v1.auth.Auth; // For LoginRequest, AuthenticationTokenRequest, AuthenticationToken
import t4proto.v1.auth.Auth.AuthenticationToken;
import t4proto.v1.common.PriceOuterClass; // For PriceFormat
import t4proto.v1.common.Enums.PriceFormat;
import t4proto.v1.service.Service; // For ClientMessage
import t4proto.v1.service.Service.ServerMessage;
import t4proto.v1.account.Account;//import static t4proto.v1.service.Service.ServerMessage.PayloadCase.*;
import t4proto.v1.market.Market.MarketSnapshot;
import t4proto.v1.market.Market.MarketSnapshotMessage;

// WebSocket imports
import javax.websocket.*;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.google.protobuf.ProtoSyntax;
import com.google.protobuf.Descriptors.FieldDescriptor;
// Helper class you’ve written
import com.t4.helpers.ClientMessageHelper;
import com.t4.T4Config;
import com.t4.MarketDataPane;


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

//Having some threading problems
 

     @ClientEndpoint
     public class T4APIClientTest{
     
      private T4APIClientTest(){
         this.apiKey = T4Config.API_KEY;
         this.firm = T4Config.FIRM;
         this.userName = T4Config.USERNAME;
         this.password = T4Config.PASSWORD;
         this.appName = T4Config.APP_NAME;
         this.appLicense = T4Config.APP_LICENSE;
     }
      //Singleton state
       private static final T4APIClientTest instance = new T4APIClientTest();
       private String apiKey;
       private String firm;
       private String userName;
       private String password;
       private String appName;
       private String appLicense;
      
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


//ON OPEN 
      //made some functions for the UI! I am going to work on the UI and token handling tomorrow! 
        @OnOpen

        public void onOpen(Session sessionO){
         System.out.println("Connected to Websocket");
         isConnected = true;
         try{
            Auth.LoginRequest loginRequest = Auth.LoginRequest.newBuilder()
            .setApiKey(apiKey)
            .setFirm(firm)
            .setUsername(userName)
            .setPassword(password)
            .setAppName(appName)
            .setAppLicense(appLicense)
            .setPriceFormat(PriceFormat.PRICE_FORMAT_DECIMAL)
            .build();

            Service.ClientMessage clientMessage = ClientMessageHelper.wrapLoginRequest(loginRequest);
            sessionO.getAsyncRemote().sendBinary(ByteBuffer.wrap(clientMessage.toByteArray()));
            //might need hearbeat monitor soon
            startClientHeartbeat(sessionO);
            session = sessionO;
            System.out.println("Login message sent.");
         }
         catch(Exception e){
             e.printStackTrace();
         }
        } 
//On Message 
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
               
               case MARKET_SNAPSHOT:
                  handleMarketSnapshot(serverMessage.getMarketSnapshot());
                  break;

               /* case AUTHENTICATION_TOKEN:
                  System.out.println("Made it to the token! ");
                  jwtToken = true;
                  Auth.AuthenticationToken tokenA = serverMessage.getAuthenticationToken();
                  Map<FieldDescriptor, Object> decodedJWT = tokenA.getAllFields();
                  System.out.println(tokenA.getExpireTime().getSeconds()/60);
                  System.out.println("Recieved Token: " + decodedJWT);
                  break; */
               
               default:
                   System.out.println("Received unknown payload: " + payloadCase);
         }

      } 
         catch (Exception e) {
            System.err.println("Failed to parse message:");
            e.printStackTrace();
         }
      }

//On Error 
        @OnError

        public void onError(Session session, Throwable error){
         System.out.println("Error occurred: ");
         error.printStackTrace();
         stopClientHeartbeat();
         //soon I will need add logic for certian errors if they are recoverable
        }

//On Close 
        @OnClose
        public void onClose(Session session, CloseReason reason){
         isConnected = false; 
         isLoggedIn = false; 
         stopClientHeartbeat();
         System.out.println("Disconnected: " + reason);
        }

//Token handler, still working on it! 
        public  String tokenHandler(AuthenticationToken token) {
         jwtToken = token.toString();

         if(token.hasExpireTime()){
            jwtExpiration = token.getExpireTime().getSeconds() * 1000;
         }
         //if token expires I need to request a new one
         System.out.println(jwtExpiration);

         return "Token had been handeled";
        }

      private MarketDataPane marketDataPane;

      public void setMarketDataPane(MarketDataPane pane) {
         this.marketDataPane = pane;
      }

      public void handleMarketSnapshot (MarketSnapshot snapshot){

         String symbol = snapshot.getMarketId();
         String bid = "--";
         String ask = "--";
         String last = "--";

         for (MarketSnapshotMessage message : snapshot.getMessagesList()) {
            if (message.hasMarketDepth()) {
               var depth = message.getMarketDepth();
               if (!depth.getBidsList().isEmpty()) {
                   bid = String.valueOf(depth.getBids(0).getPrice().getValue());
               }
               if (!depth.getOffersList().isEmpty()) {
                   ask = String.valueOf(depth.getOffers(0).getPrice().getValue());
               }
         }
            if (message.hasMarketDepthTrade()) {
               var trade = message.getMarketDepthTrade();
               last = String.valueOf(trade.getLastTradePrice().getValue());
         }
      }

         System.out.printf("Market Snapshot [%s] | Bid: %s | Ask: %s | Last: %s%n", symbol, bid, ask, last);

         if (marketDataPane != null) {
            MarketDataPane.updateSymbol(symbol);
            MarketDataPane.updateBid(bid);
            MarketDataPane.updateAsk(ask);
            MarketDataPane.updateLast(last);
         }
      }
//reconnect, not looking like it is needed...
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
      //connect!
         //will be used for the buttons 
         public boolean connect() {
         try {
            WebSocketContainer container = ContainerProvider.getWebSocketContainer();
            container.connectToServer(this, URI.create(T4Config.WS_URL));
            return true;
         } catch (DeploymentException | IOException e) {
            e.printStackTrace();
            return false;
         }
      }
         //used for buttons 
         //disconnect 
         static void disconnect(){
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

      //start heartbeats 
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

//stop hearbeats 
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
//get Instance 
      public static T4APIClientTest getInstance()
      {
         return instance;
      }

        public static void main(String[] args){
         try{
            //T4APIClientTest client = T4APIClientTest.getInstance();
            //ConnectionUI pane = new ConnectionUI(client);
            T4APIClientTest.getInstance().connect(); 
            Thread.sleep(50000);
            disconnect();
         }
         catch(Exception e){
            e.printStackTrace();
         }

      }


      }

     


