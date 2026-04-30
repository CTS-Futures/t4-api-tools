/**
 * T4 API WebSocket Client
 * JavaScript implementation with proper protobuf message handling
 */

class T4APIClient {
    constructor(config) {
        this.config = {
            wsUrl: T4_CONFIG.wsUrl,
            apiUrl: T4_CONFIG.apiUrl,
            apiKey: T4_CONFIG.apiKey,
            firm: T4_CONFIG.firm,
            userName: T4_CONFIG.userName,
            password: T4_CONFIG.password,
            appName: T4_CONFIG.appName,
            appLicense: T4_CONFIG.appLicense,
            priceFormat: T4_CONFIG.priceFormat,
            heartbeatIntervalMs: 20000,
            messageTimeoutMs: 60000,
            mdExchangeId: T4_CONFIG.mdExchangeId,
            mdContractId: T4_CONFIG.mdContractId,
            autoSubscribeAccounts: T4_CONFIG.autoSubscribeAccounts === true
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
        this.currentSubscription = null;
        this.marketDetails = new Map();
        this.currentMarketId = null;

        // Order/Position tracking
        this.positions = new Map();
        this.orders = new Map();
        this.accountProfits = new Map();
        this.accountUpdates = new Map();

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
            this.log(`Connecting to WebSocket (${this.config.wsUrl}) ...`, 'info');

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

        this.accountProfits.clear();
        this.accountUpdates.clear();
        this.handleConnectionStatusChanged(false);
        this.log('Disconnected', 'info');
    }

    async getAuthTokenForAPI() {
        return await this.getAuthToken();
    }

    async subscribeAccount(accountId) {
        if (this.selectedAccount === accountId) return;

        if (this.config.autoSubscribeAccounts) {
            // Subscription is managed at login; dropdown only controls which account orders are submitted to.
            this.selectedAccount = accountId;
            this.log(`Account selected: ${accountId}`, 'info');

            // Immediately push updated positions and orders for the new account
            if (this.onAccountUpdate) {
                this.onAccountUpdate({
                    type: 'positions',
                    positions: Array.from(this.positions.values())
                });
                this.onAccountUpdate({
                    type: 'orders',
                    orders: Array.from(this.orders.values())
                        .filter(o => o.accountId === this.selectedAccount)
                });
            }
            return;
        }

        // Per-account subscription (autoSubscribeAccounts is false)

        // Unsubscribe from previous account
        if (this.selectedAccount) {
            await this.sendMessage({
                accountSubscribe: {
                    subscribe: 0, // ACCOUNT_SUBSCRIBE_TYPE_NONE
                    subscribeAllAccounts: false,
                    accountId: [this.selectedAccount],
                    uplMode: 0
                }
            });
        }

        this.selectedAccount = accountId;

        if (accountId) {
            await this.sendMessage({
                accountSubscribe: {
                    subscribe: 2, // ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES
                    subscribeAllAccounts: false,
                    accountId: [accountId],
                    uplMode: 1
                }
            });
            this.log(`Subscribed to account: ${accountId}`, 'info');
        }
    }

    async subscribeMarket(exchangeId, contractId, marketId) {
        const key = `${exchangeId}_${contractId}_${marketId}`;

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

        this.currentSubscription = { exchangeId, contractId, marketId };
        this.currentMarketId = marketId;

        await this.sendMessage({
            marketDepthSubscribe: {
                exchangeId,
                contractId,
                marketId,
                buffer: T4Proto.t4proto.v1.common.DepthBuffer.DEPTH_BUFFER_SMART,
                depthLevels: T4Proto.t4proto.v1.common.DepthLevels.DEPTH_LEVELS_BEST_ONLY
            }
        });

        // await this.sendMessage({
        //     marketByOrderSubscribe: {
        //         exchangeId,
        //         contractId,
        //         marketId,
        //         subscribe: true
        //     }
        // });

        this.log(`Subscribed to market: ${marketId}`, 'info');
    }

    // WebSocket Event Handlers
    handleOpen() {
        this.log('WebSocket connected', 'info');
        this.authenticate();
        this.startHeartbeat();
    }

    async submitOrder(side, volume, price, priceType = 'limit', takeProfitDollars = null, stopLossDollars = null, trailingStop = false, bracketMode = 'dollars') {
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

        // Use AUTO_OCO for dollar-distance mode, AUTO_OCO_P for absolute price mode
        const orderLinkValue = hasBracketOrders
            ? (bracketMode === 'price'
                ? T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_AUTO_OCO_P  // 3
                : T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_AUTO_OCO)   // 2
            : T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_NONE;           // 0

        // Get current time in CST
        const now = new Date();
        const cstOffset = -6 * 60; // CST is UTC-6 (or -5 for CDT, adjust as needed)
        const localOffset = now.getTimezoneOffset();
        const cstTime = new Date(now.getTime() + (localOffset - cstOffset) * 60000);

        // Add 10 seconds
        const submitTime = new Date(cstTime.getTime() + 10000);

        // Convert to protobuf Timestamp format
        const seconds = Math.floor(submitTime.getTime() / 1000);
        const nanos = (submitTime.getTime() % 1000) * 1000000;

        // Create orders array with main order first
        const orders = [{
            buySell: buySellValue,
            priceType: priceTypeValue,
            timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_NORMAL, // 0
            volume: volume,
            // Only set limit price if it's a limit order
            limitPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT
                ? { value: price.toString() }
                : null,
        }];

        // For bracket orders, we need to use the opposite side
        const protectionSide = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY
            ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL
            : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY;

        // Select the correct decimals based on price format:
        // 0 = Decimal format (use decimals), 1 = Real format (use realDecimals)
        const priceDecimals = (this.config.priceFormat === 0)
            ? marketDetails.decimals
            : marketDetails.realDecimals;

        // Add take profit order if specified
        if (takeProfitDollars !== null) {

            let takeProfitLimitPrice;

            if (bracketMode === 'price') {
                // AOCO_P mode: user provides absolute price directly
                takeProfitLimitPrice = takeProfitDollars; // In price mode, the value IS the absolute price
            } else {
                // Dollar mode: calc distance from entry price
                let takeProfitPoints = (Math.abs(takeProfitDollars / volume) / marketDetails.pointValue.value) / (10 ** priceDecimals);

                // Buy main order: TP is above fill (add), Sell main order: TP is below fill (subtract)
                takeProfitPoints = (buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY)
                    ? takeProfitPoints
                    : -takeProfitPoints;

                // AOCO uses distance in price
                takeProfitLimitPrice = takeProfitPoints;
            }

            orders.push({
                buySell: protectionSide,
                priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT,
                timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                volume: 0,
                limitPrice: { value: takeProfitLimitPrice.toString() },
                activationType: T4Proto.t4proto.v1.common.ActivationType.ACTIVATION_TYPE_HOLD
            });
        }

        // Add stop loss order if specified
        if (stopLossDollars !== null) {

            let stopLossStopPrice;

            if (bracketMode === 'price') {
                // AOCO_P mode: user provides absolute price directly
                stopLossStopPrice = stopLossDollars; // In price mode, the value IS the absolute price
            } else {
                // Dollar mode: calc distance from entry price
                let stopLossPoints = (Math.abs(stopLossDollars / volume) / marketDetails.pointValue.value) / (10 ** priceDecimals);

                // Buy main order: SL is below fill (-), Sell main order: SL is above fill (+)
                stopLossPoints = (buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY)
                    ? - stopLossPoints
                    : + stopLossPoints;

                // AOCO uses distance in price
                stopLossStopPrice = stopLossPoints;
            }

            if (trailingStop) {
                const trailDistance = bracketMode === 'price'
                    ? Math.abs(price - stopLossStopPrice).toFixed(priceDecimals)
                    : Math.abs(stopLossStopPrice).toFixed(priceDecimals);

                orders.push({
                    buySell: protectionSide,
                    priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET,
                    timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                    volume: 0,
                    stopPrice: { value: stopLossStopPrice.toString() },
                    trailDistance: { value: trailDistance },
                    activationType: T4Proto.t4proto.v1.common.ActivationType.ACTIVATION_TYPE_HOLD,
                    activationData: "SL-TRAIL"
                });

            } else {
                orders.push({
                    buySell: protectionSide,
                    priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET,
                    timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                    volume: 0,
                    stopPrice: { value: stopLossStopPrice.toString() },
                    activationType: T4Proto.t4proto.v1.common.ActivationType.ACTIVATION_TYPE_HOLD,
                    activationData: "SL"
                });
            }
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

        this.log(`Order submitted: ${sideText} ${volume} @ ${priceText} (Type: ${priceType}, Bracket: ${bracketMode})`, 'info');

        if (takeProfitDollars !== null) {
            const tpLabel = bracketMode === 'price' ? `Price ${takeProfitDollars}` : `$${takeProfitDollars}`;
            this.log(`Take profit: ${tpLabel} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (stopLossDollars !== null) {
            const slLabel = bracketMode === 'price' ? `Price ${stopLossDollars}` : `$${stopLossDollars}`;
            this.log(`Stop loss: ${slLabel}${trailingStop ? ' (Trailing)' : ''} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (hasBracketOrders) {
            const linkType = bracketMode === 'price' ? 'OCO (AOCO_P - Absolute Price)' : 'OCO (AOCO - Distance)';
            this.log(`${linkType} bracket order applied`, 'info');
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

    async flattenPosition(accountId, marketId, netPosition) {
        if (!accountId) {
            throw new Error('No account specified for flatten');
        }

        if (netPosition === 0) {
            this.log('Flatten: net position is already zero', 'warning');
            return;
        }

        // To flatten: sell if long (net > 0), buy if short (net < 0)
        const buySellValue = netPosition > 0
            ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL   // -1
            : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY;   //  1

        const volume = Math.abs(netPosition);

        const orderSubmit = {
            orderSubmit: {
                accountId: accountId,
                marketId: marketId,
                orderLink: T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_NONE,
                manualOrderIndicator: true,
                orders: [{
                    buySell: buySellValue,
                    priceType: T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_FLATTEN, // 16
                    timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_NORMAL,
                    volume: volume
                }]
            }
        };

        await this.sendMessage(orderSubmit);

        const sideText = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell';
        this.log(`Flatten submitted: ${sideText} ${volume} @ Flatten (Market: ${marketId})`, 'info');
    }

    handleMessage(event) {
        this.lastMessageReceived = Date.now();

        try {
            const message = this.decodeMessage(new Uint8Array(event.data));


            // Messages to exclude from logging
            const excludeFromLogging = ['heartbeat', 'marketDepth', 'accountUpdate', 'accountPosition'];

            // Check if message should be logged
            const messageType = Object.keys(message)[0];
            var shouldLog = !excludeFromLogging.includes(messageType);

            // TEMP: Disable message logging.
            shouldLog = false;

            // Log message received.
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
                { apiKey: this.config.apiKey } :
                {
                    firm: this.config.firm,
                    username: this.config.userName,
                    password: this.config.password,
                    appName: this.config.appName,
                    appLicense: this.config.appLicense,
                    priceFormat: this.config.priceFormat,
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
        } else if (message.accountSubscribeResponse) {
            this.handleAccountSubscribeResponse(message.accountSubscribeResponse);
        } else if (message.accountDetails) {
            this.handleAccountDetails(message.accountDetails);
        } else if (message.accountPosition) {
            this.handleAccountPosition(message.accountPosition);
        } else if (message.accountProfit) {
            this.handleAccountProfit(message.accountProfit);
        } else if (message.accountPositionProfit) {
            this.handleAccountPositionProfit(message.accountPositionProfit);
        } else if (message.accountUpdate) {
            this.handleAccountUpdate(message.accountUpdate);
        } else if (message.marketDepth) {
            this.handleMarketDepth(message.marketDepth);
        } else if (message.marketDepthTrade) {
            this.handleMarketDepthTrade(message.marketDepthTrade);
        } else if (message.marketByOrderSnapshot) {
            this.handleMarketByOrderSnapshot(message.marketByOrderSnapshot);
        } else if (message.marketByOrderUpdate) {
            this.handleMarketByOrderUpdate(message.marketByOrderUpdate);
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

            // If autoSubscribeAccounts, subscribe to all accounts immediately upon login
            if (this.config.autoSubscribeAccounts) {

                this.log('Auto-subscribing to all accounts', 'info');

                this.sendMessage({
                    accountSubscribe: {
                        subscribe: 2, // ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES
                        subscribeAllAccounts: true,
                        uplMode: 1
                    }
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
            const { resolve } = this.tokenResolvers.get(token.requestId);
            this.tokenResolvers.delete(token.requestId);
            resolve(token.token);
        }

        this.log('Authentication token received', 'info');
    }

    handleAccountSubscribeResponse(response) {
        if (response.success) {
            this.log('Account subscribe: Success', 'info');
        } else {
            this.log(`Account subscribe failed: ${response.errors.join(', ')}`, 'error');
        }
    }

    handleAccountDetails(details) {
        this.log(`Account details received: ${details.accountId}`, 'info');

        // Store or update the account in the accounts map
        const existing = this.accounts.get(details.accountId);
        this.accounts.set(details.accountId, { ...existing, ...details });

        // Notify UI so accounts table and positions table are refreshed
        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'accounts',
                accounts: Array.from(this.accounts.values())
            });
        }
    }

    handleAccountPosition(position) {
        const key = `${position.accountId}_${position.marketId}`;
        // Preserve any profit fields already received from AccountPositionProfit
        const existing = this.positions.get(key);
        if (existing) {
            position = {
                ...position,
                upl: existing.upl,
                rpl: existing.rpl,
                totalPnl: existing.totalPnl
            };
        }
        this.positions.set(key, position);

        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'positions',
                positions: Array.from(this.positions.values())
            });
        }
    }

    handleAccountProfit(accountProfit) {
        // Store account profit data for display in the accounts table
        const existing = this.accountProfits.get(accountProfit.accountId) || {};
        this.accountProfits.set(accountProfit.accountId, {
            ...existing,
            accountId: accountProfit.accountId,
            balance: accountProfit.balance ?? existing.balance ?? 0,
            rpl: accountProfit.rpl ?? existing.rpl ?? 0,
            upl: accountProfit.uplTrade ?? accountProfit.upl ?? existing.upl ?? 0,
            totalPnl: (accountProfit.rpl ?? existing.rpl ?? 0) + (accountProfit.uplTrade ?? accountProfit.upl ?? existing.upl ?? 0)
        });

        if (this.onAccountUpdate) {
            this.onAccountUpdate({ type: 'accountProfit', accountId: accountProfit.accountId });
        }
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
        position.totalPnl = position.upl + position.rpl;

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

        // Log P&L values with market ID and market info
        this.log(`Position P&L update - Market: ${positionProfit.marketId}${marketInfo}, UPL: ${positionProfit.uplTrade}, RPL: ${positionProfit.rpl}, Total P&L: ${positionProfit.uplTrade + positionProfit.rpl}`,
            'info');

        if (this.onAccountUpdate) {
            this.onAccountUpdate({
                type: 'positions',
                positions: Array.from(this.positions.values())
            });
        }
    }

    handleAccountUpdate(update) {
        if (update.accountId) {
            this.accountUpdates.set(update.accountId, update);
            this.log(`Account update received: ${update.accountId}`, 'info');
        }
        if (this.onAccountUpdate) {
            this.onAccountUpdate({ type: 'accountUpdate', accountId: update.accountId });
        }
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


    handleMarketDepthTrade(trade) {
        const price = trade.lastTradePrice ? trade.lastTradePrice.value : '-';
        const volume = trade.lastTradeVolume ?? '-';
        const ttv = trade.totalTradedVolume ?? '-';
        this.log(`Market Trade: ${trade.marketId} : ${volume} @ ${price}, TTV: ${ttv}`, 'info');
    }

    handleMarketByOrderSnapshot(snashot) {

        this.log(`MBO Snapshot: ${snashot.marketId}`, 'info');
    }

    handleMarketByOrderUpdate(update) {

        this.log(`MBO Update: ${update.marketId}`, 'info');
    }

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

        // Update just the contract link span
        const contractLink = document.querySelector('.market-contract-link');
        if (contractLink) {
            contractLink.textContent = displayText;
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

        if (updatesProcessed !== updateMulti.updates.length) {
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
            const clientMessage = T4Proto.ClientMessageHelper.createClientMessage(messagePayload);
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

        if (!connected) {
            this.selectedAccount = null;
        }

        if (this.onConnectionStatusChanged) {
            this.onConnectionStatusChanged({
                isConnected: connected,
                reconnectAttempts: this.reconnectAttempts
            });
        }
    }

    // Message Encoding/Decoding
    encodeMessage(message) {
        return T4Proto.encodeMessage(message);
    }

    decodeMessage(data) {
        return T4Proto.decodeMessage(data);
    }

    // Market Data API
    async getMarketId(exchangeId, contractId) {
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
        return Array.from(this.positions.values());
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
            this.tokenResolvers.set(requestId, { resolve, reject });

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
        // Simple unique ID for the demo app using timestamp + random suffix
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = T4APIClient;
}