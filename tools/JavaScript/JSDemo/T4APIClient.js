/**
 * T4 API WebSocket Client
 * JavaScript implementation with proper protobuf message handling
 */

class T4APIClient {
    constructor(config) {
        this.config = {
            wsUrl: T4_CONFIG.wsUrl,
            apiUrl: T4_CONFIG.apiUrl,
<<<<<<< HEAD
<<<<<<< HEAD
            apiKey: T4_CONFIG.apiKey,
=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
            apiKey: T4_CONFIG.apiKey,
>>>>>>> 424fd3c (Cleanup and improvement.)
            firm: T4_CONFIG.firm,
            userName: T4_CONFIG.userName,
            password: T4_CONFIG.password,
            appName: T4_CONFIG.appName,
            appLicense: T4_CONFIG.appLicense,
<<<<<<< HEAD
            priceFormat: T4_CONFIG.priceFormat,
            heartbeatIntervalMs: 20000,
            messageTimeoutMs: 60000,
            mdExchangeId: T4_CONFIG.mdExchangeId,
            mdContractId: T4_CONFIG.mdContractId
=======
            heartbeatIntervalMs: 20000,
<<<<<<< HEAD
            messageTimeoutMs: 60000
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
            messageTimeoutMs: 60000,
            mdExchangeId: T4_CONFIG.mdExchangeId,
            mdContractId: T4_CONFIG.mdContractId
>>>>>>> 424fd3c (Cleanup and improvement.)
        };

        // Connection state
        this.ws = null;
        this.isConnected = false;
        this.loginResponse = null;
        this.accounts = new Map();
        this.selectedAccount = null;

        // JWT token management
        this.jwtToken = null;
        this.jwtExpiration = null;
        this.pendingTokenRequest = null;

        // Market data
        this.marketSnapshots = new Map();
<<<<<<< HEAD
        this.currentSubscription = null;
=======
        this.marketSubscriptions = new Set();
>>>>>>> 462b3ae (Creating a JavaScript example.)
        this.marketDetails = new Map();
        this.currentMarketId = null;

        // Order/Position tracking
        this.positions = new Map();
        this.orders = new Map();

        // Heartbeat management
        this.heartbeatTimer = null;
        this.lastMessageReceived = 0;

        // Event handlers
        this.onConnectionStatusChanged = null;
        this.onAccountUpdate = null;
        this.onMarketHeaderUpdate = null;
        this.onMarketUpdate = null;
        this.onMessageSent = null;
        this.onMessageReceived = null;
        this.onError = null;
        this.onLog = null;

        // Connection retry
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;

        this.isDisposed = false;
    }

    // Public API
    async connect() {
        if (this.isConnected) return;

        try {
<<<<<<< HEAD
<<<<<<< HEAD
            this.log(`Connecting to WebSocket (${this.config.wsUrl}) ...`, 'info');
=======
            this.log('Connecting to WebSocket...', 'info');
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
            this.log(`Connecting to WebSocket (${this.config.wsUrl}) ...`, 'info');
>>>>>>> 424fd3c (Cleanup and improvement.)

            this.ws = new WebSocket(this.config.wsUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = (event) => this.handleClose(event);
            this.ws.onerror = (error) => this.handleError(error);

        } catch (error) {
            this.log(`Connection error: ${error.message}`, 'error');
            this.handleConnectionStatusChanged(false);
        }
    }

    disconnect() {
        this.isDisposed = true;

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }

        this.handleConnectionStatusChanged(false);
        this.log('Disconnected', 'info');
    }

<<<<<<< HEAD
    async getAuthTokenForAPI() {
        return await this.getAuthToken();
    }

=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
    async subscribeAccount(accountId) {
        if (this.selectedAccount === accountId) return;

        // Unsubscribe from previous account
        if (this.selectedAccount) {
            await this.sendMessage({
                accountSubscribe: {
                    subscribe: 0, // ACCOUNT_SUBSCRIBE_TYPE_NONE
                    subscribeAllAccounts: false,
<<<<<<< HEAD
                    accountId: [this.selectedAccount],
                    uplMode: 0
=======
                    accountId: [this.selectedAccount]
>>>>>>> 462b3ae (Creating a JavaScript example.)
                }
            });
        }

        this.selectedAccount = accountId;

        if (accountId) {
            await this.sendMessage({
                accountSubscribe: {
                    subscribe: 2, // ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES
                    subscribeAllAccounts: false,
<<<<<<< HEAD
                    accountId: [accountId],
                    uplMode: 1
=======
                    accountId: [accountId]
>>>>>>> 462b3ae (Creating a JavaScript example.)
                }
            });
            this.log(`Subscribed to account: ${accountId}`, 'info');
        }
    }

    async subscribeMarket(exchangeId, contractId, marketId) {
        const key = `${exchangeId}_${contractId}_${marketId}`;
<<<<<<< HEAD

        // Unsubscribe from existing market subscriptions first
        if (this.currentSubscription) {
            await this.sendMessage({
                marketDepthSubscribe: {
                    exchangeId: this.currentSubscription.exchangeId,
                    contractId: this.currentSubscription.contractId,
                    marketId: this.currentSubscription.marketId,
                    buffer: T4Proto.t4proto.v1.common.DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION,
                    depthLevels: T4Proto.t4proto.v1.common.DepthLevels.DEPTH_LEVELS_UNDEFINED
                }
            });

            this.log(`Unsubscribed from market: ${this.currentSubscription.marketId}`, 'info');

            this.currentSubscription = null;
        }

        this.currentSubscription = {exchangeId, contractId, marketId};
        this.currentMarketId = marketId;
=======
        if (this.marketSubscriptions.has(key)) return;

        this.marketSubscriptions.add(key);
>>>>>>> 462b3ae (Creating a JavaScript example.)

        await this.sendMessage({
            marketDepthSubscribe: {
                exchangeId,
                contractId,
                marketId,
<<<<<<< HEAD
                buffer: T4Proto.t4proto.v1.common.DepthBuffer.DEPTH_BUFFER_SMART_TRADE,
=======
                buffer: T4Proto.t4proto.v1.common.DepthBuffer.DEPTH_BUFFER_SMART,
>>>>>>> 462b3ae (Creating a JavaScript example.)
                depthLevels: T4Proto.t4proto.v1.common.DepthLevels.DEPTH_LEVELS_BEST_ONLY
            }
        });

        this.log(`Subscribed to market: ${marketId}`, 'info');
    }

<<<<<<< HEAD
=======
    async submitOrder(side, volume, price) {
        if (!this.selectedAccount || !this.currentMarketId) {
            throw new Error('No account or market selected');
        }

        const orderSubmit = {
            orderSubmit: {
                accountId: this.selectedAccount,
                marketId: this.currentMarketId,
                orderLink: 0, // ORDER_LINK_NONE
                manualOrderIndicator: true,
                orders: [{
                    buySell: side, // 1 for BUY_SELL_BUY, -1 for BUY_SELL_SELL
                    priceType: 1, // PRICE_TYPE_LIMIT
                    timeType: 0, // TIME_TYPE_NORMAL
                    volume: volume,
                    limitPrice: {
                        value: price.toString()
                    }
                }]
            }
        };

        await this.sendMessage(orderSubmit);
        this.log(`Order submitted: ${side === 1 ? 'Buy' : 'Sell'} ${volume} @ ${price}`, 'info');
    }

>>>>>>> 462b3ae (Creating a JavaScript example.)
    // WebSocket Event Handlers
    handleOpen() {
        this.log('WebSocket connected', 'info');
        this.authenticate();
        this.startHeartbeat();
    }

<<<<<<< HEAD
    async submitOrder(side, volume, price, priceType = 'limit', takeProfitDollars = null, stopLossDollars = null) {
        if (!this.selectedAccount || !this.currentMarketId) {
            throw new Error('No account or market selected');
        }

        const marketDetails = this.getMarketDetails(this.currentMarketId);

        // Convert string price type to enum value
        const priceTypeValue = priceType.toLowerCase() === 'market'
            ? T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET  // 0
            : T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT;  // 1

        // Convert buy/sell string to enum value
        const buySellValue = typeof side === 'string'
            ? (side.toLowerCase() === 'buy'
                ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY    // 1
                : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL)  // -1
            : side;

        // Determine if we need OCO order linking
        const hasBracketOrders = takeProfitDollars !== null || stopLossDollars !== null;
        const orderLinkValue = hasBracketOrders
            ? T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_AUTO_OCO  // 2
            : T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_NONE;     // 0

        // Create orders array with main order first
        const orders = [{
            buySell: buySellValue,
            priceType: priceTypeValue,
            timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_NORMAL, // 0
            volume: volume,
            // Only set limit price if it's a limit order
            limitPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT
                ? { value: price.toString() }
                : null
        }];

        // For bracket orders, we need to use the opposite side
        const protectionSide = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY
            ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL
            : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY;

        // Add take profit order if specified
        if (takeProfitDollars !== null) {

            const takeProfitPoints = takeProfitDollars / marketDetails.pointValue.value;
            const takeProfitPrice = takeProfitPoints * marketDetails.minPriceIncrement.value;

            orders.push({
                buySell: protectionSide,
                priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT, // Always limit for take profit
                timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED, // 2
                volume: 0, // Volume should be 0 for bracket orders
                limitPrice: { value: takeProfitPrice.toString() },
                // Hold activation means order is not active until parent order is filled
                activationType: T4Proto.t4proto.v1.common.ActivationType.ACTIVATION_TYPE_HOLD, // 1
            });
        }

        // Add stop loss order if specified
        if (stopLossDollars !== null) {

            const stopLossPoints = stopLossDollars / marketDetails.pointValue.value;
            const stopLossPrice = stopLossPoints * marketDetails.minPriceIncrement.value;

            orders.push({
                buySell: protectionSide,
                priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET, // Stop market for stop loss
                timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED, // 2
                volume: 0, // Volume should be 0 for bracket orders
                stopPrice: { value: stopLossPrice.toString() },
                // Hold activation means order is not active until parent order is filled
                activationType: T4Proto.t4proto.v1.common.ActivationType.ACTIVATION_TYPE_HOLD, // 1
            });
        }

        // Create the order submit message
        const orderSubmit = {
            orderSubmit: {
                accountId: this.selectedAccount,
                marketId: this.currentMarketId,
                orderLink: orderLinkValue,
                manualOrderIndicator: true,
                orders: orders
            }
        };

        // Send the order
        await this.sendMessage(orderSubmit);

        // Log order details
        const sideText = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell';
        const priceText = priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET ? 'Market' : price;

        this.log(`Order submitted: ${sideText} ${volume} @ ${priceText} (Type: ${priceType})`, 'info');

        if (takeProfitDollars !== null) {
            this.log(`Take profit: $${takeProfitDollars} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (stopLossDollars !== null) {
            this.log(`Stop loss: $${stopLossDollars} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (hasBracketOrders) {
            this.log(`OCO (One Cancels Other) bracket order applied`, 'info');
        }
    }

    async pullOrder(orderId) {
        if (!this.selectedAccount) {
            throw new Error('No account selected');
        }

        const orderPull = {
            orderPull: {
                accountId: this.selectedAccount,
                marketId: this.currentMarketId,
                manualOrderIndicator: true,
                pulls: [{
                    uniqueId: orderId
                }]
            }
        };

        await this.sendMessage(orderPull);
        this.log(`Order cancelled: ${orderId}`, 'info');
    }

    async reviseOrder(orderId, volume, price, priceType = 'limit') {
        if (!this.selectedAccount) {
            throw new Error('No account selected');
        }

        const orderRevise = {
            orderRevise: {
                accountId: this.selectedAccount,
                marketId: this.currentMarketId,
                manualOrderIndicator: true,
                revisions: [{
                    uniqueId: orderId,
                    volume: volume,
                    limitPrice: priceType === 'limit' ? { value: price.toString() } : null
                }]
            }
        };

        await this.sendMessage(orderRevise);
        this.log(`Order revised: ${orderId} - New volume: ${volume}, New price: ${price || 'Market'}`, 'info');
    }

=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
    handleMessage(event) {
        this.lastMessageReceived = Date.now();

        try {
            const message = this.decodeMessage(new Uint8Array(event.data));


            // Messages to exclude from logging
            const excludeFromLogging = ['heartbeat', 'marketDepth', 'accountUpdate', 'accountPosition'];

            // Check if message should be logged
            const messageType = Object.keys(message)[0];
            var shouldLog = !excludeFromLogging.includes(messageType);

<<<<<<< HEAD
            // TEMP: Disable message logging.
            shouldLog = false;

            // Log message received.
=======
            shouldLog = false;
>>>>>>> 462b3ae (Creating a JavaScript example.)
            if (shouldLog) {
                this.log(`RECEIVED: ${JSON.stringify(message, null, 2)}`, 'received');
            }


            if (this.onMessageReceived) {
                this.onMessageReceived(message);
            }

            this.processServerMessage(message);

        } catch (error) {
            this.log(`Error processing message: ${error.message}`, 'error');
        }
    }

    handleClose(event) {
        this.log(`WebSocket closed: ${event.code} ${event.reason}`, 'info');
        this.handleConnectionStatusChanged(false);

        // Only retry on recoverable errors (network issues, not auth failures)
        const shouldRetry = !this.isDisposed &&
            this.reconnectAttempts < this.maxReconnectAttempts &&
            this.isRecoverableError(event.code);

        if (shouldRetry) {
            setTimeout(() => this.attemptReconnect(), this.reconnectDelay);
        } else if (!this.isRecoverableError(event.code)) {
            this.log('Authentication or permanent error - stopping reconnection attempts', 'error');
        }
    }

    handleError(error) {
        this.log(`WebSocket error: ${error}`, 'error');
        if (this.onError) {
            this.onError(error);
        }
    }

    // Authentication
    async authenticate() {
        const loginRequest = {
            loginRequest: this.config.apiKey ?
<<<<<<< HEAD
                {apiKey: this.config.apiKey} :
=======
                { apiKey: this.config.apiKey } :
>>>>>>> 462b3ae (Creating a JavaScript example.)
                {
                    firm: this.config.firm,
                    username: this.config.userName,
                    password: this.config.password,
                    appName: this.config.appName,
<<<<<<< HEAD
                    appLicense: this.config.appLicense,
                    priceFormat: this.config.priceFormat,
=======
                    appLicense: this.config.appLicense
>>>>>>> 462b3ae (Creating a JavaScript example.)
                }
        };

        await this.sendMessage(loginRequest);
    }

    // Message Processing
    processServerMessage(message) {
        if (message.loginResponse) {
            this.handleLoginResponse(message.loginResponse);
        } else if (message.authenticationToken) {
            this.handleAuthenticationToken(message.authenticationToken);
<<<<<<< HEAD
<<<<<<< HEAD
        } else if (message.accountSubscribeResponse) {
            this.handleAccountSubscribeResponse(message.accountSubscribeResponse);
=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
        } else if (message.accountSubscribeResponse) {
            this.handleAccountSubscribeResponse(message.accountSubscribeResponse);
>>>>>>> 424fd3c (Cleanup and improvement.)
        } else if (message.accountDetails) {
            this.handleAccountDetails(message.accountDetails);
        } else if (message.accountPosition) {
            this.handleAccountPosition(message.accountPosition);
<<<<<<< HEAD
        } else if (message.accountProfit) {
            this.handleAccountProfit(message.accountProfit);
        }else if (message.accountPositionProfit) {
            this.handleAccountPositionProfit(message.accountPositionProfit);
=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
        } else if (message.accountUpdate) {
            this.handleAccountUpdate(message.accountUpdate);
        } else if (message.marketDepth) {
            this.handleMarketDepth(message.marketDepth);
<<<<<<< HEAD
        } else if (message.marketDepthTrade) {
            this.handleMarketDepthTrade(message.marketDepthTrade);
=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
        } else if (message.orderUpdate) {
            this.handleOrderUpdate(message.orderUpdate);
        } else if (message.accountSnapshot) {
            this.handleAccountSnapshot(message.accountSnapshot);
        } else if (message.orderUpdateMulti) {
            this.handleOrderUpdateMulti(message.orderUpdateMulti);
        } else if (message.authenticationToken) {
            this.handleAuthenticationToken(message.authenticationToken);
        } else if (message.marketSnapshot) {
            this.handleMarketSnapshot(message.marketSnapshot);
        } else if (message.marketDetails) {
            this.handleMarketDetails(message.marketDetails);
        } else if (message.heartbeat) {
            // Heartbeat received, connection is healthy
        } else {
            const messageType = Object.keys(message)[0] || 'unknown';
            this.log(`Server message not handled: ${messageType}`, 'error');
        }
    }

    handleLoginResponse(response) {
        if (response.result === 0) { // LOGIN_RESULT_SUCCESS
            this.log('Login successful', 'info');
            this.loginResponse = response;
            this.handleConnectionStatusChanged(true);
            this.reconnectAttempts = 0;

            // Store JWT token if provided
            if (response.authenticationToken && response.authenticationToken.token) {
                this.jwtToken = response.authenticationToken.token;
                if (response.authenticationToken.expireTime) {
                    this.jwtExpiration = response.authenticationToken.expireTime.seconds * 1000;
                }
            }

            // Store accounts
            if (response.accounts) {
                response.accounts.forEach(account => {
                    this.accounts.set(account.accountId, account);
                });
            }

            if (this.onAccountUpdate) {
                this.onAccountUpdate({
                    type: 'accounts',
                    accounts: Array.from(this.accounts.values())
                });
            }

        } else {
            this.log(`Login failed: ${response.errorMessage || 'Unknown error'}`, 'error');
            if (this.ws) {
                this.ws.close(4000, 'Authentication failed');
            }
        }
    }

    isRecoverableError(closeCode) {
        // Standard WebSocket close codes that indicate recoverable errors
        const recoverableCodes = [
            1001, // Going away
            1006, // Abnormal closure (network issues)
            1011, // Server error
            1012, // Service restart
            1013, // Try again later
            1014  // Bad gateway
        ];

        // Authentication and permanent errors (don't retry)
        const permanentCodes = [
            1002, // Protocol error
            1003, // Unsupported data
            1007, // Invalid data
            1008, // Policy violation
            1009, // Message too large
            1010, // Extension required
            4000, // Custom: Authentication failed
            4001, // Custom: Invalid API key
            4003  // Custom: Forbidden
        ];

        if (permanentCodes.includes(closeCode)) {
            return false;
        }

        return recoverableCodes.includes(closeCode) || closeCode === 1000; // Normal closure might be recoverable
    }

    handleAuthenticationToken(token) {
        this.jwtToken = token.token;
        if (token.expireTime) {
            this.jwtExpiration = token.expireTime.seconds * 1000;
        }

        // Resolve pending token request
        if (this.tokenResolvers && token.requestId && this.tokenResolvers.has(token.requestId)) {
<<<<<<< HEAD
            const {resolve} = this.tokenResolvers.get(token.requestId);
=======
            const { resolve } = this.tokenResolvers.get(token.requestId);
>>>>>>> 462b3ae (Creating a JavaScript example.)
            this.tokenResolvers.delete(token.requestId);
            resolve(token.token);
        }

        this.log('Authentication token received', 'info');
    }

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 424fd3c (Cleanup and improvement.)
    handleAccountSubscribeResponse(response) {
        if (response.success) {
            this.log('Account subscribe: Success', 'info');
        } else {
            this.log(`Account subscribe failed: ${response.errors.join(', ')}`, 'error');
        }
    }

<<<<<<< HEAD
=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
>>>>>>> 424fd3c (Cleanup and improvement.)
    handleAccountDetails(details) {
        this.log(`Account details received: ${details.accountId}`, 'info');
    }

    handleAccountPosition(position) {
        const key = `${position.accountId}_${position.marketId}`;
        this.positions.set(key, position);

        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'positions',
                positions: Array.from(this.positions.values())
                    .filter(p => p.accountId === this.selectedAccount)
            });
        }
    }

<<<<<<< HEAD
    handleAccountProfit(accountProfit) {
        // Display the account profit, if wanted.
    }

    handleAccountPositionProfit(positionProfit) {
        const key = `${positionProfit.accountId}_${positionProfit.marketId}`;

        // Get existing position or create a new one
        let position = this.positions.get(key);
        if (!position) {
            position = {
                accountId: positionProfit.accountId,
                exchangeId: positionProfit.exchangeId,
                contractId: positionProfit.contractId,
                marketId: positionProfit.marketId,
                buys: 0,
                sells: 0,
                workingBuys: 0,
                workingSells: 0
            };
        }

        // Update with profit data
        position.upl = positionProfit.uplTrade;
        position.rpl = positionProfit.rpl;
        position.totalPnl = (position.upl || 0) + (position.rpl || 0);

        // Store updated position
        this.positions.set(key, position);

        // Get market snapshot for this position if available
        const marketSnapshot = this.marketSnapshots.get(positionProfit.marketId);
        let marketInfo = '';

        if (marketSnapshot) {
            const bestBid = marketSnapshot.bids?.[0] ? `${marketSnapshot.bids[0].volume}@${marketSnapshot.bids[0].price.value}` : '-';
            const bestOffer = marketSnapshot.offers?.[0] ? `${marketSnapshot.offers[0].volume}@${marketSnapshot.offers[0].price.value}` : '-';
            const lastTrade = marketSnapshot.tradeData?.lastTradePrice ?
                `${marketSnapshot.tradeData.lastTradeVolume}@${marketSnapshot.tradeData.lastTradePrice.value}` : '-';

            marketInfo = ` (Bid: ${bestBid}, Offer: ${bestOffer}, Last: ${lastTrade})`;
        }

        // Log P&L values with market ID and market info - fixed property access
        this.log(`Position P&L update - Market: ${positionProfit.marketId}${marketInfo}, 
        UPL: ${positionProfit.upl}, 
        RPL: ${positionProfit.rpl}, 
        Total P&L: ${positionProfit.upl + positionProfit.rpl}`,
            'info');

        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'positions',
                positions: Array.from(this.positions.values())
                    .filter(p => p.accountId === this.selectedAccount)
            });
        }
    }

=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
    handleAccountUpdate(update) {
        // TODO: Display account information (balance, p&l, etc.)
        //this.log(`Account update received: ${update.accountId}`, 'info');
    }

    handleMarketDepth(depth) {
        this.marketSnapshots.set(depth.marketId, depth);

        const marketDetails = this.getMarketDetails(depth.marketId);
        if (marketDetails && marketDetails.contractId && marketDetails.expiryDate) {
            this.updateMarketHeader(marketDetails.contractId, marketDetails.expiryDate);
        }

        if (this.onMarketUpdate) {
            this.onMarketUpdate({
                marketId: depth.marketId,
                contractId: depth.contractId,
                expiryDate: depth.expiryDate,
                bestBid: depth.bids?.[0] ? `${depth.bids[0].volume}@${depth.bids[0].price.value}` : '-',
                bestOffer: depth.offers?.[0] ? `${depth.offers[0].volume}@${depth.offers[0].price.value}` : '-',
                lastTrade: depth.tradeData?.lastTradePrice ?
                    `${depth.tradeData.lastTradeVolume}@${depth.tradeData.lastTradePrice.value}` : '-'
            });
        }
    }

<<<<<<< HEAD

    handleMarketDepthTrade(trade) {
        this.log(`Market Trade: ${trade.marketId} : ${trade.lastTradeVolume} @ ${trade.lastTradePrice.value}, TTV: ${trade.totalTradedVolume}`, 'info');
    }

=======
>>>>>>> 462b3ae (Creating a JavaScript example.)
    updateMarketHeader(contractId, expiryDate) {
        // Extract first 6 digits from expiryDate (YYYYMM format)
        const expiryShort = expiryDate ? expiryDate.toString().substring(0, 6) : '';

        // Format as contract + expiry (e.g., "ESM25")
        let displayText = contractId || '';

        if (expiryShort && expiryShort.length === 6) {
            // Convert YYYYMM to YM format (e.g., 202506 -> 25M)
            const year = expiryShort.substring(2, 4); // Get last 2 digits of year
            const month = expiryShort.substring(4, 6); // Get month

            // Convert month number to letter (01=F, 02=G, 03=H, etc.)
            const monthCodes = {
                '01': 'F', '02': 'G', '03': 'H', '04': 'J', '05': 'K', '06': 'M',
                '07': 'N', '08': 'Q', '09': 'U', '10': 'V', '11': 'X', '12': 'Z'
            };

            const monthCode = monthCodes[month] || month;
            displayText += monthCode + year;
        }

<<<<<<< HEAD
        // Update just the contract link span
        const contractLink = document.querySelector('.market-contract-link');
        if (contractLink) {
            contractLink.textContent = displayText;
=======
        // Update the UI header
        if (this.onMarketHeaderUpdate) {
            this.onMarketHeaderUpdate(displayText);
>>>>>>> 462b3ae (Creating a JavaScript example.)
        }
    }

    handleAccountSnapshot(snapshot) {
        if (snapshot.messages) {
            snapshot.messages.forEach(msg => {
                if (msg.accountDetails) {
                    this.handleAccountDetails(msg.accountDetails);
                } else if (msg.accountUpdate) {
                    this.handleAccountUpdate(msg.accountUpdate)
                } else if (msg.accountPosition) {
                    this.handleAccountPosition(msg.accountPosition);
                } else if (msg.orderUpdateMulti) {
                    this.handleOrderUpdateMulti(msg.orderUpdateMulti)
                } else if (msg.orderUpdate) {
                    this.handleOrderUpdate(msg.orderUpdate);
                } else {
                    const messageType = Object.keys(msg)[0] || 'unknown';
                    this.log(`Account snapshot message not handled: ${messageType}`, 'error');
                }
            });
        }
    }

    handleOrderUpdateMulti(updateMulti) {
        var updatesProcessed = 0;

        if (updateMulti.updates) {
            updateMulti.updates.forEach((update, index) => {
                if (update.orderUpdate) {
                    updatesProcessed++;
                    this.handleOrderUpdate(update.orderUpdate);
                } else if (update.orderUpdateStatus) {
                    updatesProcessed++;
                    this.handleOrderUpdateStatus(update.orderUpdateStatus);
                } else if (update.orderUpdateTrade) {
                    updatesProcessed++;
                    this.handleOrderUpdateTrade(update.orderUpdateTrade);
                } else if (update.orderUpdateTradeLeg) {
                    updatesProcessed++;
                    this.handleOrderUpdateTradeLeg(update.orderUpdateTradeLeg);
                } else if (update.orderUpdateFailed) {
                    updatesProcessed++;
                    this.handleOrderUpdateFailed(update.orderUpdateFailed);
                } else {
                    this.log(`Unknown order update type in multi message: ${Object.keys(update).join(', ')}`, 'error');
                }
            });
        }

        if (updatesProcessed != updateMulti.updates.length) {
            this.log(`Order update multi received: ${updateMulti.uniqueId}, updates: ${updateMulti.updates.length}, processed: ${updatesProcessed}`, 'error');
        } else {
            this.log(`Order update multi received: ${updateMulti.uniqueId}, updates: ${updateMulti.updates.length}, processed: ${updatesProcessed}`, 'info');
        }
    }

    handleOrderUpdate(orderUpdate) {
        this.orders.set(orderUpdate.uniqueId, orderUpdate);

        this.log(`Order update received: ${orderUpdate.uniqueId}, market: ${orderUpdate.marketId}`, 'info');

        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'orders',
                orders: Array.from(this.orders.values())
                    .filter(o => o.accountId === this.selectedAccount)
            });
        }
    }

    handleOrderUpdateStatus(statusUpdate) {
        this.log(`Order status update: ${statusUpdate.uniqueId}, status: ${statusUpdate.status}`, 'info');

        // Get existing order or create a minimal one
        let existingOrder = this.orders.get(statusUpdate.uniqueId);

        if (!existingOrder) {
            // Create minimal order if it doesn't exist
            existingOrder = {
                uniqueId: statusUpdate.uniqueId,
                accountId: statusUpdate.accountId || this.selectedAccount,
                marketId: statusUpdate.marketId
            };
        }

        // Update the existing order with all status fields (following C# UpdateStatusInformation)
        const updatedOrder = {
            ...existingOrder,
            change: statusUpdate.change,
            exchangeTime: statusUpdate.exchangeTime,
            status: statusUpdate.status,
            responsePending: statusUpdate.responsePending,
            statusDetail: statusUpdate.statusDetail,
            time: statusUpdate.time,
            currentVolume: statusUpdate.currentVolume,
            currentLimitPrice: statusUpdate.currentLimitPrice,
            currentStopPrice: statusUpdate.currentStopPrice,
            priceType: statusUpdate.priceType,
            timeType: statusUpdate.timeType,
            exchangeOrderId: statusUpdate.exchangeOrderId,
            workingVolume: statusUpdate.workingVolume,
            executingLoginId: statusUpdate.executingLoginId,
            userId: statusUpdate.userId,
            userName: statusUpdate.userName,
            routingUserId: statusUpdate.routingUserId,
            routingUserName: statusUpdate.routingUserName,
            userAddress: statusUpdate.userAddress,
            sessionId: statusUpdate.sessionId,
            appId: statusUpdate.appId,
            appName: statusUpdate.appName,
            activationType: statusUpdate.activationType,
            activationDetails: statusUpdate.activationDetails,
            trailPrice: statusUpdate.trailPrice,
            currentMaxShow: statusUpdate.currentMaxShow,
            newVolume: statusUpdate.newVolume,
            newLimitPrice: statusUpdate.newLimitPrice,
            newStopPrice: statusUpdate.newStopPrice,
            newMaxShow: statusUpdate.newMaxShow,
            tag: statusUpdate.tag,
            tagClOrdId: statusUpdate.tagClOrdId,
            tagOrigClOrdId: statusUpdate.tagOrigClOrdId,
            smpId: statusUpdate.smpId,
            exchangeLoginId: statusUpdate.exchangeLoginId,
            exchangeLocation: statusUpdate.exchangeLocation,
            atsRegulatoryId: statusUpdate.atsRegulatoryId,
            maxVolume: statusUpdate.maxVolume,
            sequenceOrder: statusUpdate.sequenceOrder,
            authorizedTraderId: statusUpdate.authorizedTraderId,
            appType: statusUpdate.appType,
            // Merge instruction extra if it exists
            instructionExtra: {
                ...(existingOrder.instructionExtra || {}),
                ...(statusUpdate.instructionExtra || {})
            }
        };

        this.orders.set(statusUpdate.uniqueId, updatedOrder);
        this.triggerOrdersUpdate();
    }

    handleOrderUpdateTrade(tradeUpdate) {
        this.log(`Order trade update: ${tradeUpdate.uniqueId}, exchange trade: ${tradeUpdate.exchangeTradeId}`, 'info');
<<<<<<< HEAD

        // Get existing order or create a minimal one
        let existingOrder = this.orders.get(tradeUpdate.uniqueId);

        if (!existingOrder) {
            // Create minimal order if it doesn't exist
            existingOrder = {
                uniqueId: tradeUpdate.uniqueId,
                accountId: tradeUpdate.accountId || this.selectedAccount,
                marketId: tradeUpdate.marketId
            };
        }

        // Update the existing order with all status fields (following C# UpdateStatusInformation)
        const updatedOrder = {
            ...existingOrder,
            change: tradeUpdate.change,
            exchangeTime: tradeUpdate.exchangeTime,
            status: tradeUpdate.status,
            responsePending: tradeUpdate.responsePending,
            statusDetail: tradeUpdate.statusDetail,
            time: tradeUpdate.time,
            currentVolume: tradeUpdate.currentVolume,
            currentLimitPrice: tradeUpdate.currentLimitPrice,
            currentStopPrice: tradeUpdate.currentStopPrice,
            priceType: tradeUpdate.priceType,
            timeType: tradeUpdate.timeType,
            exchangeOrderId: tradeUpdate.exchangeOrderId,
            workingVolume: tradeUpdate.workingVolume,
            executingLoginId: tradeUpdate.executingLoginId,
            userId: tradeUpdate.userId,
            userName: tradeUpdate.userName,
            routingUserId: tradeUpdate.routingUserId,
            routingUserName: tradeUpdate.routingUserName,
            userAddress: tradeUpdate.userAddress,
            sessionId: tradeUpdate.sessionId,
            appId: tradeUpdate.appId,
            appName: tradeUpdate.appName,
            activationType: tradeUpdate.activationType,
            activationDetails: tradeUpdate.activationDetails,
            trailPrice: tradeUpdate.trailPrice,
            currentMaxShow: tradeUpdate.currentMaxShow,
            newVolume: tradeUpdate.newVolume,
            newLimitPrice: tradeUpdate.newLimitPrice,
            newStopPrice: tradeUpdate.newStopPrice,
            newMaxShow: tradeUpdate.newMaxShow,
            tag: tradeUpdate.tag,
            tagClOrdId: tradeUpdate.tagClOrdId,
            tagOrigClOrdId: tradeUpdate.tagOrigClOrdId,
            smpId: tradeUpdate.smpId,
            exchangeLoginId: tradeUpdate.exchangeLoginId,
            exchangeLocation: tradeUpdate.exchangeLocation,
            atsRegulatoryId: tradeUpdate.atsRegulatoryId,
            maxVolume: tradeUpdate.maxVolume,
            sequenceOrder: tradeUpdate.sequenceOrder,
            authorizedTraderId: tradeUpdate.authorizedTraderId,
            appType: tradeUpdate.appType,
            // Merge instruction extra if it exists
            instructionExtra: {
                ...(existingOrder.instructionExtra || {}),
                ...(tradeUpdate.instructionExtra || {})
            }
        };

        this.orders.set(tradeUpdate.uniqueId, updatedOrder);
        this.triggerOrdersUpdate();
=======
        //this.orders.set(tradeUpdate.uniqueId, tradeUpdate);
        //this.triggerOrdersUpdate();
>>>>>>> 462b3ae (Creating a JavaScript example.)
    }

    handleOrderUpdateTradeLeg(tradeLegUpdate) {
        this.log(`Order trade leg update: ${tradeLegUpdate.uniqueId}, leg: ${tradeLegUpdate.legIndex}`, 'info');
        //this.orders.set(tradeLegUpdate.uniqueId, tradeLegUpdate);
        //this.triggerOrdersUpdate();
    }

    handleOrderUpdateFailed(failedUpdate) {
        this.log(`Order failed: ${failedUpdate.uniqueId}, status: ${failedUpdate.status}`, 'info');
        //this.orders.set(failedUpdate.uniqueId, failedUpdate);
        //this.triggerOrdersUpdate();
    }

    triggerOrdersUpdate() {
        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'orders',
                orders: Array.from(this.orders.values())
                    .filter(o => o.accountId === this.selectedAccount)
            });
        }
    }

    handleMarketSnapshot(snapshot) {
        this.log(`Received market snapshot: ${snapshot.marketId}`, 'info');
        if (snapshot.messages) {
            snapshot.messages.forEach(msg => {
                if (msg.marketDepth) {
                    this.handleMarketDepth(msg.marketDepth);
                }
            });
        }

        const marketDetails = this.getMarketDetails(snapshot.marketId);
        if (marketDetails && marketDetails.contractId && marketDetails.expiryDate) {
            this.updateMarketHeader(marketDetails.contractId, marketDetails.expiryDate);
        }
    }

    handleMarketDetails(details) {
        this.log(`Received market details: ${details.marketId}`, 'info');

        // Store or update market details in dictionary using marketId as key
        this.marketDetails.set(details.marketId, details);

        this.log(`Market details stored for ${details.marketId}. Total markets: ${this.marketDetails.size}`, 'info');
    }

    getMarketDetails(marketId) {
        return this.marketDetails.get(marketId);
    }

    hasMarketDetails(marketId) {
        return this.marketDetails.has(marketId);
    }

    // Message Sending
    async sendMessage(messagePayload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        try {
            // Wrap the message in ClientMessage envelope
<<<<<<< HEAD
            const clientMessage = T4Proto.ClientMessageHelper.createClientMessage(messagePayload);
=======
            const clientMessage = this.createClientMessage(messagePayload);
>>>>>>> 462b3ae (Creating a JavaScript example.)
            const encoded = this.encodeMessage(clientMessage);
            this.ws.send(encoded);

            this.log(`SENT: ${JSON.stringify(messagePayload, null, 2)}`, 'sent');

            if (this.onMessageSent) {
                this.onMessageSent(messagePayload);
            }

        } catch (error) {
            this.log(`Error sending message: ${error.message}`, 'error');
            throw error;
        }
    }

<<<<<<< HEAD
=======
    // Create ClientMessage wrapper (equivalent to ClientMessageHelper.CreateClientMessage)
    createClientMessage(messagePayload) {

        // TODO: Get rid of this.

        const clientMessage = { payload: {} };

        // Map message types to ClientMessage fields
        if (messagePayload.heartbeat) {
            clientMessage.heartbeat = messagePayload.heartbeat;
        } else if (messagePayload.loginRequest) {
            clientMessage.loginRequest = messagePayload.loginRequest;
        } else if (messagePayload.marketDepthSubscribe) {
            clientMessage.marketDepthSubscribe = messagePayload.marketDepthSubscribe;
        } else if (messagePayload.accountSubscribe) {
            clientMessage.accountSubscribe = messagePayload.accountSubscribe;
        } else if (messagePayload.orderSubmit) {
            clientMessage.orderSubmit = messagePayload.orderSubmit;
        } else {
            throw new Error(`Unsupported message type: ${Object.keys(messagePayload)[0]}`);
        }

        return clientMessage;
    }

>>>>>>> 462b3ae (Creating a JavaScript example.)
    // Heartbeat Management
    startHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
            this.checkConnectionHealth();
        }, this.config.heartbeatIntervalMs);
    }

    async sendHeartbeat() {
        try {
            await this.sendMessage({
                heartbeat: {
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            this.log(`Failed to send heartbeat: ${error.message}`, 'error');
        }
    }

    checkConnectionHealth() {
        const timeSinceLastMessage = Date.now() - this.lastMessageReceived;

        if (timeSinceLastMessage > this.config.messageTimeoutMs) {
            this.log('Connection unhealthy: no recent messages', 'error');
            this.handleConnectionStatusChanged(false);
        }
    }

    // Connection Management
    async attemptReconnect() {
        if (this.isDisposed) return;

        this.reconnectAttempts++;
        this.log(`Reconnection attempt ${this.reconnectAttempts}`, 'info');

        try {
            await this.connect();
            this.reconnectAttempts = 0;
        } catch (error) {
            this.log(`Reconnection failed: ${error.message}`, 'error');

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
                setTimeout(() => this.attemptReconnect(), delay);
            }
        }
    }

    handleConnectionStatusChanged(connected) {
        this.isConnected = connected;

        if (this.onConnectionStatusChanged) {
            this.onConnectionStatusChanged({
                isConnected: connected,
                reconnectAttempts: this.reconnectAttempts
            });
        }
    }

    // Message Encoding/Decoding (Simplified - needs proper protobuf implementation)
    encodeMessage(message) {
        const clientMessage = T4Proto.ClientMessageHelper.createClientMessage(message);
        return T4Proto.encodeMessage(clientMessage);
    }

    decodeMessage(data) {
        return T4Proto.decodeMessage(data);
    }

    // Market Data API
    async getMarketId(exchangeId, contractId) {
<<<<<<< HEAD
<<<<<<< HEAD
        try {
            const headers = {'Content-Type': 'application/json'};

            if (this.config.apiKey) {
                headers['Authorization'] = `APIKey ${this.config.apiKey}`;
            } else {
                const token = await this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            const response = await fetch(
                `${this.config.apiUrl}/markets/picker/firstmarket?exchangeid=${exchangeId}&contractid=${contractId}`,
                {headers}
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.currentMarketId = data.marketID;
            this.log(`Market ID retrieved: ${data.marketID}`, 'info');
            return data;

        } catch (error) {
            this.log(`Error getting market ID: ${error.message}`, 'error');
            throw error;
        }
=======
        // try {
        //     const headers = { 'Content-Type': 'application/json' };
        //
        //     if (this.config.apiKey) {
        //         headers['Authorization'] = `APIKey ${this.config.apiKey}`;
        //     } else {
        //         const token = await this.getAuthToken();
        //         if (token) {
        //             headers['Authorization'] = `Bearer ${token}`;
        //         }
        //     }
        //
        //     const response = await fetch(
        //         `${this.config.apiUrl}/markets/picker/firstmarket?exchangeid=${exchangeId}&contractid=${contractId}`,
        //         { headers }
        //     );
        //
        //     if (!response.ok) {
        //         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        //     }
        //
        //     const data = await response.json();
        //     this.currentMarketId = data.marketID;
        //     this.log(`Market ID retrieved: ${data.marketID}`, 'info');
        //     return data;
        //
        // } catch (error) {
        //     this.log(`Error getting market ID: ${error.message}`, 'error');
        //     throw error;
        // }

        // TODO: Temp
        this.currentMarketId = "XCME_Eq ES (M25)";
        return this.currentMarketId;
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
        try {
            const headers = { 'Content-Type': 'application/json' };

            if (this.config.apiKey) {
                headers['Authorization'] = `APIKey ${this.config.apiKey}`;
            } else {
                const token = await this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            const response = await fetch(
                `${this.config.apiUrl}/markets/picker/firstmarket?exchangeid=${exchangeId}&contractid=${contractId}`,
                { headers }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.currentMarketId = data.marketID;
            this.log(`Market ID retrieved: ${data.marketID}`, 'info');
            return data;

        } catch (error) {
            this.log(`Error getting market ID: ${error.message}`, 'error');
            throw error;
        }
>>>>>>> 424fd3c (Cleanup and improvement.)
    }

    // Utility Methods
    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            timestamp,
            message,
            type
        };

        console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);

        // Emit to UI console if handler is set
        if (this.onLog) {
            this.onLog(logEntry);
        }
    }

    // Getters
    getAccounts() {
        return Array.from(this.accounts.values());
    }

    getPositions() {
        return Array.from(this.positions.values())
            .filter(p => p.accountId === this.selectedAccount);
    }

    getOrders() {
        return Array.from(this.orders.values())
            .filter(o => o.accountId === this.selectedAccount);
    }

    getMarketSnapshot(marketId) {
        return this.marketSnapshots.get(marketId);
    }

    async getAuthToken() {
        // If using API key, check if we have a valid JWT from login
        if (this.jwtToken && this.jwtExpiration && Date.now() < this.jwtExpiration - 30000) {
            return this.jwtToken;
        }

        // If already requesting token, wait for it
        if (this.pendingTokenRequest) {
            return await this.pendingTokenRequest;
        }

        // Request new token
        this.pendingTokenRequest = this.requestNewToken();
        try {
            const token = await this.pendingTokenRequest;
            return token;
        } finally {
            this.pendingTokenRequest = null;
        }
    }

    // Auth token management.
    async requestNewToken() {
        const requestId = this.generateUUID();

        await this.sendMessage({
            authenticationTokenRequest: {
                requestId: requestId
            }
        });

        // Wait for response (handled in processServerMessage)
        return new Promise((resolve, reject) => {
            this.tokenResolvers = this.tokenResolvers || new Map();
<<<<<<< HEAD
            this.tokenResolvers.set(requestId, {resolve, reject});
=======
            this.tokenResolvers.set(requestId, { resolve, reject });
>>>>>>> 462b3ae (Creating a JavaScript example.)

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.tokenResolvers.has(requestId)) {
                    this.tokenResolvers.delete(requestId);
                    reject(new Error('Token request timeout'));
                }
            }, 30000);
        });
    }

    generateUUID() {

        // *** TODO: Replace this. We don't need a UUID and can be simple for the demo app. ***
<<<<<<< HEAD
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
=======
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
>>>>>>> 462b3ae (Creating a JavaScript example.)
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = T4APIClient;
}