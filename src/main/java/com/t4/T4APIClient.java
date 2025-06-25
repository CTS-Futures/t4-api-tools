    //Start with Configuration and the constructor
    /*
     * Constructor has hearbeats that test the connections every 2 miliseconds 
     * What are tyhe message timeouts? 
     * 
     */

     package com.t4;
     import javax.websocket.*;

import com.t4.helpers.ClientMessageHelper;

import t4proto.v1.auth.Auth;

import java.net.URI;
import java.nio.ByteBuffer;
//   import java.util.HashMap;
   //   import java.util.Map;
   //   import java.util.Timer;
   //   import t4proto.v1.auth.Auth;
   //   import java.nio.ByteBuffer;
import java.security.Provider.Service;

     @ClientEndpoint
     public class T4APIClient{
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
        /* private Object ws = null; //placeholder for the WebSocket connection
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
        private int lastMessageReceived = 0;

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


        private static Session session; */


        @OnOpen

        public void onOpen(Session session){
         System.out.println("Connected to Websocket");

         try{
            Auth.LoginRequest loginRequest = Auth.LoginRequest.newBuilder()
            .setApiKey(apiKey)
            .setAppName(appName)
            .setAppLicense(appLicense)
            .setFirm(firm)
            .setUsername(userName)
            .setPassword(password)
            .build();

            Service.ClientMessage clientMessage = ClientMessageHelper.wrapLoginRequest(loginRequest);

            session.getAsyncRemote().sendBinary(ByteBuffer.wrap(clientMessage.toByteArray()));
            System.out.println("Login message sent.");
         }
         catch(Exception e){
             e.printStackTrace();
         }
        }

        @OnMessage

        public void onMessage(String message, ByteBuffer bytes){
         System.out.println("Recieved message:" + message);
         try {
        // Attempt to parse as LoginResponse
            Auth.LoginResponse response = Auth.LoginResponse.parseFrom(bytes.array());
            System.out.println("📬 Login response received: " + response.toString());

        // TODO: check if login was successful and move to subscribe to data
        } catch (Exception e) {
            System.err.println("Could not parse incoming message.");
            e.printStackTrace();
         }


        }

        @OnError

        public void onError(Session session, Throwable error){
         System.out.println("Error occurred: ");
         error.printStackTrace();
        }

        @OnClose
        public void onClose(Session session, CloseReason reason){

         System.out.println("Disconnected: " + reason);

        }

        public static void main(String[] args){
         try{
            WebSocketContainer container = ContainerProvider.getWebSocketContainer();
            container.connectToServer(T4APIClient.class, URI.create("wss://wss-sim.t4login.com/v1"));
            Thread.sleep(5000);
         }
         catch(Exception e){
            e.printStackTrace();
         }

      }


      }

     


