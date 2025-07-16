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
import t4proto.v1.common.Enums.PriceFormat;
import t4proto.v1.common.Enums.LoginResult;
import t4proto.v1.service.Service; // For ClientMessage
import t4proto.v1.service.Service.ServerMessage;
import t4proto.v1.account.Account;//import static t4proto.v1.service.Service.ServerMessage.PayloadCase.*;
import t4proto.v1.market.Market.MarketSnapshot;
import t4proto.v1.market.Market.MarketSnapshotMessage;
import t4proto.v1.market.Market.MarketDepth;
import t4proto.v1.market.Market.MarketDepthTrade;
import t4proto.v1.market.Market.MarketDepth.TradeData;
import t4proto.v1.market.Market.MarketDetails;
import t4proto.v1.market.Market.MarketDepthSubscribe;
import t4proto.v1.service.Service.ClientMessage;
import t4proto.v1.account.Account.AccountDetails;
//import t4proto.v1.auth.Auth.LoginResponse.Account;


//market sybscriber
import com.t4.helpers.MarketSubscriber;
import com.t4.helpers.Callback;

// WebSocket imports
import javax.websocket.*;
import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.google.protobuf.ProtoSyntax;
import com.google.protobuf.Descriptors.FieldDescriptor;
// Helper class you’ve written
import com.t4.helpers.ClientMessageHelper;
import com.t4.T4Config;
import com.t4.MarketDataPane;


import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.stream.Collectors;
import org.json.JSONObject;
// Java stdlib
import java.net.URI;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;
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
        private Auth.LoginResponse loginResponse = null;
        private Map<String, Auth.LoginResponse.Account> accounts = new HashMap<>();
        private Object selectedAccount = null;
        private boolean isLoggedIn = false; //starts heartbeats once loggedin and connncted


        private Map<String, Auth.LoginResponse.Account> loginAccounts = new HashMap<>();
        private Map<String, AccountDetails> accountDetails = new HashMap<>();

        
        // JWT token management
        private String jwtToken = null;
        private Long jwtExpiration = null;
        private Object pendingTokenRequest = null;

        // Market data
        private MarketDataPane marketDataP;
        private MarketSubscriber marketSubscriber = new MarketSubscriber();
        private Map<String, MarketDepth> marketSnapshots = new HashMap<>();
        private Object currentSubscription = null;
        private Map<String, MarketDetails> marketDetailsMap = new HashMap<>();
        private String currentMarketId = null;

        // Order/Position tracking
        private Map<String, Object> positions = new HashMap<>();
        private Map<String, Object> orders = new HashMap<>();

        // Heartbeat management
        private Object heartbeatTimer = null;
        private long lastMessageReceived = System.currentTimeMillis();

        // Event handlers
        //private Object onConnectionStatusChanged = null;
        private Object onAccountUpdate = null;
        //private Object onMarketHeaderUpdate = null;
        private Object onMarketUpdate = null;
        private Object onMessageSent = null;
        //private Object onMessageReceived = null;
        private Object onError = null;
        private Object onLog = null;

        // Connection retry
        private int reconnectAttempts = 0;
        private int maxReconnectAttempts = 10;
        private int reconnectDelay = 1000;
        private Runnable onConnectedCallback;

        private boolean isDisposed = false;
        private static Session session;


      //ON OPEN 
      //made some functions for the UI! I am going to work on the UI and token handling tomorrow! 
        @OnOpen

        public void onOpen(Session sessionO){
         System.out.println("Connected to Websocket");
         handleConnectionStatusChanged(true);
         session = sessionO;

          if (onConnectedCallback != null) {
            onConnectedCallback.run();  // ✅ UI will now update here!
            onConnectedCallback = null; // clear to avoid reuse
         }

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
            marketDetailsMap.clear();
            startClientHeartbeat(sessionO);
            session = sessionO;
            marketSubscriber.setMessageSender((msg, cb) -> {
            try {
               sessionO.getAsyncRemote().sendBinary(ByteBuffer.wrap(msg.toByteArray()));
               cb.onComplete();
            } catch (Exception e) {
               cb.onError(e);
            }
         });
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
                  handleLoginResponse(serverMessage.getLoginResponse());
                  System.out.println("Login Response Recieved: \n" + serverMessage.getLoginResponse());
                  AuthenticationToken token = serverMessage.getLoginResponse().getAuthenticationToken();
                  System.out.println("Token from the response: " + tokenHandler(token));
                  isLoggedIn = true;

                  break;
               
               case MARKET_SNAPSHOT:
                  handleMarketSnapshot(serverMessage.getMarketSnapshot());
                  break;

               case MARKET_DEPTH_SUBSCRIBE_REJECT:
                  System.out.println(" Market depth subscribe rejected: " + serverMessage.getMarketDepthSubscribeReject());
                  break;

               case MARKET_DETAILS:
                  MarketDetails marketDetails = serverMessage.getMarketDetails();

                  boolean isActive = !marketDetails.getDisabled()
                  && marketDetails.getActivationDate().getSeconds() * 1000 < System.currentTimeMillis()
                  && marketDetails.getLastTradingDate().getSeconds() * 1000 > System.currentTimeMillis();

                  if (isActive) {
                  System.out.println(" ACTIVE Market: " + marketDetails.getMarketId()
                  + " | Contract: " + marketDetails.getContractId()
                  + " | Exchange: " + marketDetails.getExchangeId());
        
                  // You can store it for later use if you want:
                     handleMarketDetails(marketDetails);
                  } else {
                     System.out.println(" Inactive/Unavailable Market: " + marketDetails.getMarketId());
                  }
                  break;

                  case MARKET_DEPTH:
                     handleMarketDepth(serverMessage.getMarketDepth());
                     break;

                  case ACCOUNT_DETAILS:
                     handleAccountDetails(serverMessage.getAccountDetails());
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

//On Error 
        @OnError

        public void onError(Session session, Throwable error){
         handleConnectionStatusChanged(false);
         System.out.println("Error occurred: ");
         error.printStackTrace();
         stopClientHeartbeat();
         //soon I will need add logic for certian errors if they are recoverable
        }

//On Close 
        @OnClose
        public void onClose(Session session, CloseReason reason){
         handleConnectionStatusChanged(false); 
         isLoggedIn = false; 
         stopClientHeartbeat();
         System.out.println("Disconnected: " + reason);
        }

//Token handler, still working on it! Make void when done 
      public  String tokenHandler(AuthenticationToken token) {
         if (token.hasToken()) {
            jwtToken = token.getToken();  // Make sure it's the raw JWT string
         } else {
            jwtToken = null;
         }

         if (token.hasExpireTime()) {
            jwtExpiration = token.getExpireTime().getSeconds() * 1000;
         }

         System.out.println("JWT Token Set: " + jwtToken);
    
         try {
            if(jwtToken != null){
               String marketId = fetchMarketIdFromApi("CME_Eq", "ES");
               currentMarketId = marketId;
            }
         } catch (IOException e) {
            System.err.println("Failed to auto-subscribe to market:");
            e.printStackTrace();
         }

         return "Token has been handled";
      }

        public void handleLoginResponse(Auth.LoginResponse response) {
            if (response.getResult() == LoginResult.LOGIN_RESULT_SUCCESS) {
            System.out.println("Login successful");
            this.loginResponse = response;
            this.isLoggedIn = true;
            this.reconnectAttempts = 0;

        // Process JWT token
            if (response.hasAuthenticationToken()) {
               handleAuthenticationToken(response.getAuthenticationToken());
            }

        /* // Store accounts (pseudo-handling — needs real model mapping)
        accounts.clear(); */
            for (Auth.LoginResponse.Account account : response.getAccountsList()) {
               //accounts.put(account.getAccountId(), account); // assuming map<String, Object>
               loginAccounts.put(account.getAccountId(), account);
            }
            System.out.println(loginAccounts);
            // Trigger account update if needed
            if (onAccountUpdate != null) {
               // Wrap in real update logic or class
               System.out.println("Accounts updated");
            }
               handleConnectionStatusChanged(true);

         } else {
            System.err.println("Login failed: " + response.getErrorMessage());
            disconnect(); // or close socket
         }

      }

      public void handleAccountDetails(AccountDetails details) {
         accountDetails.put(details.getAccountId(), details);
         System.out.println(accountDetails);
         System.out.println("Updated account: " + details.getAccountId());
      }

      private void handleConnectionStatusChanged(boolean connected) {
         this.isConnected = connected;
         System.out.println("Connection status changed: " + (connected ? "Connected" : "Disconnected"));
         // optionally notify UI or trigger retry logic here
      }

      public void handleAuthenticationToken(AuthenticationToken token) {
    if (token == null || token.getToken().isEmpty()) {
        System.err.println("Authentication token missing.");
        return;
    }

    this.jwtToken = token.getToken();

    if (token.hasExpireTime()) {
        this.jwtExpiration = token.getExpireTime().getSeconds() * 1000;
    }

    // Optionally resolve pending requests
    if (pendingTokenRequest != null) {
        // This is pseudo-code — implement CompletableFuture-like mechanism if needed
        // pendingTokenRequest.complete(jwtToken);
        pendingTokenRequest = null;
    }

    System.out.println("Authentication token received");
}

public String getAuthToken() throws Exception {
    System.out.println("JWT token at getAuthToken(): " + jwtToken);
    long now = System.currentTimeMillis();
    if (jwtToken != null && jwtExpiration != null && now < jwtExpiration - 30000) {
        return jwtToken;
    }
    throw new IOException("JWT token is expired or not available.");
}


      /*This is for handling the market,  */
      public void setMarketDataP(MarketDataPane pane) {
         this.marketDataP = pane;
      }

      public void handleMarketSnapshot(MarketSnapshot snapshot) {
       String symbol = snapshot.getMarketId();
       String bid = "--";
       String ask = "--";
       String last = "--";

       for (MarketSnapshotMessage message : snapshot.getMessagesList()) {
        if (message.hasMarketDepth()) {
            MarketDepth depth = message.getMarketDepth();
            System.out.println("This is the market depth: \n"+ depth);
            if (!depth.getBidsList().isEmpty()) {
                bid = String.valueOf(depth.getBids(0).getPrice().getValue());
            }
            if (!depth.getOffersList().isEmpty()) {
                ask = String.valueOf(depth.getOffers(0).getPrice().getValue());
            }
            if(depth.hasTradeData()){
               TradeData trade = depth.getTradeData();
               last = trade.getLastTradeVolume() + "@" + trade.getLastTradePrice().getValue();
               
            }

            MarketDetails details = getMarketDetails(snapshot.getMarketId());
            if (details != null && details.getContractId() != null && details.getExpiryDate() > 0) {
               updateMarketHeader(details.getContractId(), details.getExpiryDate());
            }
         
         }
        
       }

       System.out.printf("Market Snapshot [%s] | Bid: %s | Ask: %s | Last: %s%n", symbol, bid, ask, last);

       if (marketDataP != null) {
         marketDataP.updateSymbol(symbol);
         marketDataP.updateBid(bid);
         marketDataP.updateAsk(ask);
         marketDataP.updateLast(last);
      }
   }

      private void subscribeToMarket(String exchangeId, String contractId, String marketId){
          marketSubscriber.subscribeMarket(exchangeId, contractId, marketId, new Callback() {

            @Override
        public void onComplete() {
            System.out.println("Subscribed to market: " + marketId);
        }

        @Override
        public void onError(Exception e) {
            System.err.println("Subscription failed for " + marketId + ": " + e.getMessage());
        }
    });

   }


   public void subscribeToMarket(MarketDetails market) {
      marketSubscriber.subscribeMarket(
        market.getExchangeId(),
        market.getContractId(),
        market.getMarketId(),
        new Callback() {
            @Override
            public void onComplete() {
                System.out.println("Subscribed to market: " + market.getMarketId());
            }

            @Override
            public void onError(Exception e) {
                System.err.println("Subscription failed for " + market.getMarketId() + ": " + e.getMessage());
            }
        }
      );
   }



      public void handleMarketDepth(MarketDepth depth) {
         String symbol = depth.getMarketId();
         String bid = "";
         String bidP = "";
         String ask = "";
         String last = "";

         //System.out.println(depth.getLastTradePrice());

         if (!depth.getBidsList().isEmpty()) {
            bid = String.valueOf(depth.getBids(0).getVolume() +"@"+ depth.getBids(0).getPrice().getValue());
         }
         if (!depth.getOffersList().isEmpty()) {
            ask = String.valueOf(depth.getOffers(0).getVolume() +"@"+depth.getOffers(0).getPrice().getValue());
         }
         if(depth.hasTradeData()){
               TradeData trade = depth.getTradeData();
               last = trade.getLastTradeVolume() + "@" + trade.getLastTradePrice().getValue();    
         }
         

         System.out.printf(" Market Depth [%s] | Bid: %s | Ask: %s%n", symbol, bid, ask);

         MarketDetails details = getMarketDetails(depth.getMarketId());
         if (details != null && details.getContractId() != null && details.getExpiryDate() > 0) {
            updateMarketHeader(details.getContractId(), details.getExpiryDate());
         }

         if (marketDataP != null) {
            marketDataP.updateSymbol(symbol);
            marketDataP.updateBid(bid);
            marketDataP.updateAsk(ask);
            marketDataP.updateLast(last);
         }
      }

      public void handleMarketDetails(MarketDetails details) {
         System.out.println("Received market details: " + details.getMarketId());

         if (!details.getDisabled()) {
        marketDetailsMap.put(details.getMarketId(), details);

        // Optional: auto-subscribe to the first available market
         if (!marketDetailsMap.containsKey(details.getMarketId())) {
             marketDetailsMap.put(details.getMarketId(), details);
         }
      }
      }

      public MarketDetails getMarketDetails(String marketId) {
         return marketDetailsMap.get(marketId);
      }

      public boolean hasMarketDetails(String marketId) {
         return marketDetailsMap.containsKey(marketId);
      }  

      public void updateMarketHeader(String contractId, int expiryDate) {
         String expiryStr = String.valueOf(expiryDate);
         if (expiryStr.length() < 6) {
            return;
         } 

         String year = expiryStr.substring(2, 4);
         String month = expiryStr.substring(4, 6);

         Map<String, String> monthCodes = new HashMap<>();
         monthCodes.put("01", "F"); monthCodes.put("02", "G"); monthCodes.put("03", "H");
         monthCodes.put("04", "J"); monthCodes.put("05", "K"); monthCodes.put("06", "M");
         monthCodes.put("07", "N"); monthCodes.put("08", "Q"); monthCodes.put("09", "U");
         monthCodes.put("10", "V"); monthCodes.put("11", "X"); monthCodes.put("12", "Z");

         String monthCode = monthCodes.getOrDefault(month, month);
         String formatted = contractId + monthCode + year;

         // Assuming a UI method (you can replace this with actual UI label logic)
         System.out.println("Updated header: " + formatted);
      }


      public String fetchMarketIdFromApi(String exchangeId, String contractId) throws IOException {
        String endpoint = String.format(
            "https://api-sim.t4login.com/markets/picker/firstmarket?exchangeid=%s&contractid=%s",
            exchangeId, contractId
        );

        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Content-Type", "application/json");

        // Optionally include API key if available
         if (jwtToken != null && !jwtToken.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + jwtToken);
         } else {
            throw new IOException("JWT token not available. Cannot authorize HTTP request.");
         }

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String json = reader.lines().collect(Collectors.joining());
                JSONObject obj = new JSONObject(json);
                String marketId = obj.getString("marketID");

                // Optional: auto-subscribe using this marketId
                System.out.println("Fetched market ID: " + marketId);
                subscribeToMarket(exchangeId, contractId, marketId);

                return marketId;
            }
        } else {
            throw new IOException("Failed to fetch market ID. HTTP status: " + responseCode);
        }
      }

      public Map<String, String> getMarketLabelToIdMap() {
         Map<String, String> labelToId = new HashMap<>();
         for (MarketDetails md : marketDetailsMap.values()) {
            String label = md.getExchangeId() + " " + md.getContractId() + " (" + md.getMarketId() + ")";
            labelToId.put(label, md.getMarketId());
         }
         return labelToId;
      }


      public void selectMarket(String marketId) {
         MarketDetails details = marketDetailsMap.get(marketId);
         if (details != null) {
            this.currentMarketId = marketId;
            subscribeToMarket(details); // reuses your existing method
         } else {
            System.err.println("Market ID not found: " + marketId);
         }
      }



      public List<MarketDetails> getAllMarkets() {
         return new ArrayList<>(marketDetailsMap.values());
      }

      

      public void requestNewToken(String requestId) {
         Auth.AuthenticationTokenRequest request = Auth.AuthenticationTokenRequest.newBuilder()
            .setRequestId(requestId)
            .build();

         ClientMessage msg = ClientMessage.newBuilder().setAuthenticationTokenRequest(request).build();
         sendMessageToServer(msg);
      }

      

      private void sendMessageToServer(ClientMessage msg) {
         if (session != null && session.isOpen()) {
            session.getAsyncRemote().sendBinary(ByteBuffer.wrap(msg.toByteArray()));
         } else {
            System.err.println("Cannot send message — session is closed.");
         }
      }


      /*connect, recconet and disconnnect are under here. 
      * reconnect is not us use right now as this will be used in certian 
      * errors when you can come back from them.
       */

        //reconnect will be used when I make the 
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

      public boolean connect(Runnable onConnected) {
         try {
            this.onConnectedCallback = onConnected; // store for later use
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




   /*This is for the heartbeat funstionallity and get Instance, methods
   (stat and stop heartbeat, get instance and main) are under here.*/

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
            T4APIClientTest.getInstance().connect(() -> {}); 
            Thread.sleep(50000);
            disconnect();
         }
         catch(Exception e){
            e.printStackTrace();
         }

      }


}

     


