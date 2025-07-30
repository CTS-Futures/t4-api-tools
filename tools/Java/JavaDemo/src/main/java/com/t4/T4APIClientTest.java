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
import t4proto.v1.orderrouting.Orderrouting.OrderUpdate;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdateMulti;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdateStatus;
import t4proto.v1.account.Account.AccountPosition;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdateMultiMessage;
import t4proto.v1.orderrouting.Orderrouting;
import t4proto.v1.orderrouting.Orderrouting.OrderUpdate;
import t4proto.v1.common.Enums.AccountSubscribeType;
import t4proto.v1.common.Enums.BuySell;
import t4proto.v1.common.Enums.PriceType;
import t4proto.v1.common.Enums.TimeType;
import t4proto.v1.common.Enums.OrderLink;
import t4proto.v1.common.Enums.ActivationType;
import t4proto.v1.common.PriceOuterClass.Decimal;


import t4proto.v1.orderrouting.Orderrouting.OrderSubmit.Order;
import t4proto.v1.orderrouting.Orderrouting.OrderSubmit;
import t4proto.v1.orderrouting.Orderrouting.OrderPull;
import t4proto.v1.orderrouting.Orderrouting.OrderRevise;
import t4proto.v1.orderrouting.Orderrouting.OrderRevise.Revise;
import t4proto.v1.common.PriceOuterClass.Price;

//market sybscriber
import com.t4.helpers.MarketSubscriber;
import com.t4.helpers.Callback;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

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
import java.util.concurrent.ConcurrentHashMap;
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

import javafx.application.Platform;

 

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
        private String selectedAccount = null;
        private boolean isLoggedIn = false; //starts heartbeats once loggedin and connncted
        private Map<String, Auth.LoginResponse.Account> loginAccounts = new HashMap<>();
        private Map<String, AccountDetails> accountDetails = new HashMap<>();
        private boolean accountSubscribed = false;
        private String pendingAccountId = null;
        private boolean gotAccountPosition = false;
        private boolean gotAccountUpdate = false;
        private boolean gotOrderUpdateMulti = false;

        
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
        private Map<String, AccountPosition> positions = new ConcurrentHashMap<>();
        private Map<String, OrderUpdate> orders = new ConcurrentHashMap<>();
        private PositionsAndOrdersUI posOrdersUI;
        //private PositionsAndOrdersUI positionsAndOrdersUI;


        // Heartbeat management
        private Object heartbeatTimer = null;
        private long lastMessageReceived = System.currentTimeMillis();
        private String selectedAccountId;

        // Event handlers
        private Object onAccountUpdate = null;
        private Object onMarketUpdate = null;
        private Object onMessageSent = null;
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
        @OnOpen

        public void onOpen(Session sessionO){
         System.out.println("Connected to Websocket");
         handleConnectionStatusChanged(true);
         session = sessionO;

          if (onConnectedCallback != null) {
            onConnectedCallback.run();  
            onConnectedCallback = null;
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

                  case ACCOUNT_POSITION:
                     handleAccountPosition(serverMessage.getAccountPosition());
                     gotAccountPosition = true;
                     checkIfAccountReady();
                     break;

                  case ACCOUNT_UPDATE:
                     handleAccountUpdate(serverMessage.getAccountUpdate());
                     gotAccountUpdate = true; 
                     checkIfAccountReady();
                     break;
               
                  case ORDER_UPDATE_MULTI:
                     handleOrderUpdateMulti(serverMessage.getOrderUpdateMulti());
                     gotOrderUpdateMulti = true; 
                     checkIfAccountReady();
                     break;

                  case ACCOUNT_SNAPSHOT:
                     handleAccountSnapshot(serverMessage.getAccountSnapshot());
                     break;
                  
                  case ACCOUNT_SUBSCRIBE_RESPONSE:
                     handleAccountSubscribeResponse(serverMessage.getAccountSubscribeResponse());
                     System.out.println("Successfully subscribed to account: " + serverMessage.getAccountSubscribeResponse());
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
            if(jwtToken != null && currentMarketId == null){
               String marketId = fetchMarketIdFromApi("CME_Eq", "ES");
               currentMarketId = marketId;
            }
         } catch (IOException e) {
            System.err.println("Failed to auto-subscribe to market:");
            e.printStackTrace();
         }

         return "Token has been handled";
      }


      private void checkIfAccountReady() {
         System.out.println("Checking if account is ready to trade "+ isConnected + " " + gotAccountPosition + " " + gotAccountUpdate + " " + gotOrderUpdateMulti);
    if (!isConnected && gotAccountPosition && gotAccountUpdate && gotOrderUpdateMulti) {
        isConnected = true;
        System.out.println("✅ Account is now ready to trade.");
    }
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
               loginAccounts.put(account.getAccountId(), account);
            }
            //System.out.println(loginAccounts);
            // Trigger account update if needed
            if (onAccountUpdate != null) {
               // Wrap in real update logic or class
               System.out.println("Accounts updated");
            }

            if (!loginAccounts.isEmpty()) {
               selectedAccountId = loginAccounts.keySet().iterator().next(); // auto-pick first
               System.out.println("Selected account: " + selectedAccountId);
            }
               handleConnectionStatusChanged(true);

         } else {
            System.err.println("Login failed: " + response.getErrorMessage());
            disconnect(); // or close socket
         }
         if (posOrdersUI != null) {
            Platform.runLater(() -> posOrdersUI.updatePositionsAndOrders(getPositions(), getOrders()));
         }
         if (selectedAccountId != null) {
               subscribeToAccount(selectedAccountId);
         }

      }

      public void handleAccountDetails(AccountDetails details) {
         accountDetails.put(details.getAccountId(), details);
         System.out.println(accountDetails);
         System.out.println("Updated account: " + details.getAccountId());
      }

      private void handleAccountUpdate(Account.AccountUpdate update) {
         //isConnected = true;
         System.out.println("Account update for account: " + update.getAccountId());
      }

      private void handleAccountSnapshot(Account.AccountSnapshot snapshot) {
    List<AccountPosition> newPositions = new ArrayList<>();
    List<OrderUpdate> newOrders = new ArrayList<>();

    for (Account.AccountSnapshotMessage msg : snapshot.getMessagesList()) {
        switch (msg.getPayloadCase()) {
            case ACCOUNT_POSITION:
                newPositions.add(msg.getAccountPosition());
                break;

            case ORDER_UPDATE_MULTI:
               gotOrderUpdateMulti = true;
                for (Orderrouting.OrderUpdateMultiMessage update : msg.getOrderUpdateMulti().getUpdatesList()) {
                    if (update.getPayloadCase() == Orderrouting.OrderUpdateMultiMessage.PayloadCase.ORDER_UPDATE) {
                        newOrders.add(update.getOrderUpdate());
                    }
                }
                break;

             case ACCOUNT_DETAILS:
                handleAccountDetails(msg.getAccountDetails());
                break;

            case ACCOUNT_UPDATE:
                handleAccountUpdate(msg.getAccountUpdate());
                gotAccountUpdate = true;
                break;

            default:
                System.out.println("Unhandled snapshot message: " + msg.getPayloadCase());
        }
    }

    System.out.printf("Received snapshot: %d positions, %d orders\n", newPositions.size(), newOrders.size());

    for (AccountPosition pos : newPositions) {
        String key = pos.getAccountId() + "_" + pos.getMarketId();
        positions.put(key, pos);
    }

    for (OrderUpdate ord : newOrders) {
        orders.put(ord.getUniqueId(), ord);
    }

    // Push to UI
    if (posOrdersUI != null) {
        Platform.runLater(() -> posOrdersUI.updatePositionsAndOrders(newPositions, newOrders));
    }
    isConnected = true;
    checkIfAccountReady();
}

      private void handleConnectionStatusChanged(boolean connected) {
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
    long now = System.currentTimeMillis();
    if (jwtToken != null && jwtExpiration != null && now < jwtExpiration - 30000) {
        return jwtToken;
    }
    throw new IOException("JWT token is expired or not available.");
}


    public void subscribeToAccount(String accountId) {
    if (accountId == null || accountId.isEmpty()) {
        System.err.println("Invalid account ID for subscription.");
        return;
    }

    this.pendingAccountId = accountId;

    Account.AccountSubscribe subscribeMsg = Account.AccountSubscribe.newBuilder()
        .setSubscribe(AccountSubscribeType.ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES)
        .setSubscribeAllAccounts(false)
        .addAccountId(accountId)
        .build();

    ClientMessage clientMessage = ClientMessage.newBuilder()
        .setAccountSubscribe(subscribeMsg)
        .build();

    sendMessageToServer(clientMessage);
    System.out.println("Sent subscription request for account: " + accountId);
    }

    private void handleAccountSubscribeResponse(Account.AccountSubscribeResponse response) {
    if (response.getSuccess()) {
        this.selectedAccountId = pendingAccountId;
        this.accountSubscribed = true;
        System.out.println("Account subscription confirmed for: " + selectedAccountId);
    } else {
        System.err.println("Account subscription failed: " + response.getErrorsList());
    }

    pendingAccountId = null;
}

   public void updatePositionsAndOrders(List<AccountPosition> positions,List<OrderUpdate> orders) {
    // TODO: Implement table update logic here
    System.out.println("Positions: " + positions.size() + ", Orders: " + orders.size());
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

        System.out.println("Fetching marketId for exchange=" + exchangeId + ", contract=" + contractId);

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

      public void unsubscribeFromCurrentMarket() {
         if (currentMarketId != null) {
            marketSubscriber.unsubscribeCurrent(new Callback() {
    @Override
    public void onComplete() {
        System.out.println("Unsubscribed from previous market.");
    }

    @Override
    public void onError(Exception e) {
        System.err.println("Unsubscribe failed: " + e.getMessage());
    }
});
        currentMarketId = null;
    }
}


   //orders and positions 

   private void handleOrderUpdate(OrderUpdate update) {
    if (posOrdersUI == null) return;

    String market = update.getMarketId();
    String side = update.getBuySell().name(); // BUY_SELL_BUY or SELL
    int volume = update.getWorkingVolume();
    String price = update.hasCurrentLimitPrice()
    ? String.valueOf(update.getCurrentLimitPrice().getValue()): "";
    String status = update.getStatus().name();        // <- was `getOrderStatus()`
    String action = update.getChange().name();        // <- was `getOrderAction()`

    Platform.runLater(() -> {
        posOrdersUI.addOrder(
            market,
            side,
            volume,
            price,
            status,
            action
        );
    });
}


   private void handleOrderUpdateMulti(OrderUpdateMulti updateMulti) {
    for (OrderUpdateMultiMessage message : updateMulti.getUpdatesList()) {
        switch (message.getPayloadCase()) {
            case ORDER_UPDATE:
                handleOrderUpdate(message.getOrderUpdate());
                break;
            case ORDER_UPDATE_STATUS:
                handleOrderUpdateStatus(message.getOrderUpdateStatus());
                break;
            case ORDER_UPDATE_FAILED:
                System.out.println("Order update failed: " + message.getOrderUpdateFailed());
                break;
            case ORDER_UPDATE_TRADE:
                System.out.println("Order trade: " + message.getOrderUpdateTrade());
                break;
            case ORDER_UPDATE_TRADE_LEG:
                System.out.println("Order trade leg: " + message.getOrderUpdateTradeLeg());
                break;
            case PAYLOAD_NOT_SET:
            default:
                System.out.println("Unhandled update type in OrderUpdateMultiMessage: " + message.getPayloadCase());
        }
    }
}

   private void handleOrderUpdateStatus(OrderUpdateStatus status) {
    OrderUpdate existing = orders.getOrDefault(
        status.getUniqueId(),
        OrderUpdate.newBuilder()
            .setUniqueId(status.getUniqueId())
            .setAccountId(selectedAccountId)
            .setMarketId(status.getMarketId())
            .build()
    );

    // Convert protobuf Timestamp to formatted string
    String formattedTime = status.hasTime()
        ? Instant.ofEpochSecond(status.getTime().getSeconds()).toString()
        : "";

    // Rebuild the order with updated status
    OrderUpdate updated = existing.toBuilder()
        .setStatus(status.getStatus())
        .setWorkingVolume(status.getWorkingVolume())
        .setTime(status.getTime())
        .setExchangeOrderId(status.getExchangeOrderId())
        .setPriceType(status.getPriceType())
        .build();

    orders.put(status.getUniqueId(), updated);

    // Display in UI
    if (posOrdersUI != null) {
        String market = status.getMarketId();
        String side = existing.getBuySell().name(); // fallback
        int volume = status.getWorkingVolume();
        String price = status.hasCurrentLimitPrice()
          ? String.valueOf(status.getCurrentLimitPrice().getValue()) : "--";
        String statusText = status.getStatus().name();
        String action = status.getChange().name(); // << This replaces getAction()

        Platform.runLater(() -> posOrdersUI.addOrder(
            market,
            side,
            volume,
            price,
            statusText,
            action
        ));
    }
}


private void handleAccountPosition(AccountPosition position) {
    // Track position by account + market
    String key = position.getAccountId() + "_" + position.getMarketId();
    positions.put(key, position);

    // Update only if it's for the currently selected account
    if (position.getAccountId().equals(selectedAccountId) && posOrdersUI != null) {
        String market = position.getMarketId();
        int net = position.getBuys() - position.getSells();
        double pnl = position.getRpl(); // or getUnrealizedPnl()
        int working = position.getWorkingBuys() + position.getWorkingSells();

        Platform.runLater(() -> posOrdersUI.updatePosition(market, net, pnl, working));
    }
    //isConnected = true;
}


public List<OrderUpdate> getOrders() {
    return orders.values().stream()
        .filter(o -> o.getAccountId().equals(selectedAccountId))
        .collect(Collectors.toList());
}

public List<AccountPosition> getPositions() {
    return positions.values().stream()
        .filter(p -> p.getAccountId().equals(selectedAccountId))
        .collect(Collectors.toList());
}

   public void setPositionsAndOrdersUI(PositionsAndOrdersUI ui) {
      this.posOrdersUI = ui;
   }




public void submitOrder(String side, int volume, double price, String priceType,
                        Double takeProfitDollars, Double stopLossDollars) {
      System.out.println("Everything from Submit Orders: " + accountSubscribed + isConnected + selectedAccountId);                     

    if (selectedAccountId == null || currentMarketId == null || !accountSubscribed || !isConnected) {
        throw new IllegalStateException("No account or market selected or account not subscribed");
    }

    MarketDetails marketDetails = marketDetailsMap.get(currentMarketId);
    if (marketDetails == null) {
        System.err.println("Market details not found for marketId: " + currentMarketId);
        return;
    }

    BuySell buySell = side.equalsIgnoreCase("buy") ? BuySell.BUY_SELL_BUY : BuySell.BUY_SELL_SELL;
    PriceType priceTypeEnum = priceType.equalsIgnoreCase("market") ?
        PriceType.PRICE_TYPE_MARKET : PriceType.PRICE_TYPE_LIMIT;

    boolean hasBracketOrders = takeProfitDollars != null || stopLossDollars != null;
    OrderLink orderLink = hasBracketOrders ? OrderLink.ORDER_LINK_AUTO_OCO : OrderLink.ORDER_LINK_NONE;

    List<Order> orders = new ArrayList<>();

    // Main order
    Order.Builder mainOrder = Order.newBuilder()
        .setBuySell(buySell)
        .setPriceType(priceTypeEnum)
        .setTimeType(TimeType.TIME_TYPE_NORMAL)
        .setVolume(volume);

    if (priceTypeEnum == PriceType.PRICE_TYPE_LIMIT) {
        mainOrder.setLimitPrice(Price.newBuilder().setValue(String.valueOf(price)).build());
    }

    orders.add(mainOrder.build());

    // Determine opposite side for bracket protection
    BuySell protectionSide = (buySell == BuySell.BUY_SELL_BUY) ?
        BuySell.BUY_SELL_SELL : BuySell.BUY_SELL_BUY;

    // Logging: Order summary
    System.out.printf("Order submitted: %s %d @ %s (Type: %s)%n",
        buySellToString(buySell), volume,
        priceTypeEnum == PriceType.PRICE_TYPE_MARKET ? "Market" : price,
        priceType);

    // Take Profit
    if (takeProfitDollars != null) {
        double pointValue = Double.parseDouble(marketDetails.getPointValue().getValue());
        double minTick = Double.parseDouble(marketDetails.getMinPriceIncrement().getValue());
        double tpPoints = takeProfitDollars / pointValue;
        double tpPrice = tpPoints * minTick;

        orders.add(Order.newBuilder()
            .setBuySell(protectionSide)
            .setPriceType(PriceType.PRICE_TYPE_LIMIT)
            .setTimeType(TimeType.TIME_TYPE_GOOD_TILL_CANCELLED)
            .setVolume(0)
            .setLimitPrice(Price.newBuilder().setValue(String.valueOf(tpPrice)).build())
            .setActivationType(ActivationType.ACTIVATION_TYPE_HOLD)
            .build());

        System.out.printf("Take profit: $%.2f (%s) at approx price offset: %.4f%n",
            takeProfitDollars, buySellToString(protectionSide), tpPrice);
    }

    // Stop Loss
    if (stopLossDollars != null) {
        double pointValue = Double.parseDouble(marketDetails.getPointValue().getValue());
        double minTick = Double.parseDouble(marketDetails.getMinPriceIncrement().getValue());
        double slPoints = stopLossDollars / pointValue;
        double slPrice = slPoints * minTick;

        orders.add(Order.newBuilder()
            .setBuySell(protectionSide)
            .setPriceType(PriceType.PRICE_TYPE_STOP_MARKET)
            .setTimeType(TimeType.TIME_TYPE_GOOD_TILL_CANCELLED)
            .setVolume(0)
            .setStopPrice(Price.newBuilder().setValue(String.valueOf(slPrice)).build())
            .setActivationType(ActivationType.ACTIVATION_TYPE_HOLD)
            .build());

        System.out.printf("Stop loss: $%.2f (%s) at approx price offset: %.4f%n",
            stopLossDollars, buySellToString(protectionSide), slPrice);
    }

    if (hasBracketOrders) {
        System.out.println("OCO (One Cancels Other) bracket order applied.");
    }

    OrderSubmit orderSubmit = OrderSubmit.newBuilder()
        .setAccountId(selectedAccountId)
        .setMarketId(currentMarketId)
        .setManualOrderIndicator(true)
        .setOrderLink(orderLink)
        .addAllOrders(orders)
        .build();

    ClientMessage msg = ClientMessage.newBuilder()
        .setOrderSubmit(orderSubmit)
        .build();

    sendMessageToServer(msg);
}


   private String buySellToString(BuySell bs) {
    switch (bs) {
        case BUY_SELL_BUY: return "Buy";
        case BUY_SELL_SELL: return "Sell";
        default: return "Unknown";
    }
}


   public void pullOrder(String orderId) {
    if (selectedAccountId == null || currentMarketId == null) {
        throw new IllegalStateException("No account or market selected");
    }

    OrderPull.Pull pull = OrderPull.Pull.newBuilder()
        .setUniqueId(orderId)
        .build();

    OrderPull orderPull = OrderPull.newBuilder()
        .setAccountId(selectedAccountId)
        .setMarketId(currentMarketId)
        .setManualOrderIndicator(true)
        .addPulls(pull)
        .build();

    ClientMessage msg = ClientMessage.newBuilder()
        .setOrderPull(orderPull)
        .build();

    sendMessageToServer(msg);
}


public void reviseOrder(String orderId, int volume, Double price, String priceType) {
    if (selectedAccountId == null || currentMarketId == null) {
        throw new IllegalStateException("No account or market selected");
    }

    OrderRevise.Revise.Builder reviseBuilder = OrderRevise.Revise.newBuilder()
        .setUniqueId(orderId)
        .setVolume(volume);

    if ("limit".equalsIgnoreCase(priceType) && price != null) {
        reviseBuilder.setLimitPrice(
            Price.newBuilder()
                .setValue(String.valueOf(price))
                .build()
        );
    }

    OrderRevise orderRevise = OrderRevise.newBuilder()
        .setAccountId(selectedAccountId)
        .setMarketId(currentMarketId)
        .setManualOrderIndicator(true)
        .addRevisions(reviseBuilder)
        .build();

    ClientMessage msg = ClientMessage.newBuilder()
        .setOrderRevise(orderRevise)
        .build();

    sendMessageToServer(msg);
}



   /* public static void main(String[] args){
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

      } */

      /* public static void main(String[] args) throws Exception {
         int x = 42;
         System.out.println("Before connect");
    T4APIClientTest client = new T4APIClientTest();

    client.connect(() -> {
        System.out.println("Connected, sleeping for 5 seconds...");
        try {
            
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        client.disconnect();
        System.out.println("Disconnected.");
    });

    // Block main thread until disconnect completes
    Thread.sleep(10000); // or use CountDownLatch to be more precise
} */

     /*  public static void main(String[] args) throws Exception {
    CountDownLatch latch = new CountDownLatch(1);
    T4APIClientTest client = T4APIClientTest.getInstance();

    client.connect(() -> {
        System.out.println("Connected callback triggered.");
        // Wait until accountSubscribed is true
        new Thread(() -> {
            while (!client.accountSubscribed) {
                try {
                    Thread.sleep(100); // Polling
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }

            System.out.println("Account subscribed. Submitting order...");
            client.submitOrder("buy", 1, 5298.00, "limit", 20.0, 10.0);
            latch.countDown(); // signal main thread to continue
        }).start();
    });

    latch.await(); // block main thread until signal from async task
    client.disconnect();
    System.out.println("All done. Disconnected.");
} */


     /*  public static void main(String[] args) throws Exception {
    CountDownLatch latch = new CountDownLatch(1);
    T4APIClientTest client = T4APIClientTest.getInstance();

    ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();

    client.connect(() -> {
        System.out.println("Connected callback triggered.");

        // Wait until subscribed before submitting
        new Thread(() -> {
            while (!client.accountSubscribed) {
                try {
                    Thread.sleep(100); // Wait for subscription
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }

            System.out.println("Account subscribed. Submitting order...");
            client.submitOrder("buy", 1, 5298.00, "limit", 20.0, 10.0);

            // Wait 3 seconds to observe result
            executor.schedule(() -> {
                System.out.println("3 seconds passed. Now disconnecting...");
                client.disconnect();
                latch.countDown();
            }, 3, TimeUnit.SECONDS);

        }).start();
    });

    latch.await(); // Block main thread until everything is done
    executor.shutdown();
    System.out.println("All done.");
}
 */

 public static void main(String[] args) throws Exception {
    CountDownLatch doneLatch = new CountDownLatch(1);
    T4APIClientTest client = T4APIClientTest.getInstance();

    ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();

    client.connect(() -> {
        System.out.println("Connected callback triggered.");

        new Thread(() -> {
            try {
                System.out.println("Waiting for account to be fully ready...");

                // Wait until all conditions are met
                while (!(client.accountSubscribed && client.isConnected
                         && client.selectedAccountId != null && client.currentMarketId != null)) {
                    Thread.sleep(100);
                }

                System.out.println("✅ Account and market ready. Submitting order...");
                client.submitOrder("buy", 1, 5298.00, "limit", 20.0, 10.0);

                executor.schedule(() -> {
                    System.out.println("✅ 3 seconds passed. Now disconnecting...");
                    T4APIClientTest.disconnect();
                    doneLatch.countDown();
                }, 3, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }).start();
    });

    doneLatch.await();
    executor.shutdown();
    System.out.println("✅ All done.");
}

}

     


