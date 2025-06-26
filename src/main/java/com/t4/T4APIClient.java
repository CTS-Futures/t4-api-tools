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
import t4proto.v1.service.Service; // For ClientMessage

// WebSocket imports
import javax.websocket.*;

// Helper class you’ve written
import com.t4.helpers.ClientMessageHelper;

// Java stdlib
import java.net.URI;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.Timer;

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
            .setApiKey("")
            .setFirm("CTS")
            .setUsername("JGarner")
            .setPassword("Temp123$")
            .setAppName("T4WebSite")
            .setAppLicense("81CE8199-0D41-498C-8A0B-EC5510A395F4")
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

        public void onMessage(ByteBuffer bytes) {
         System.out.println("📬 Received binary message");
         try {
        // Parse the Protobuf message
            Auth.LoginResponse response = Auth.LoginResponse.parseFrom(bytes.array());
            System.out.println(" Login response parsed: " + response);
         } catch (Exception e) {
            System.err.println(" Failed to parse login response:");
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

     


