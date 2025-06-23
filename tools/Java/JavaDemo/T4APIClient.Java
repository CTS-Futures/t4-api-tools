    //Start with Configuration and the constructor
    /*
     * Constructor has hearbeats that test the connections every 2 miliseconds 
     * What are tyhe message timeouts? 
     * 
     */

     import javax.websocket.*;
     import java.net.URI;
     import java.util.HashMap;
     import java.util.Map;
     import java.util.Timer;

     class T4APIClient{
        //Configuration variables 
        public String wsUrl;
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
        
     
     public Config(){
        //configuration from Config file
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

      // Connection state
        private Object ws = null; //placeholder for the WebSocket connection
        private boolean isConnected = false;
        private Object loginResponse = null;
        private Map<String, Object> accounts = new Map();
        private Object selectedAccount = null;

        // JWT token management
        private Object jwtToken = null;
        private Object jwtExpiration = null;
        private Object pendingTokenRequest = null;

        // Market data
        private Map<String, Object> marketSnapshots = new Map();
        private Object currentSubscription = null;
        private Map<String, Object> marketDetails = new Map();
        this.currentMarketId = null;

        // Order/Position tracking
        private Map<String, Object> positions = new Map();
        private Map<String, Object> orders = new Map();

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
    }

     

     //Event Handlers 
     }

