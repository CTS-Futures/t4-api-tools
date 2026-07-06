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
        this.subscribedAccounts = new Set(); // accounts with an active AccountSubscribe

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
        // Session trade blotter: each executed fill (OrderUpdateTrade) is pushed
        // here as the same payload handed to onFill. Live-session only — T4 has
        // no historical-fills backfill on connect. Capped to bound memory.
        this.fills = [];
        this.maxFills = 500;
        this.accountProfits = new Map();
        this.accountUpdates = new Map();
        this.accountDetailsCount = 0;

        // Heartbeat management
        this.heartbeatTimer = null;
        this.lastMessageReceived = 0;

        // Event handlers
        this.onConnectionStatusChanged = null;
        this.onAccountUpdate = null;
        this.onMarketHeaderUpdate = null;
        this.onMarketUpdate = null;
        this.onTrade = null;
        // Fan-out for the trade-history blotter. Receives the full this.fills
        // array on every new fill. Independent of onFill (which the chart's
        // FillMarkers owns) so the two consumers never contend.
        this.onFillsUpdate = null;
        // Fan-out for full market-depth snapshots (bids/offers arrays), used by
        // the chart's DOM liquidity heatmap. Optional; null when unused. Mirrors
        // onTrade — receives the raw decoded `marketDepth` message.
        this.onDepth = null;
        this.onMarketChanged = null;
        this.onMessageSent = null;
        this.onMessageReceived = null;
        this.onError = null;
        this.onLog = null;
        // Fan-out for atomic batch results. Receives { status: 'acknowledged' |
        // 'rejected', batchId, ack?, reject?, batch? } so the batch UI can clear
        // or flag the offending rows. Optional; null when unused.
        this.onBatchUpdate = null;

        // In-flight OrderBatch submissions keyed by client batch_id, so the
        // ack/reject handlers can correlate the server response to the rows that
        // were sent. Populated by submitBatch, cleared on ack/reject.
        this.pendingBatches = new Map();

        // Resolvers awaiting the next AccountSubscribeResponse, so a subscribe issued
        // before a batch can be confirmed before the orders are sent.
        this._subscribeWaiters = [];

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
            this.subscribedAccounts.delete(this.selectedAccount);
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
            this.subscribedAccounts.add(accountId);
            this.log(`Subscribed to account: ${accountId}`, 'info');
        }
    }

    // Subscribe to any accounts not already subscribed, in a single AccountSubscribe.
    // Used before a multi-account batch so the server doesn't reject "not subscribed".
    async ensureAccountsSubscribed(accountIds) {
        if (this.config.autoSubscribeAccounts) return; // all accounts already subscribed
        const missing = [...new Set(accountIds)]
            .filter(Boolean)
            .filter(id => !this.subscribedAccounts.has(id));
        if (missing.length === 0) return;

        const ack = this._awaitNextSubscribeResponse(); // resolve on server ack
        await this.sendMessage({
            accountSubscribe: {
                subscribe: 2,               // ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES
                subscribeAllAccounts: false,
                accountId: missing,
                uplMode: 1                  // UPL_MODE_AVERAGE
            }
        });
        missing.forEach(id => this.subscribedAccounts.add(id));
        this.log(`Subscribed to accounts for batch: ${missing.join(', ')}`, 'info');
        await ack; // ensure the server has registered the subscription before we submit
    }

    _awaitNextSubscribeResponse(timeoutMs = 3000) {
        return new Promise(resolve => {
            this._subscribeWaiters.push(resolve);
            setTimeout(() => resolve(null), timeoutMs); // fall through on message-order guarantee
        });
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

        if (this.onMarketChanged) {
            this.onMarketChanged({ marketId, contractId, exchangeId });
        }

        await this.sendMessage({
            marketDepthSubscribe: {
                exchangeId,
                contractId,
                marketId,
                buffer: T4Proto.t4proto.v1.common.DepthBuffer.DEPTH_BUFFER_SMART,
                // ALL = full book, feeding the chart's DOM liquidity heatmap so
                // deep walls are visible, not just the inside ~10 levels. The
                // Market Data panel still only reads [0] (best bid/offer), so it
                // is unaffected. Heavier bandwidth than NORMAL, but the heatmap's
                // per-frame cost is bounded client-side: DepthSnapshotBuffer's
                // `maxLevelsPerSide` caps how many levels are captured/painted
                // (set at the feature registration in index.html), and
                // `minIntervalMs` throttles snapshot capture. Tune those rather
                // than this subscription so other consumers keep the full book.
                depthLevels: T4Proto.t4proto.v1.common.DepthLevels.DEPTH_LEVELS_ALL
            }
        });

        this.log(`Subscribed to market: ${marketId}`, 'info');
    }

    // WebSocket Event Handlers
    handleOpen() {
        this.log('WebSocket connected', 'info');
        this.authenticate();
        this.startHeartbeat();
    }

    // Build a single OrderSubmit (entry order + optional TP/SL bracket) for the
    // given account/market. Shared by submitOrder (single send) and submitBatch
    // (atomic multi-submission). Returns { submission, info }; info carries the
    // derived values submitOrder needs for its log lines.
    buildOrderSubmit({ accountId, marketId, side, volume, price, priceType = 'limit', takeProfitDollars = null, stopLossDollars = null, trailingStop = false, bracketMode = 'dollars' }) {
        if (!accountId || !marketId) {
            throw new Error('No account or market selected');
        }

        const marketDetails = this.getMarketDetails(marketId);
        if (!marketDetails) {
            throw new Error(`No market details available for ${marketId}`);
        }

        // Convert string price type to enum value.
        // 'market' -> MARKET, 'stop' -> STOP_MARKET (stop-market entry), else LIMIT.
        const ptLower = (typeof priceType === 'string' ? priceType : 'limit').toLowerCase();
        const priceTypeValue = ptLower === 'market'
            ? T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET       // 0
            : ptLower === 'stop'
                ? T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET  // 5
                : T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT;       // 1

        // Convert buy/sell string to enum value
        const buySellValue = typeof side === 'string'
            ? (side.toLowerCase() === 'buy'
                ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY    // 1
                : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL)  // -1
            : side;

        // Determine if we need OCO order linking
        const hasBracketOrders = takeProfitDollars !== null || stopLossDollars !== null;

        // Dollars mode sends raw offsets (AUTO_OCO); Price mode sends absolute child
        // prices (AUTO_OCO_P). Keeps the "$" bracket a true AOCO order in all cases.
        const useAbsoluteBracket = bracketMode === 'price';

        // AUTO_OCO_P carries absolute child prices; AUTO_OCO carries raw offsets.
        const orderLinkValue = hasBracketOrders
            ? (useAbsoluteBracket
                ? T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_AUTO_OCO_P
                : T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_AUTO_OCO)
            : T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_NONE;

        // Create orders array with main order first
        const orders = [{
            buySell: buySellValue,
            priceType: priceTypeValue,
            timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_NORMAL, // 0
            volume: volume,
            // Limit/stop price set only when the order type requires it.
            limitPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT
                ? { value: price.toString() }
                : null,
            stopPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET
                ? { value: price.toString() }
                : null,
        }];

        // For bracket orders, we need to use the opposite side
        const protectionSide = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY
            ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL
            : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY;

        // Select the correct decimals based on price format:
        // 0 = Decimal format (use decimals), 1 = Real format (use realDecimals)
        // Still needed for trailing-stop trailDistance formatting below.
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
                // Offset mode: the entered value IS a price distance off the fill.
                // AUTO_OCO applies it at fill. Buy: TP above (+); Sell: TP below (−).
                const dist = Math.abs(takeProfitDollars);
                takeProfitLimitPrice = (buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY) ? dist : -dist;
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
                // Offset mode: the entered value IS a price distance off the fill.
                // Buy: SL below (−); Sell: SL above (+).
                const dist = Math.abs(stopLossDollars);
                stopLossStopPrice = (buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY) ? -dist : dist;
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

        // Assemble the OrderSubmit. account/market come from the caller so a batch
        // can target multiple accounts/markets in one atomic submission.
        const submission = {
            accountId,
            marketId,
            orderLink: orderLinkValue,
            manualOrderIndicator: true,
            orders: orders
        };

        return {
            submission,
            info: { buySellValue, priceTypeValue, protectionSide, hasBracketOrders }
        };
    }

    async submitOrder(side, volume, price, priceType = 'limit', takeProfitDollars = null, stopLossDollars = null, trailingStop = false, bracketMode = 'dollars') {
        if (!this.selectedAccount || !this.currentMarketId) {
            throw new Error('No account or market selected');
        }

        const { submission, info } = this.buildOrderSubmit({
            accountId: this.selectedAccount,
            marketId: this.currentMarketId,
            side, volume, price, priceType,
            takeProfitDollars, stopLossDollars, trailingStop, bracketMode
        });
        const { buySellValue, priceTypeValue, protectionSide, hasBracketOrders } = info;

        // Send the order
        await this.sendMessage({ orderSubmit: submission });

        // Log order details
        const sideText = buySellValue === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell';
        const priceText = priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET ? 'Market' : price;

        this.log(`Order submitted: ${sideText} ${volume} @ ${priceText} (Type: ${priceType}, Bracket: ${bracketMode})`, 'info');

        if (takeProfitDollars !== null) {
            const tpLabel = bracketMode === 'price' ? `Price ${takeProfitDollars}` : `Dollar Distance ${takeProfitDollars}`;
            this.log(`Take profit: ${tpLabel} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (stopLossDollars !== null) {
            const slLabel = bracketMode === 'price' ? `Price ${stopLossDollars}` : `Dollar Distance ${stopLossDollars}`;
            this.log(`Stop loss: ${slLabel}${trailingStop ? ' (Trailing)' : ''} (${protectionSide === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell'})`, 'info');
        }

        if (hasBracketOrders) {
            const linkType = bracketMode === 'price' ? 'OCO (AOCO_P - Absolute Price)' : 'OCO (AOCO - Distance)';
            this.log(`${linkType} bracket order applied`, 'info');
        }
    }

    // Submit an atomic batch of orders (proto OrderBatch). `rows` is an array of
    // order specs; each row accepts the same fields as submitOrder plus optional
    // per-row accountId/marketId, so one batch can span accounts/markets (i.e. a
    // multi-user batch). The server validates all submissions together: if any
    // fails, none are submitted (OrderBatchReject); otherwise OrderBatchAcknowledge
    // arrives and each order then proceeds via the normal OrderUpdate stream.
    async submitBatch(rows, batchId = null) {
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('submitBatch: no orders provided');
        }

        // Build every submission first; a builder throw (bad market, etc.) aborts
        // the whole batch before anything is sent, mirroring the atomic semantics.
        const submissions = rows.map((row, i) => {
            try {
                // OCO rows carry independent legs and link via ORDER_LINK_OCO; flat /
                // AOCO-bracket rows go through buildOrderSubmit. Either way the result
                // is a plain OrderSubmit, so a batch can mix all three atomically.
                if (row.isOco) {
                    const { submission } = this.buildOcoSubmit(
                        row.legs,
                        row.accountId || this.selectedAccount,
                        row.marketId || this.currentMarketId
                    );
                    return submission;
                }
                const { submission } = this.buildOrderSubmit({
                    accountId: row.accountId || this.selectedAccount,
                    marketId: row.marketId || this.currentMarketId,
                    side: row.side,
                    volume: row.volume,
                    price: row.price,
                    priceType: row.priceType || 'limit',
                    takeProfitDollars: row.takeProfitDollars ?? null,
                    stopLossDollars: row.stopLossDollars ?? null,
                    trailingStop: row.trailingStop ?? false,
                    bracketMode: row.bracketMode || 'dollars'
                });
                return submission;
            } catch (e) {
                throw new Error(`Batch row ${i + 1}: ${e.message}`);
            }
        });

        // Every account referenced by the batch must be subscribed or the server
        // rejects the whole batch ("Account … is not subscribed"). In per-account
        // mode only the selected account is subscribed, so subscribe the rest first.
        const accts = rows.map(r => r.accountId || this.selectedAccount);
        await this.ensureAccountsSubscribed(accts);

        // Always send a client batch_id so the ack/reject (which echoes it) can be
        // correlated back to these rows. Kept simple and unique per session.
        const id = batchId || `b-${Date.now()}-${this.pendingBatches.size}`;
        const cleanupTimer = setTimeout(() => this.pendingBatches.delete(id), 60_000);
        this.pendingBatches.set(id, { rows, submissions, sentAt: Date.now(), cleanupTimer });

        await this.sendMessage({ orderBatch: { batchId: id, submissions } });

        this.log(`Batch submitted: ${submissions.length} order(s), batchId ${id}`, 'info');
        return id;
    }

    // Build a true-OCO OrderSubmit (One-Cancels-Other): two or more independent,
    // simultaneously-working orders linked by ORDER_LINK_OCO. Whichever fills first
    // cancels the rest. Unlike the AUTO_OCO brackets in buildOrderSubmit(), each leg
    // carries its own real volume and is live immediately (no ACTIVATION_TYPE_HOLD /
    // parent entry). account/market come from the caller so a batch can target
    // multiple accounts/markets. Returns { submission } (same shape as buildOrderSubmit).
    //
    // legs: array of { side, priceType, price, volume }
    //   side:      'buy'|'sell' or 1/-1
    //   priceType: 'limit'|'market'|'stop'
    //   price:     absolute price (ignored for market legs)
    //   volume:    per-leg quantity
    buildOcoSubmit(legs, accountId, marketId) {
        if (!accountId || !marketId) {
            throw new Error('No account or market selected');
        }
        if (!Array.isArray(legs) || legs.length < 2) {
            throw new Error('OCO requires at least two legs');
        }

        const orders = legs.map((leg, i) => {
            // Convert string price type to enum value (same mapping as buildOrderSubmit).
            const ptLower = (typeof leg.priceType === 'string' ? leg.priceType : 'limit').toLowerCase();
            const priceTypeValue = ptLower === 'market'
                ? T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET       // 0
                : ptLower === 'stop'
                    ? T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET  // 5
                    : T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT;       // 1

            // Validate before building: an unvalidated leg would otherwise send a
            // "NaN" price/volume string to the server. Limit/stop legs need a price;
            // market legs don't. Every leg needs a positive integer volume.
            const volume = Number(leg.volume);
            if (!Number.isFinite(volume) || volume < 1) {
                throw new Error(`Leg ${i + 1}: volume must be a positive integer`);
            }
            const needsPrice = priceTypeValue !== T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_MARKET;
            if (needsPrice && !Number.isFinite(Number(leg.price))) {
                throw new Error(`Leg ${i + 1}: ${ptLower} leg needs a price`);
            }

            // Convert buy/sell string or number to enum value (same as buildOrderSubmit).
            const buySellValue = typeof leg.side === 'string'
                ? (leg.side.toLowerCase() === 'buy'
                    ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY    // 1
                    : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL)  // -1
                : (leg.side === 1
                    ? T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY
                    : T4Proto.t4proto.v1.common.BuySell.BUY_SELL_SELL);

            return {
                buySell: buySellValue,
                priceType: priceTypeValue,
                timeType: T4Proto.t4proto.v1.common.TimeType.TIME_TYPE_NORMAL, // 0
                volume: volume,
                // Limit/stop price set only when the order type requires it.
                limitPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_LIMIT
                    ? { value: Number(leg.price).toString() }
                    : null,
                stopPrice: priceTypeValue === T4Proto.t4proto.v1.common.PriceType.PRICE_TYPE_STOP_MARKET
                    ? { value: Number(leg.price).toString() }
                    : null,
                // No activationType: both legs are live working orders immediately.
            };
        });

        const submission = {
            accountId,
            marketId,
            orderLink: T4Proto.t4proto.v1.common.OrderLink.ORDER_LINK_OCO, // 1
            manualOrderIndicator: true,
            orders: orders
        };

        return { submission };
    }

    // Build + send a single true-OCO submission for the selected account/market.
    // Shared build logic lives in buildOcoSubmit (also used by submitBatch).
    async submitOcoOrder(legs) {
        if (!this.selectedAccount || !this.currentMarketId) {
            throw new Error('No account or market selected');
        }

        const { submission } = this.buildOcoSubmit(legs, this.selectedAccount, this.currentMarketId);
        await this.sendMessage({ orderSubmit: submission });

        this.log(`OCO order submitted: ${legs.length} legs (one-cancels-other)`, 'info');
        legs.forEach((leg, i) => {
            const sideText = submission.orders[i].buySell === T4Proto.t4proto.v1.common.BuySell.BUY_SELL_BUY ? 'Buy' : 'Sell';
            const ptLower = (typeof leg.priceType === 'string' ? leg.priceType : 'limit').toLowerCase();
            const priceText = ptLower === 'market' ? 'Market' : leg.price;
            this.log(`  Leg ${i + 1}: ${sideText} ${leg.volume} @ ${priceText} (${ptLower})`, 'info');
        });
    }

    async pullOrder(orderId) {
        if (!this.selectedAccount) {
            throw new Error('No account selected');
        }

        // Use the order's own market (falling back to the current market) so a cancel
        // still works after a mid-session market switch — orders carry marketId (see
        // handleOrderUpdate). Sending a null marketId makes the server silently reject.
        const order = this.orders.get(orderId);
        const marketId = order?.marketId || this.currentMarketId;
        if (!marketId) {
            throw new Error('No market selected');
        }

        const orderPull = {
            orderPull: {
                accountId: this.selectedAccount,
                marketId: marketId,
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

    // Source-of-truth guard for every caller (dialog + chart-drag revise): a non-finite
    // volume/price would otherwise be sent as "NaN" (Number(NaN).toFixed() === "NaN").
    if (!Number.isFinite(Number(volume)) || Number(volume) < 1) {
        throw new Error('Revise: volume must be a positive integer');
    }
    if (!Number.isFinite(Number(price))) {
        throw new Error('Revise: price must be a number');
    }

    const isStop = priceType === 'stop';

    // Use the order's market for decimals (fall back to current market)
    const order = this.orders.get(orderId);
    const marketId = order?.marketId || this.currentMarketId;
    const marketDetails = this.getMarketDetails(marketId);
    const priceDecimals = marketDetails
        ? ((this.config.priceFormat === 0) ? marketDetails.decimals : marketDetails.realDecimals)
        : 2;

    // Format with the correct decimal precision
    const priceStr = Number(price).toFixed(priceDecimals);

    const revision = {
        uniqueId: orderId,
        volume: volume
    };

    if (isStop) {
        revision.stopPrice = { value: priceStr };
    } else {
        revision.limitPrice = { value: priceStr };
    }

    const orderRevise = {
        orderRevise: {
            accountId: this.selectedAccount,
            marketId: marketId,
            manualOrderIndicator: true,
            revisions: [revision]
        }
    };

    await this.sendMessage(orderRevise);
    this.log(`Order revised: ${orderId} - Volume: ${volume}, ${isStop ? 'stop' : 'limit'} price: ${priceStr}`, 'info');
}

    async flattenPosition(accountId, marketId, netPosition) {
        if (!accountId) {
            throw new Error('No account specified for flatten');
        }
        if (!marketId) {
            throw new Error('No market specified for flatten');
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

        // Stop heartbeat timer on close
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

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
        } else if (message.orderBatchAcknowledge) {
            this.handleOrderBatchAcknowledge(message.orderBatchAcknowledge);
        } else if (message.orderBatchReject) {
            this.handleOrderBatchReject(message.orderBatchReject);
        } else if (message.authenticationToken) {
            this.handleAuthenticationToken(message.authenticationToken);
        } else if (message.marketSnapshot) {
            this.handleMarketSnapshot(message.marketSnapshot);
        } else if (message.marketDetails) {
            this.handleMarketDetails(message.marketDetails);
        } else if (message.heartbeat) {
            // Heartbeat received, connection is healthy
        } else if (message.marketHighLow) {
            // Periodic high/low ticks; we don't surface them in the demo UI yet.
            // Stored for future use (e.g. HoD/LoD lines on the chart).
            this.handleMarketHighLow(message.marketHighLow);
        } else if (message.marketPriceLimits) {
            // Daily price limits broadcast; not displayed yet.
        } else if (message.marketSettlement) {
            // Daily settlement; not displayed yet.
        } else {
            const messageType = Object.keys(message)[0] || 'unknown';
            this.log(`Server message not handled: ${messageType}`, 'error');
        }
    }

    handleMarketHighLow(highLow) {
        if (!highLow || !highLow.marketId) return;
        if (!this.marketHighLows) this.marketHighLows = new Map();
        this.marketHighLows.set(highLow.marketId, highLow);
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
        } else if (
            response.result === 6 || // Commonly used for "logged in elsewhere"
            (response.errorMessage && response.errorMessage.toLowerCase().includes('logged in elsewhere'))
        ) {
            this.log('Login failed: Logged in elsewhere. Your session has been terminated by another login.', 'error');
            if (this.ws) {
                this.ws.close(4000, 'Logged in elsewhere');
            }
            // Optionally notify UI
            if (this.onConnectionStatusChanged) {
                this.onConnectionStatusChanged({
                    isConnected: false,
                    reconnectAttempts: this.reconnectAttempts,
                    reason: 'logged_in_elsewhere'
                });
            }
        } else {
            this.log(`Login failed (result=${response.result}): ${response.errorMessage || 'Unknown error'}`, 'error');
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
            this.log(`Account subscribe failed: ${(response.errors || []).join(', ')}`, 'error');
        }
        const waiters = this._subscribeWaiters;
        this._subscribeWaiters = [];
        waiters.forEach(w => w(response));
    }

    handleAccountDetails(details) {
        this.accountDetailsCount++;
        const accountName = details.accountName || details.name || details.accountId;
        this.log(`Received account details (${this.accountDetailsCount} total) ${accountName}`, 'info');

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
        const existing = this.accountProfits.get(accountProfit.accountId) || {};
        this.accountProfits.set(accountProfit.accountId, {
            ...existing,
            accountId: accountProfit.accountId,
            rpl: accountProfit.rpl ?? existing.rpl ?? 0,
            upl: accountProfit.uplTrade ?? accountProfit.upl ?? existing.upl ?? 0,
            availableCash: accountProfit.availableCash ?? existing.availableCash ?? 0,
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

            // AccountUpdate carries balance and rpl — merge into accountProfits
            // so renderAccountsTable reads consistent data from one place
            if (update.balance != null || update.rpl != null) {
                const existing = this.accountProfits.get(update.accountId) || {};
                this.accountProfits.set(update.accountId, {
                    ...existing,
                    accountId: update.accountId,
                    balance: update.balance ?? existing.balance ?? 0,
                    rpl: update.rpl ?? existing.rpl ?? 0,
                });
            }

            this.log(`Account update received: ${update.accountId}`, 'info');
        }
        if (this.onAccountUpdate) {
            this.onAccountUpdate({ type: 'accountUpdate', accountId: update.accountId });
        }
    }

    handleMarketDepth(depth) {
        this.marketSnapshots.set(depth.marketId, depth);

        // Fan the full book out to the chart heatmap (if wired). Defensive: a
        // throwing consumer must not break depth processing for the panel.
        if (this.onDepth) {
            try { this.onDepth(depth); } catch (err) { this.log(`onDepth handler threw: ${err?.stack || err?.message || err}`, 'error'); }
        }

        const marketDetails = this.getMarketDetails(depth.marketId);
        if (marketDetails && marketDetails.contractId && marketDetails.expiryDate) {
            this.updateMarketHeader(marketDetails.contractId, marketDetails.expiryDate);
        }

        // Most exchanges deliver trade prints inside marketDepth.tradeData rather
        // than as standalone marketDepthTrade messages. Forward those too.
        if (depth.tradeData && depth.tradeData.lastTradePrice && depth.tradeData.lastTradeVolume) {
            this._emitTradeTick({
                marketId: depth.marketId,
                lastTradePrice: depth.tradeData.lastTradePrice,
                lastTradeVolume: depth.tradeData.lastTradeVolume,
                totalTradedVolume: depth.tradeData.totalTradedVolume
            });
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
        // Per-trade log disabled: on busy markets (ES/NQ) hundreds of prints/sec
        // appended to the console panel forced enough synchronous layout reflows
        // to starve the main thread, freezing the chart and bid/offer panel.
        // The chart's candle stream and the market-data panel already show this.
        this._emitTradeTick(trade);
    }

    // Scales price and dispatches onTrade. Dedupes by totalTradedVolume so the
    // same print arriving via marketDepth.tradeData and marketDepthTrade is
    // only emitted once per market.
    _emitTradeTick(trade) {
        if (!this.onTrade || !trade.lastTradePrice || !trade.lastTradeVolume) return;

        const rawValue = Number(trade.lastTradePrice.value);
        const tradeVolume = Number(trade.lastTradeVolume);
        if (!Number.isFinite(rawValue) || !Number.isFinite(tradeVolume)) return;

        const ttv = trade.totalTradedVolume != null ? Number(trade.totalTradedVolume) : null;
        if (!this._lastTtvByMarket) this._lastTtvByMarket = new Map();
        if (ttv != null) {
            const prev = this._lastTtvByMarket.get(trade.marketId);
            if (prev != null && ttv <= prev) return; // duplicate / stale
            this._lastTtvByMarket.set(trade.marketId, ttv);
        } else {
            // Fallback dedup when TTV is absent: every marketDepth message
            // carries a snapshot of the last trade, not necessarily a new one.
            // Without this, every bid/ask change would re-emit the same print
            // and re-paint the chart's last candle on every depth tick.
            if (!this._lastTradeKeyByMarket) this._lastTradeKeyByMarket = new Map();
            const key = `${rawValue}|${tradeVolume}`;
            if (this._lastTradeKeyByMarket.get(trade.marketId) === key) return;
            this._lastTradeKeyByMarket.set(trade.marketId, key);
        }

        const details = this.getMarketDetails(trade.marketId);
        let priceDecimals = 2;
        if (details) {
            priceDecimals = (this.config.priceFormat === 0)
                ? (details.decimals ?? 2)
                : (details.realDecimals ?? 2);
        }
        // price.value is already the display price (the same value shown in the
        // Market Data panel's Last Trade). marketDetails only tells us how many
        // decimal places to format with — do NOT rescale the value here.
        const displayPrice = rawValue;

        this.onTrade({
            marketId: trade.marketId,
            time: Date.now(),
            price: displayPrice,
            rawPrice: rawValue,
            volume: tradeVolume,
            totalTradedVolume: ttv,
            priceDecimals,
            scaled: !!details
        });
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
                    this.handleAccountUpdate(msg.accountUpdate);
                } else if (msg.accountPosition) {
                    this.handleAccountPosition(msg.accountPosition);
                } else if (msg.accountProfit) {
                    this.handleAccountProfit(msg.accountProfit);
                } else if (msg.accountPositionProfit) {
                    this.handleAccountPositionProfit(msg.accountPositionProfit);
                } else if (msg.orderUpdateMulti) {
                    this.handleOrderUpdateMulti(msg.orderUpdateMulti);
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

    // Batch accepted: every submission passed validation. The individual orders
    // still arrive afterward as normal OrderUpdate messages, so there's no order
    // state to set up here — this is purely confirmation/correlation.
    handleOrderBatchAcknowledge(ack) {
        const pending = this.pendingBatches.get(ack.batchId);
        const total = (ack.accepted || []).reduce((n, a) => n + (a.uniqueId?.length || 0), 0);
        this.log(`Batch acknowledged: ${ack.batchId} — ${total} order(s) accepted`, 'info');

        try {
            if (this.onBatchUpdate) {
                this.onBatchUpdate({ status: 'acknowledged', batchId: ack.batchId, ack, batch: pending });
            }
        } finally {
            if (pending?.cleanupTimer) clearTimeout(pending.cleanupTimer);
            this.pendingBatches.delete(ack.batchId);
        }
    }

    // Batch rejected: at least one order failed validation, so NONE were submitted.
    // No order state was created, so there's nothing to roll back — we just surface
    // the per-order errors so the batch UI can flag the offending rows.
    handleOrderBatchReject(reject) {
        const pending = this.pendingBatches.get(reject.batchId);
        this.log(`Batch rejected: ${reject.batchId} — ${reject.reason || 'validation failed'}`, 'error');
        (reject.errors || []).forEach(err => {
            const where = err.orderIndex === -1
                ? `submission ${err.submissionIndex}`
                : `submission ${err.submissionIndex}, order ${err.orderIndex}`;
            this.log(`  ${where}: ${err.reason}`, 'error');
        });

        try {
            if (this.onBatchUpdate) {
                this.onBatchUpdate({ status: 'rejected', batchId: reject.batchId, reject, batch: pending });
            }
        } finally {
            if (pending?.cleanupTimer) clearTimeout(pending.cleanupTimer);
            this.pendingBatches.delete(reject.batchId);
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

        // Fan out to a fill listener (chart markers, blotter, etc.). Defensive:
        // proto field names for the matched price/volume vary; pass the raw
        // tradeUpdate so the consumer can probe, and provide derived hints.
        const buySell = updatedOrder.buySell ?? existingOrder.buySell;
        const fill = {
            uniqueId: tradeUpdate.uniqueId,
            marketId: tradeUpdate.marketId,
            accountId: updatedOrder.accountId,
            side: buySell === 1 ? 1 : (buySell === -1 ? -1 : null),
            time: tradeUpdate.time ?? tradeUpdate.exchangeTime ?? null,
            raw: tradeUpdate
        };

        if (this.onFill) {
            try {
                this.onFill(fill);
            } catch (err) {
                this.log(`onFill handler threw: ${err?.message || err}`, 'error');
            }
        }

        // Record on the session blotter and notify the trade-history panel.
        this.fills.push(fill);
        if (this.fills.length > this.maxFills) {
            this.fills.splice(0, this.fills.length - this.maxFills);
        }
        if (this.onFillsUpdate) {
            try {
                this.onFillsUpdate(this.fills.slice());
            } catch (err) {
                this.log(`onFillsUpdate handler threw: ${err?.message || err}`, 'error');
            }
        }
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

    // Historical bar chart data. Returns the full parsed Chart API JSON
    // (caller usually wants .bars). Times in the response are CST wall-clock.
    // Prices are raw integer strings; scale with marketDetails.decimals.
    async getBarChart(exchangeId, contractId, marketId, {
        barInterval,      // 'Second' | 'Minute' | 'Hour' | 'Day' | 'Week' | 'Tick' | 'TickRange' | 'Volume'
        barPeriod,        // positive int
        tradeDateStart,   // ISO 'YYYY-MM-DDTHH:mm:ss'
        tradeDateEnd      // ISO 'YYYY-MM-DDTHH:mm:ss'
    }) {
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

            const params = new URLSearchParams({
                exchangeId,
                contractId,
                chartType: 'Bar',
                barInterval,
                barPeriod: String(barPeriod),
                tradeDateStart,
                tradeDateEnd
            });
            if (marketId) params.set('marketID', marketId);

            const response = await fetch(
                `${this.config.apiUrl}/chart/barchart?${params.toString()}`,
                { headers }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const barCount = Array.isArray(data?.bars) ? data.bars.length : 0;
            this.log(`Bar chart retrieved: ${barCount} bars for ${marketId || `${exchangeId}/${contractId}`}`, 'info');
            return data;

        } catch (error) {
            this.log(`Error getting bar chart: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Fetch the aggregated barchart in T4BinAggr binary form and decode it with
     * the ported chart-data decoder (window.T4ChartDecoder). Prices are scaled
     * correctly by the decoder's MarketDefinition/Price logic, so no client-side
     * calibration is needed.
     *
     * @returns {Promise<Array<{
     *   timeIso: string, open: number, high: number, low: number,
     *   close: number, volume: number, volumeAtBid: number,
     *   volumeAtOffer: number, trades: number }>>}
     */
    async getBarChartBinary(exchangeId, contractId, marketId, {
        barInterval,
        barPeriod,
        tradeDateStart,
        tradeDateEnd,
        maxAttempts: maxAttemptsOpt,
        warmOnly = false
    }) {
        const decoder = (typeof window !== 'undefined') && window.T4ChartDecoder;
        if (!decoder) {
            throw new Error('T4ChartDecoder is not loaded');
        }

        try {
            // Per T4 Chart API docs, both `application/octet-stream` and
            // `application/t4` request the binary T4Bin format. Use
            // octet-stream (observed to return real T4Bin bars when the chart
            // server's cache is warm).
            const headers = { 'Accept': 'application/octet-stream' };

            if (this.config.apiKey) {
                headers['Authorization'] = `APIKey ${this.config.apiKey}`;
            } else {
                const token = await this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            const params = new URLSearchParams({
                exchangeId,
                contractId,
                chartType: 'Bar',
                barInterval,
                barPeriod: String(barPeriod),
                tradeDateStart,
                tradeDateEnd
            });
            if (marketId) params.set('marketID', marketId);

            const url = `${this.config.apiUrl}/chart/barchart?${params.toString()}`;
            const marketLabel = marketId || `${exchangeId}/${contractId}`;

            // The chart server computes/caches aggregated bars ASYNCHRONOUSLY.
            // On a cold cache it returns a small "request handle" envelope
            // (header `d0 01 01 00`, then an int32 length + 36-char request
            // GUID + market name) instead of the T4Bin stream. The act of
            // requesting warms the cache, so retry a few times before giving up
            // (which lets the caller fall back to the JSON path). Callers loading
            // older history pass a smaller budget to fail-fast (the JSON path is
            // already proven for those windows).
            const MAX_ATTEMPTS = Math.max(1, Number(maxAttemptsOpt) || 3);
            // Flat short backoff: keep the cold-start retry window tight so the
            // first paint (or JSON fallback) happens fast. The clamp below means
            // a single value applies to every retry.
            const BACKOFFS_MS = [200];
            let payload = null;
            let lastContentType = '';
            let lastBuf = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const response = await fetch(url, { headers });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const buf = new Uint8Array(await response.arrayBuffer());
                lastBuf = buf;
                const contentType = response.headers.get('content-type') || '';
                lastContentType = contentType;
                const ct = contentType.toLowerCase();
                const looksBinary =
                    ct.includes('octet-stream') ||
                    ct.includes('application/t4') ||
                    ct.includes('application/x-t4');

                // Non-binary content-type = a genuine error/text body
                // (e.g. JSON ProblemDetails). Surface it and stop retrying.
                if (!looksBinary) {
                    let bodyText = '';
                    try { bodyText = new TextDecoder('utf-8', { fatal: false }).decode(buf); } catch (_) { /* ignore */ }
                    const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 300);
                    this.log(
                        `Binary barchart: unexpected response (content-type="${contentType || 'none'}", ` +
                        `${buf.length} bytes): ${snippet || '<non-text body>'}`,
                        'warning'
                    );
                    throw new Error(
                        `Binary barchart unavailable (content-type="${contentType || 'none'}", ${buf.length} bytes)` +
                        (snippet ? `: ${snippet}` : '')
                    );
                }

                // Detect the cold-cache request-handle envelope so we can retry.
                const isHandleEnvelope =
                    buf.length >= 4 &&
                    buf[0] === 0xd0 && buf[1] === 0x01 && buf[2] === 0x01 && buf[3] === 0x00;

                try {
                    payload = decoder.extractT4BinPayload(buf);
                    break; // got a real T4Bin stream
                } catch (extractErr) {
                    if (isHandleEnvelope && attempt < MAX_ATTEMPTS) {
                        // Cold cache: the request itself warms it. Back off and
                        // retry. (We previously polled /chart/cache-status here,
                        // but it returns 403 on this deployment — a wasted round
                        // trip per attempt — so it's been removed.)
                        const wait = BACKOFFS_MS[Math.min(attempt - 1, BACKOFFS_MS.length - 1)];
                        await new Promise((r) => setTimeout(r, wait));
                        continue;
                    }

                    // Warm-up-only callers just wanted to kick the cache; a
                    // cold handle envelope is the expected response, so return
                    // quietly without throwing.
                    if (warmOnly && isHandleEnvelope) return [];

                    throw extractErr;
                }
            }

            if (!payload) {
                throw new Error(
                    `Binary barchart not ready after ${MAX_ATTEMPTS} attempts ` +
                    `(content-type="${lastContentType || 'none'}", last buf=${lastBuf?.length ?? 0} bytes)`
                );
            }

            const pad = (n, w = 2) => String(n).padStart(w, '0');
            const bars = [];

            // The T4BinAggr market definition encodes `numerator`/`denominator`
            // as 0/1 for many markets (e.g. ES), so the decoder's derived
            // minPriceIncrement (= numerator/denominator) is 0. Because bars are
            // delta-encoded (price = increments × minPriceIncrement), that makes
            // every decoded OHLC value 0. Inject the authoritative tick size from
            // the live market details (which carry the real minPriceIncrement)
            // into the decoded MarketDefinition before any bars are reconstructed.
            const Price = decoder.Price;
            const DecimalCtor = decoder.Decimal;
            // The caller may have started this fetch in parallel with the
            // market-details subscription to remove the serial wait. Ensure the
            // authoritative tick size is present before decoding delta bars
            // (otherwise OHLC collapse to 0); poll briefly if it isn't yet.
            if (marketId && typeof this.getMarketDetails === 'function' && !this.getMarketDetails(marketId)) {
                const deadline = Date.now() + 3000;
                while (!this.getMarketDetails(marketId) && Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 100));
                }
            }
            const liveDetails = this.getMarketDetails?.(marketId);
            const liveIncrementStr = liveDetails?.minPriceIncrement?.value;
            const log = (msg, level) => this.log(msg, level);

            decoder.ChartDataStreamReaderAggr.read(payload, {
                onMarketDefinition(market) {
                    if (!market || typeof market.getMinPriceIncrement !== 'function') return;
                    const cur = market.getMinPriceIncrement();
                    const decodedIsZero =
                        !cur || !cur.value || (typeof cur.value.isZero === 'function' && cur.value.isZero());
                    if (!decodedIsZero) return;
                    if (!liveIncrementStr || !Price || !DecimalCtor) {
                        log(
                            `Binary barchart: market definition has zero minPriceIncrement and no ` +
                            `live tick size available for ${marketId || `${exchangeId}/${contractId}`}; ` +
                            `bars may decode as 0`,
                            'warning'
                        );
                        return;
                    }
                    // Patch the decoder's market object in place. The aggregate
                    // reader holds the same reference and uses it for every
                    // subsequent delta-bar price reconstruction.
                    market._minPriceIncrement = new Price(new DecimalCtor(liveIncrementStr));
                    if (market.VPT_str && market.VPT_str.length > 0) {
                        // VPT markets (e.g. some interest-rate products) derive
                        // their tick ladder from the increment; rebuilding that
                        // ladder isn't supported here, so warn instead of
                        // silently producing wrong prices.
                        log(
                            `Binary barchart: VPT market ${marketId || `${exchangeId}/${contractId}`} ` +
                            `had zero minPriceIncrement; prices may be approximate`,
                            'warning'
                        );
                    }
                },
                onBar(bar) {
                    const t = bar.Time;
                    const timeIso =
                        `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T` +
                        `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
                    bars.push({
                        timeIso,
                        open: bar.OpenPrice.value.toNumber(),
                        high: bar.HighPrice.value.toNumber(),
                        low: bar.LowPrice.value.toNumber(),
                        close: bar.ClosePrice.value.toNumber(),
                        volume: Number(bar.Volume) || 0,
                        volumeAtBid: Number(bar.VolumeAtBid) || 0,
                        volumeAtOffer: Number(bar.VolumeAtOffer) || 0,
                        trades: Number(bar.Trades) || 0
                    });
                }
            });

            this.log(`Bar chart (binary) decoded: ${bars.length} bars for ${marketId || `${exchangeId}/${contractId}`}`, 'info');
            return bars;

        } catch (error) {
            // Caller (ChartService) handles this by falling back to JSON, so
            // log as warning rather than error to avoid noisy red console lines
            // on what is an expected recoverable path (cold binary cache, etc.).
            this.log(`Binary bar chart unavailable: ${error.message}`, 'warning');
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