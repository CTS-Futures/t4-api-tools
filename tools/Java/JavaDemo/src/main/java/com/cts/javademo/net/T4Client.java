package com.cts.javademo.net;

import com.cts.javademo.config.Config;
import com.cts.javademo.state.AppState;

import t4proto.v1.account.Account;
import t4proto.v1.auth.Auth;
import t4proto.v1.common.Enums;
import t4proto.v1.common.PriceOuterClass;
import t4proto.v1.market.Market;
import t4proto.v1.orderrouting.Orderrouting;
import t4proto.v1.service.Service;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * One reconnecting WebSocket session against the T4 v1 gateway: login, heartbeat,
 * token refresh, subscriptions, order routing; plus REST chart loads on a
 * background executor. Ported in spirit from {@code tools/Rust/RustDemo/src/net/mod.rs}.
 *
 * <p>Inbound frames are handled on the {@link HttpClient} executor; UI commands
 * arrive via the public {@code command} methods. All state mutation goes through
 * {@code AppState.write(...)}.
 */
public final class T4Client {

    private static final int HEARTBEAT_SECONDS = 20;
    private static final int RECONNECT_SECONDS = 3;

    private final Config.WsConfig cfg;
    private final AppState state;
    private final RestClient rest;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(daemon("t4-scheduler"));
    private final ExecutorService worker = Executors.newCachedThreadPool(daemon("t4-worker"));

    private volatile WebSocket webSocket;
    private volatile ScheduledFuture<?> heartbeatTask;
    private volatile boolean shuttingDown;
    private volatile boolean marketSubscribed;

    public T4Client(Config.WsConfig cfg, AppState state, RestClient rest) {
        this.cfg = cfg;
        this.state = state;
        this.rest = rest;
    }

    public RestClient rest() {
        return rest;
    }

    public void start() {
        connect();
    }

    public void shutdown() {
        shuttingDown = true;
        WebSocket ws = webSocket;
        if (ws != null) {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
        }
        scheduler.shutdownNow();
        worker.shutdownNow();
        // Give in-flight tasks a moment to unwind so teardown doesn't log spurious errors.
        try {
            scheduler.awaitTermination(2, TimeUnit.SECONDS);
            worker.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // =======================================================================
    // Connection lifecycle
    // =======================================================================

    private void connect() {
        state.write(s -> s.connection = AppState.ConnStatus.CONNECTING);
        state.log("connecting to " + cfg.url + " ...");

        http.newWebSocketBuilder()
                .buildAsync(URI.create(cfg.url), new SessionListener())
                .whenComplete((ws, err) -> {
                    if (err != null) {
                        state.write(s -> s.connection = AppState.ConnStatus.ERROR);
                        state.log("WebSocket connect failed: " + rootMessage(err));
                        scheduleReconnect();
                    }
                });
    }

    private void scheduleReconnect() {
        if (shuttingDown) {
            return;
        }
        stopHeartbeat();
        try {
            scheduler.schedule(() -> {
                state.log("reconnecting...");
                connect();
            }, RECONNECT_SECONDS, TimeUnit.SECONDS);
        } catch (RuntimeException ignored) {
            // scheduler shut down during teardown
        }
    }

    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatTask = scheduler.scheduleAtFixedRate(
                this::sendHeartbeat, HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS);
    }

    private void stopHeartbeat() {
        ScheduledFuture<?> t = heartbeatTask;
        if (t != null) {
            t.cancel(false);
            heartbeatTask = null;
        }
    }

    // =======================================================================
    // Outbound
    // =======================================================================

    void send(byte[] bytes) {
        WebSocket ws = webSocket;
        if (ws != null) {
            ws.sendBinary(ByteBuffer.wrap(bytes), true);
        }
    }

    private void sendLogin() {
        Auth.LoginRequest req = Auth.LoginRequest.newBuilder()
                .setApiKey("")
                .setFirm(nz(cfg.firm))
                .setUsername(nz(cfg.username))
                .setPassword(nz(cfg.password))
                .setAppName(nz(cfg.appName))
                .setAppLicense(nz(cfg.appLicense))
                .setPriceFormat(priceFormat(cfg.priceFormat))
                .build();
        send(ProtoCodec.encodeClient(b -> b.setLoginRequest(req)));
        state.log("login request sent");
    }

    private void sendHeartbeat() {
        Service.Heartbeat hb = Service.Heartbeat.newBuilder()
                .setTimestamp(System.currentTimeMillis())
                .build();
        send(ProtoCodec.encodeClient(b -> b.setHeartbeat(hb)));
        maybeRefreshToken();
    }

    private void maybeRefreshToken() {
        boolean need = state.read(s ->
                s.authToken != null
                        && s.tokenExpirySeconds != 0
                        && s.tokenExpirySeconds <= (System.currentTimeMillis() / 1000) + 30);
        if (need) {
            Auth.AuthenticationTokenRequest req = Auth.AuthenticationTokenRequest.newBuilder()
                    .setRequestId("javademo-" + System.currentTimeMillis())
                    .build();
            send(ProtoCodec.encodeClient(b -> b.setAuthenticationTokenRequest(req)));
        }
    }

    private void sendAccountSubscribe(String accountId) {
        Account.AccountSubscribe sub = Account.AccountSubscribe.newBuilder()
                .setSubscribe(Enums.AccountSubscribeType.ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES)
                .setSubscribeAllAccounts(false)
                .addAccountId(accountId)
                .setUplMode(Enums.UPLMode.UPL_MODE_AVERAGE)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setAccountSubscribe(sub)));
    }

    private void sendMarketDepthSubscribe(String exchangeId, String contractId, String marketId) {
        Market.MarketDepthSubscribe sub = Market.MarketDepthSubscribe.newBuilder()
                .setExchangeId(exchangeId)
                .setContractId(contractId)
                .setMarketId(marketId)
                .setBuffer(Enums.DepthBuffer.DEPTH_BUFFER_SMART)
                .setDepthLevels(Enums.DepthLevels.DEPTH_LEVELS_NORMAL)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setMarketDepthSubscribe(sub)));
    }

    private void sendMarketDepthUnsubscribe(String exchangeId, String contractId, String marketId) {
        Market.MarketDepthSubscribe sub = Market.MarketDepthSubscribe.newBuilder()
                .setExchangeId(exchangeId)
                .setContractId(contractId)
                .setMarketId(marketId)
                .setBuffer(Enums.DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION)
                .setDepthLevels(Enums.DepthLevels.DEPTH_LEVELS_UNDEFINED)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setMarketDepthSubscribe(sub)));
    }

    // =======================================================================
    // Commands (UI -> network)
    // =======================================================================

    public void subscribeAccount(String accountId) {
        sendAccountSubscribe(accountId);
        state.write(s -> {
            s.selectedAccount = accountId;
            s.balance = 0;
            s.margin = 0;
            s.availableCash = 0;
        });
        state.log("subscribing to account " + accountId);
    }

    public void loadChart(String interval, int period) {
        worker.submit(() -> loadChartFromState(interval, period));
    }

    private void loadChartFromState(String interval, int period) {
        String token = state.read(s -> s.authToken);
        String exchange = state.read(s -> s.exchangeId != null ? s.exchangeId : cfg.mdExchangeId);
        String contract = state.read(s -> s.contractId != null ? s.contractId : cfg.mdContractId);
        String marketId = state.read(s -> s.marketId);
        if (token == null || marketId == null) {
            state.log("cannot load chart: waiting for login/market");
            return;
        }
        loadChart(token, exchange, contract, marketId, interval, period);
    }

    private void loadChart(String token, String exchange, String contract, String marketId,
                           String interval, int period) {
        long secs = RestClient.intervalToSecs(interval, period);
        state.write(s -> {
            s.chartLoading = true;
            s.chartInterval = interval;
            s.chartPeriod = period;
            s.chartIntervalSecs = secs;
            s.chartLoadingOlder = false;
            s.chartNoMore = false;
        });
        state.log("loading chart (" + interval + "/" + period + ")...");
        try {
            RestClient.FetchResult fr = rest.fetchChart(token, exchange, contract, marketId, interval, period);
            state.write(s -> {
                s.chartLoading = false;
                s.candles = fr.candles();
                s.chartWindowStart = fr.windowStart();
                s.chartFormat = "binary (T4BinAggr)";
                s.chartGeneration++;
            });
            state.log("chart loaded: " + fr.candles().size() + " bars");
        } catch (Exception e) {
            state.write(s -> s.chartLoading = false);
            state.log("chart load failed: " + rootMessage(e));
        }
    }

    public void loadOlderChart() {
        worker.submit(this::loadOlder);
    }

    private void loadOlder() {
        String token = state.read(s -> s.authToken);
        String exchange = state.read(s -> s.exchangeId != null ? s.exchangeId : cfg.mdExchangeId);
        String contract = state.read(s -> s.contractId != null ? s.contractId : cfg.mdContractId);
        String marketId = state.read(s -> s.marketId);
        String interval = state.read(s -> s.chartInterval);
        int period = state.read(s -> s.chartPeriod == 0 ? 1 : s.chartPeriod);
        LocalDate windowStart = state.read(s -> s.chartWindowStart);
        boolean skip = state.read(s -> s.chartLoadingOlder || s.chartNoMore || s.candles.isEmpty());
        long oldest = state.read(s -> s.candles.isEmpty() ? Long.MAX_VALUE : s.candles.get(0).timeMs);
        if (skip || token == null || marketId == null || windowStart == null) {
            return;
        }

        state.write(s -> s.chartLoadingOlder = true);
        try {
            RestClient.OlderPage page = rest.fetchOlder(token, exchange, contract, marketId, interval, period, windowStart);
            state.write(s -> {
                s.chartLoadingOlder = false;
                s.chartWindowStart = page.windowStart();
                List<AppState.Candle> older = new ArrayList<>();
                for (AppState.Candle c : page.candles()) {
                    if (c.timeMs < oldest) {
                        older.add(c);
                    }
                }
                if (!older.isEmpty()) {
                    older.addAll(s.candles);
                    s.candles = older;
                }
                if (page.reachedFloor()) {
                    s.chartNoMore = true;
                }
            });
            if (page.reachedFloor()) {
                state.log("reached start of history");
            }
        } catch (Exception e) {
            state.write(s -> s.chartLoadingOlder = false);
            state.log("older history load failed: " + rootMessage(e));
        }
    }

    /** Switch the active market by resolving the picked contract via firstmarket. */
    public void selectMarket(String exchangeId, String contractId) {
        worker.submit(() -> {
            String token = state.read(s -> s.authToken);
            if (token == null) {
                state.log("cannot switch market: not logged in");
                return;
            }
            try {
                String marketId = rest.firstMarket(token, exchangeId, contractId);
                switchMarket(token, exchangeId, contractId, marketId);
            } catch (Exception e) {
                state.log("market resolve failed: " + rootMessage(e));
            }
        });
    }

    /** Switch to an already-resolved market id (from the expiry picker). */
    public void selectMarketById(String exchangeId, String contractId, String marketId) {
        worker.submit(() -> {
            String token = state.read(s -> s.authToken);
            if (token == null) {
                state.log("cannot switch market: not logged in");
                return;
            }
            switchMarket(token, exchangeId, contractId, marketId);
        });
    }

    private void switchMarket(String token, String exchangeId, String contractId, String marketId) {
        String[] old = state.read(s -> new String[]{s.exchangeId, s.contractId, s.marketId});
        if (old[0] != null && old[1] != null && old[2] != null) {
            sendMarketDepthUnsubscribe(old[0], old[1], old[2]);
        }
        sendMarketDepthSubscribe(exchangeId, contractId, marketId);

        String interval = state.read(s -> s.chartInterval == null || s.chartInterval.isEmpty() ? "Minute" : s.chartInterval);
        int period = state.read(s -> s.chartPeriod == 0 ? 1 : s.chartPeriod);

        state.write(s -> {
            s.exchangeId = exchangeId;
            s.contractId = contractId;
            s.marketId = marketId;
            s.quote.bidPrice = "";
            s.quote.askPrice = "";
            s.quote.lastPrice = "";
            s.bids = new ArrayList<>();
            s.offers = new ArrayList<>();
            s.depthMarketId = null;
            s.candles = new ArrayList<>();
            s.chartNoMore = false;
            s.chartLoadingOlder = false;
            s.chartWindowStart = null;
        });
        state.log("switched to " + exchangeId + "/" + contractId + " -> " + marketId);
        loadChart(token, exchangeId, contractId, marketId, interval, period);
    }

    public void submitOrder(OrderRequest req) {
        String marketId = state.read(s -> s.marketId);
        String pointValue = state.read(s -> s.marketPointValue);
        int decimals = state.read(s -> s.marketDecimals);
        int realDecimals = state.read(s -> s.marketRealDecimals);
        if (marketId == null) {
            state.log("cannot submit: no active market");
            return;
        }

        Enums.BuySell side = req.buy ? Enums.BuySell.BUY_SELL_BUY : Enums.BuySell.BUY_SELL_SELL;
        Enums.PriceType priceType = switch (req.kind) {
            case MARKET -> Enums.PriceType.PRICE_TYPE_MARKET;
            case LIMIT -> Enums.PriceType.PRICE_TYPE_LIMIT;
            case STOP -> Enums.PriceType.PRICE_TYPE_STOP_MARKET;
            case STOP_LIMIT -> Enums.PriceType.PRICE_TYPE_STOP_LIMIT;
        };
        Enums.TimeType timeType = switch (req.tif) {
            case DAY -> Enums.TimeType.TIME_TYPE_NORMAL;
            case GTC -> Enums.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED;
            case IOC -> Enums.TimeType.TIME_TYPE_IMMEDIATE_AND_CANCEL;
            case FOK -> Enums.TimeType.TIME_TYPE_COMPLETE_VOLUME;
        };

        Orderrouting.OrderSubmit.Order.Builder entry = Orderrouting.OrderSubmit.Order.newBuilder()
                .setBuySell(side)
                .setPriceType(priceType)
                .setTimeType(timeType)
                .setVolume(req.volume);
        if (req.kind.hasLimit() && !req.limitPrice.trim().isEmpty()) {
            entry.setLimitPrice(price(req.limitPrice.trim()));
        }
        if (req.kind.hasStop() && !req.stopPrice.trim().isEmpty()) {
            entry.setStopPrice(price(req.stopPrice.trim()));
        }

        List<Orderrouting.OrderSubmit.Order> orders = new ArrayList<>();
        orders.add(entry.build());

        // Bracket legs: convert $ P&L into a signed price offset applied at fill under AUTO_OCO
        // (mirrors the JS/Rust demos): offset = (|$|/volume)/point_value/10^price_decimals.
        if (req.takeProfit != null || req.stopLoss != null) {
            int priceDecimals = cfg.priceFormat == 0 ? decimals : realDecimals;
            Double pv = parseD(pointValue);
            if (pv != null && pv > 0 && req.volume > 0) {
                Enums.BuySell protection = req.buy ? Enums.BuySell.BUY_SELL_SELL : Enums.BuySell.BUY_SELL_BUY;
                double scale = Math.pow(10, priceDecimals);
                if (req.takeProfit != null) {
                    double off = (Math.abs(req.takeProfit) / req.volume) / pv / scale;
                    double signed = req.buy ? off : -off;
                    orders.add(protectionLeg(protection, Enums.PriceType.PRICE_TYPE_LIMIT, signed, true));
                }
                if (req.stopLoss != null) {
                    double off = (Math.abs(req.stopLoss) / req.volume) / pv / scale;
                    double signed = req.buy ? -off : off;
                    orders.add(protectionLeg(protection, Enums.PriceType.PRICE_TYPE_STOP_MARKET, signed, false));
                }
            } else {
                state.log("brackets skipped: market point value not available yet");
            }
        }

        Enums.OrderLink link = orders.size() > 1
                ? Enums.OrderLink.ORDER_LINK_AUTO_OCO
                : Enums.OrderLink.ORDER_LINK_NONE;

        Orderrouting.OrderSubmit submit = Orderrouting.OrderSubmit.newBuilder()
                .setAccountId(req.accountId)
                .setMarketId(marketId)
                .setOrderLink(link)
                .setManualOrderIndicator(true)
                .addAllOrders(orders)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setOrderSubmit(submit)));
        state.log("order sent: " + (req.buy ? "BUY" : "SELL") + " " + req.volume + " "
                + orderDesc(req) + " " + req.tif.label() + " on " + marketId
                + (link == Enums.OrderLink.ORDER_LINK_AUTO_OCO ? " [AUTO_OCO]" : ""));
    }

    private Orderrouting.OrderSubmit.Order protectionLeg(Enums.BuySell side, Enums.PriceType priceType,
                                                         double signedOffset, boolean isLimit) {
        Orderrouting.OrderSubmit.Order.Builder b = Orderrouting.OrderSubmit.Order.newBuilder()
                .setBuySell(side)
                .setPriceType(priceType)
                .setTimeType(Enums.TimeType.TIME_TYPE_GOOD_TILL_CANCELLED)
                .setVolume(0)
                .setActivationType(Enums.ActivationType.ACTIVATION_TYPE_HOLD);
        if (isLimit) {
            b.setLimitPrice(price(fmtOffset(signedOffset)));
        } else {
            b.setStopPrice(price(fmtOffset(signedOffset)));
        }
        return b.build();
    }

    public void reviseOrder(String accountId, String marketId, String uniqueId, int volume,
                            String newPrice, boolean isStop) {
        Orderrouting.OrderRevise.Revise.Builder rev = Orderrouting.OrderRevise.Revise.newBuilder()
                .setUniqueId(uniqueId)
                .setVolume(volume);
        if (newPrice != null && !newPrice.trim().isEmpty()) {
            if (isStop) {
                rev.setStopPrice(price(newPrice.trim()));
            } else {
                rev.setLimitPrice(price(newPrice.trim()));
            }
        }
        Orderrouting.OrderRevise msg = Orderrouting.OrderRevise.newBuilder()
                .setAccountId(accountId)
                .setMarketId(marketId)
                .setManualOrderIndicator(true)
                .addRevisions(rev.build())
                .build();
        send(ProtoCodec.encodeClient(b -> b.setOrderRevise(msg)));
        state.log("revise sent for " + uniqueId + " (" + (isStop ? "stop" : "limit") + " price)");
    }

    public void cancelOrder(String accountId, String marketId, String uniqueId) {
        Orderrouting.OrderPull.Pull pull = Orderrouting.OrderPull.Pull.newBuilder()
                .setUniqueId(uniqueId)
                .build();
        Orderrouting.OrderPull msg = Orderrouting.OrderPull.newBuilder()
                .setAccountId(accountId)
                .setMarketId(marketId)
                .setManualOrderIndicator(true)
                .addPulls(pull)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setOrderPull(msg)));
        state.log("cancel sent for " + uniqueId);
    }

    /**
     * Place an order at a specific price on the active market (used by the chart and DOM ladder).
     * A market order ignores {@code price}. Reuses the existing {@link #submitOrder} plumbing.
     */
    public void submitAtPrice(boolean buy, OrderRequest.Kind kind, int volume, double price,
                              OrderRequest.TimeInForce tif) {
        String acct = state.read(s -> s.selectedAccount);
        if (acct == null) {
            state.log("cannot place order: no account selected");
            return;
        }
        OrderRequest req = new OrderRequest();
        req.accountId = acct;
        req.buy = buy;
        req.kind = kind;
        req.volume = volume;
        req.tif = tif;
        String priceStr = fmtPrice(price);
        if (kind.hasLimit()) {
            req.limitPrice = priceStr;
        }
        if (kind.hasStop()) {
            req.stopPrice = priceStr;
        }
        submitOrder(req);
    }

    /**
     * Convenience wrapper for chart drag-to-revise: revise a working order to a new limit price,
     * keeping its current volume. Falls back gracefully if the order is unknown.
     */
    public void reviseOrderPrice(String uniqueId, double newPrice) {
        // One snapshot so ids/volume/order-type are mutually consistent. isLimit uses the same
        // rule as OrderOverlay, so the field revised matches the line the user dragged: a pure
        // stop revises its stop price; limit and stop-limit orders revise their limit price.
        Object[] snap = state.read(s -> {
            AppState.OrderRow o = s.orders.get(uniqueId);
            if (o == null) {
                return null;
            }
            boolean isLimit = o.limitPrice != null && !o.limitPrice.isEmpty();
            return new Object[]{o.accountId, o.marketId, o.volume, isLimit};
        });
        if (snap == null) {
            state.log("cannot revise: unknown order " + uniqueId);
            return;
        }
        boolean isLimit = (Boolean) snap[3];
        reviseOrder((String) snap[0], (String) snap[1], uniqueId, (Integer) snap[2],
                fmtPrice(newPrice), !isLimit);
    }

    /** Pull every Working/Held order for the account, grouped by market. */
    public void cancelAll(String accountId) {
        Map<String, List<String>> groups = state.read(s -> {
            Map<String, List<String>> g = new TreeMap<>();
            for (AppState.OrderRow o : s.orders.values()) {
                if (!o.accountId.equals(accountId)) {
                    continue;
                }
                if (!o.status.equals("Working") && !o.status.equals("Held")) {
                    continue;
                }
                g.computeIfAbsent(o.marketId, k -> new ArrayList<>()).add(o.uniqueId);
            }
            return g;
        });
        if (groups.isEmpty()) {
            state.log("cancel-all: no working orders");
            return;
        }
        int count = 0;
        for (Map.Entry<String, List<String>> e : groups.entrySet()) {
            Orderrouting.OrderPull.Builder msg = Orderrouting.OrderPull.newBuilder()
                    .setAccountId(accountId)
                    .setMarketId(e.getKey())
                    .setManualOrderIndicator(true);
            for (String id : e.getValue()) {
                msg.addPulls(Orderrouting.OrderPull.Pull.newBuilder().setUniqueId(id).build());
                count++;
            }
            send(ProtoCodec.encodeClient(b -> b.setOrderPull(msg.build())));
        }
        state.log("cancel-all: pulled " + count + " order(s)");
    }

    /** Market order that closes (flatten) or flips (reverse) the net position on a market. */
    public void flattenOrReverse(String accountId, String marketId, boolean reverse) {
        int net = state.read(s -> {
            AppState.PositionRow p = s.positions.get(marketId);
            return p == null ? 0 : p.net;
        });
        String verb = reverse ? "reverse" : "flatten";
        if (net == 0) {
            state.log("no position to " + verb + " on " + marketId);
            return;
        }
        boolean buy = net < 0;
        int volume = Math.abs(net) * (reverse ? 2 : 1);
        Orderrouting.OrderSubmit.Order order = Orderrouting.OrderSubmit.Order.newBuilder()
                .setBuySell(buy ? Enums.BuySell.BUY_SELL_BUY : Enums.BuySell.BUY_SELL_SELL)
                .setPriceType(Enums.PriceType.PRICE_TYPE_MARKET)
                .setTimeType(Enums.TimeType.TIME_TYPE_NORMAL)
                .setVolume(volume)
                .build();
        Orderrouting.OrderSubmit submit = Orderrouting.OrderSubmit.newBuilder()
                .setAccountId(accountId)
                .setMarketId(marketId)
                .setOrderLink(Enums.OrderLink.ORDER_LINK_NONE)
                .setManualOrderIndicator(true)
                .addOrders(order)
                .build();
        send(ProtoCodec.encodeClient(b -> b.setOrderSubmit(submit)));
        state.log(verb + ": " + (buy ? "BUY" : "SELL") + " " + volume + " on " + marketId);
    }

    // =======================================================================
    // Inbound dispatch (network -> state)
    // =======================================================================

    private void handleServerBytes(byte[] bytes) {
        Service.ServerMessage msg;
        try {
            msg = Service.ServerMessage.parseFrom(bytes);
        } catch (Exception e) {
            state.log("decode error: " + e.getMessage());
            return;
        }

        switch (msg.getPayloadCase()) {
            case LOGIN_RESPONSE -> handleLogin(msg.getLoginResponse());
            case AUTHENTICATION_TOKEN -> {
                state.write(s -> applyToken(s, msg.getAuthenticationToken()));
                state.log("auth token refreshed");
            }
            case MARKET_DETAILS -> applyMarketDetails(msg.getMarketDetails());
            case MARKET_DEPTH -> state.write(s -> applyMarketDepth(s, msg.getMarketDepth()));
            case MARKET_DEPTH_TRADE -> {
                Market.MarketDepthTrade t = msg.getMarketDepthTrade();
                state.write(s -> {
                    String lp = priceStr(t.getLastTradePrice());
                    s.quote.lastPrice = lp;
                    s.quote.lastVolume = t.getLastTradeVolume();
                    applyLiveTick(s, lp, t.getLastTradeVolume());
                });
            }
            case MARKET_SNAPSHOT -> state.write(s -> {
                for (Market.MarketSnapshotMessage m : msg.getMarketSnapshot().getMessagesList()) {
                    if (m.getPayloadCase() == Market.MarketSnapshotMessage.PayloadCase.MARKET_DEPTH) {
                        applyMarketDepth(s, m.getMarketDepth());
                    }
                }
            });
            case ACCOUNT_SUBSCRIBE_RESPONSE ->
                    state.log("account subscribe: success=" + msg.getAccountSubscribeResponse().getSuccess());
            case ACCOUNT_SNAPSHOT -> state.write(s -> {
                for (Account.AccountSnapshotMessage m : msg.getAccountSnapshot().getMessagesList()) {
                    switch (m.getPayloadCase()) {
                        case ACCOUNT_POSITION -> applyPosition(s, m.getAccountPosition());
                        case ORDER_UPDATE_MULTI -> applyOrderMulti(s, m.getOrderUpdateMulti());
                        default -> {
                        }
                    }
                }
            });
            case ACCOUNT_UPDATE -> {
                Account.AccountUpdate u = msg.getAccountUpdate();
                state.write(s -> {
                    s.balance = u.getBalance();
                    s.margin = u.getMargin();
                });
            }
            case ACCOUNT_PROFIT -> {
                Account.AccountProfit p = msg.getAccountProfit();
                if (p.hasAvailableCash()) {
                    state.write(s -> s.availableCash = p.getAvailableCash());
                }
            }
            case ACCOUNT_POSITION -> state.write(s -> applyPosition(s, msg.getAccountPosition()));
            case ACCOUNT_POSITION_PROFIT -> {
                Account.AccountPositionProfit p = msg.getAccountPositionProfit();
                state.write(s -> {
                    AppState.PositionRow row = s.positions.get(p.getMarketId());
                    if (row != null) {
                        if (p.hasUpl()) {
                            row.upl = p.getUpl();
                        }
                        if (p.hasRpl()) {
                            row.rpl = p.getRpl();
                        }
                    }
                });
            }
            case ORDER_UPDATE -> state.write(s -> applyOrderUpdate(s, msg.getOrderUpdate()));
            case ORDER_UPDATE_MULTI -> state.write(s -> applyOrderMulti(s, msg.getOrderUpdateMulti()));
            case ORDER_UPDATE_STATUS -> state.write(s -> applyOrderStatus(s, msg.getOrderUpdateStatus()));
            case ORDER_UPDATE_TRADE -> {
                Orderrouting.OrderUpdateTrade t = msg.getOrderUpdateTrade();
                state.write(s -> applyOrderTrade(s, t));
                state.log("fill: " + t.getVolume() + " @ " + priceStr(t.getPrice()) + " (" + t.getWorkingVolume() + " left)");
            }
            case ORDER_UPDATE_FAILED -> {
                Orderrouting.OrderUpdateFailed f = msg.getOrderUpdateFailed();
                state.write(s -> {
                    AppState.OrderRow row = s.orders.computeIfAbsent(f.getUniqueId(), k -> new AppState.OrderRow());
                    row.uniqueId = f.getUniqueId();
                    row.status = "Rejected";
                    row.statusDetail = f.getStatusDetail();
                });
                state.log("order failed: " + f.getStatusDetail());
            }
            default -> {
            }
        }
    }

    private void handleLogin(Auth.LoginResponse r) {
        boolean success = r.getResult() == Enums.LoginResult.LOGIN_RESULT_SUCCESS;
        if (!success) {
            state.write(s -> s.connection = AppState.ConnStatus.ERROR);
            state.log("login failed (result=" + r.getResult() + "): " + r.getErrorMessage());
            return;
        }

        List<AppState.AccountInfo> accounts = new ArrayList<>();
        for (Auth.LoginResponse.Account a : r.getAccountsList()) {
            String name = !a.getDisplayName().isEmpty() ? a.getDisplayName()
                    : !a.getAccountName().isEmpty() ? a.getAccountName()
                    : a.getAccountNumber();
            accounts.add(new AppState.AccountInfo(a.getAccountId(), name));
        }
        String firstAccount = accounts.isEmpty() ? null : accounts.get(0).accountId;
        boolean hasToken = r.hasAuthenticationToken();

        state.write(s -> {
            s.connection = AppState.ConnStatus.LOGGED_IN;
            s.accounts = accounts;
            if (s.selectedAccount == null && firstAccount != null) {
                s.selectedAccount = firstAccount;
            }
            if (hasToken) {
                applyToken(s, r.getAuthenticationToken());
            }
        });
        state.log("login OK -- " + accounts.size() + " account(s)");

        if (firstAccount != null) {
            sendAccountSubscribe(firstAccount);
        }

        if (!marketSubscribed) {
            String token = state.read(s -> s.authToken);
            if (token != null) {
                marketSubscribed = true;
                worker.submit(() -> autoSubscribeMarket(token));
            }
        }
    }

    private void autoSubscribeMarket(String token) {
        String exchange = cfg.mdExchangeId;
        String contract = cfg.mdContractId;
        try {
            String marketId = rest.firstMarket(token, exchange, contract);
            sendMarketDepthSubscribe(exchange, contract, marketId);
            state.write(s -> {
                s.exchangeId = exchange;
                s.contractId = contract;
                s.marketId = marketId;
            });
            state.log("subscribed to market " + marketId);
            loadChart(token, exchange, contract, marketId, "Minute", 1);
        } catch (Exception e) {
            state.log("market resolve failed: " + rootMessage(e));
        }
    }

    // =======================================================================
    // State appliers
    // =======================================================================

    private void applyMarketDetails(Market.MarketDetails d) {
        state.write(s -> {
            s.marketDecimals = d.getDecimals();
            s.marketRealDecimals = d.getRealDecimals();
            if (d.hasPointValue()) {
                s.marketPointValue = d.getPointValue().getValue();
            }
            Double tick = d.hasMinPriceIncrement() ? parseD(d.getMinPriceIncrement().getValue()) : null;
            if (tick != null && tick > 0) {
                s.marketTickSize = tick;
            } else {
                s.marketTickSize = Math.pow(10, -Math.max(0, d.getDecimals()));
            }
        });
    }

    private static void applyMarketDepth(AppState s, Market.MarketDepth d) {
        // Store the full ladder (best first) for the DOM panel, guarded by the active market.
        if (d.getBidsCount() > 0 || d.getOffersCount() > 0) {
            List<AppState.DepthLine> bids = new ArrayList<>(d.getBidsCount());
            for (Market.MarketDepth.DepthLine b : d.getBidsList()) {
                bids.add(new AppState.DepthLine(priceStr(b.getPrice()), b.getVolume(), b.getNumOrders()));
            }
            List<AppState.DepthLine> offers = new ArrayList<>(d.getOffersCount());
            for (Market.MarketDepth.DepthLine o : d.getOffersList()) {
                offers.add(new AppState.DepthLine(priceStr(o.getPrice()), o.getVolume(), o.getNumOrders()));
            }
            s.bids = bids;
            s.offers = offers;
            s.depthMarketId = s.marketId;
        }
        if (d.getBidsCount() > 0) {
            Market.MarketDepth.DepthLine b = d.getBids(0);
            s.quote.bidPrice = priceStr(b.getPrice());
            s.quote.bidVolume = b.getVolume();
        }
        if (d.getOffersCount() > 0) {
            Market.MarketDepth.DepthLine o = d.getOffers(0);
            s.quote.askPrice = priceStr(o.getPrice());
            s.quote.askVolume = o.getVolume();
        }
        if (d.hasTradeData()) {
            String lp = priceStr(d.getTradeData().getLastTradePrice());
            if (!lp.isEmpty()) {
                s.quote.lastPrice = lp;
                s.quote.lastVolume = d.getTradeData().getLastTradeVolume();
                applyLiveTick(s, lp, d.getTradeData().getLastTradeVolume());
            }
        }
    }

    /** Fold a trade tick into the current in-progress candle (bucketed by wall clock). */
    private static void applyLiveTick(AppState s, String priceStr, int volume) {
        if (s.candles.isEmpty() || s.chartIntervalSecs <= 0 || priceStr.isEmpty()) {
            return;
        }
        double price;
        try {
            price = Double.parseDouble(priceStr);
        } catch (NumberFormatException e) {
            return;
        }
        long nowMs = System.currentTimeMillis();
        long bucketMs = s.chartIntervalSecs * 1000;
        long bucket = nowMs - Math.floorMod(nowMs, bucketMs);

        AppState.Candle last = s.candles.get(s.candles.size() - 1);
        if (last.timeMs == bucket) {
            last.high = Math.max(last.high, price);
            last.low = Math.min(last.low, price);
            last.close = price;
            last.volume += volume;
        } else if (bucket > last.timeMs) {
            s.candles.add(new AppState.Candle(bucket, price, price, price, price, volume));
        }
    }

    private static void applyPosition(AppState s, Account.AccountPosition p) {
        AppState.PositionRow row = s.positions.computeIfAbsent(p.getMarketId(), k -> new AppState.PositionRow());
        row.marketId = p.getMarketId();
        row.net = p.getBuys() - p.getSells();
        row.workingBuys = p.getWorkingBuys();
        row.workingSells = p.getWorkingSells();
        row.rpl = p.getRpl();
        if (p.hasAverageOpenPrice()) {
            row.avgOpenPrice = parseOr0(p.getAverageOpenPrice().getValue());
        }
    }

    private static void applyOrderMulti(AppState s, Orderrouting.OrderUpdateMulti m) {
        for (Orderrouting.OrderUpdateMultiMessage u : m.getUpdatesList()) {
            switch (u.getPayloadCase()) {
                case ORDER_UPDATE -> applyOrderUpdate(s, u.getOrderUpdate());
                case ORDER_UPDATE_STATUS -> applyOrderStatus(s, u.getOrderUpdateStatus());
                case ORDER_UPDATE_TRADE -> applyOrderTrade(s, u.getOrderUpdateTrade());
                case ORDER_UPDATE_FAILED -> {
                    Orderrouting.OrderUpdateFailed f = u.getOrderUpdateFailed();
                    AppState.OrderRow row = s.orders.computeIfAbsent(f.getUniqueId(), k -> new AppState.OrderRow());
                    row.uniqueId = f.getUniqueId();
                    row.status = "Rejected";
                    row.statusDetail = f.getStatusDetail();
                }
                default -> {
                }
            }
        }
    }

    private static void applyOrderUpdate(AppState s, Orderrouting.OrderUpdate o) {
        AppState.OrderRow row = s.orders.computeIfAbsent(o.getUniqueId(), k -> new AppState.OrderRow());
        row.uniqueId = o.getUniqueId();
        row.accountId = o.getAccountId();
        row.marketId = o.getMarketId();
        row.side = sideLabel(o.getBuySell());
        row.priceType = priceTypeLabel(o.getPriceType());
        row.volume = o.getCurrentVolume();
        row.workingVolume = o.getWorkingVolume();
        row.limitPrice = priceStr(o.getCurrentLimitPrice());
        row.stopPrice = priceStr(o.getCurrentStopPrice());
        row.status = orderStatusLabel(o.getStatus());
        row.statusDetail = o.getStatusDetail();
    }

    private static void applyOrderStatus(AppState s, Orderrouting.OrderUpdateStatus st) {
        AppState.OrderRow row = s.orders.computeIfAbsent(st.getUniqueId(), k -> new AppState.OrderRow());
        row.uniqueId = st.getUniqueId();
        row.accountId = st.getAccountId();
        row.marketId = st.getMarketId();
        if (st.getCurrentVolume() != 0) {
            row.volume = st.getCurrentVolume();
        }
        row.workingVolume = st.getWorkingVolume();
        String lp = priceStr(st.getCurrentLimitPrice());
        if (!lp.isEmpty()) {
            row.limitPrice = lp;
        }
        String sp = priceStr(st.getCurrentStopPrice());
        if (!sp.isEmpty()) {
            row.stopPrice = sp;
        }
        row.status = orderStatusLabel(st.getStatus());
        if (!st.getStatusDetail().isEmpty()) {
            row.statusDetail = st.getStatusDetail();
        }
    }

    private static void applyOrderTrade(AppState s, Orderrouting.OrderUpdateTrade t) {
        AppState.OrderRow row = s.orders.computeIfAbsent(t.getUniqueId(), k -> new AppState.OrderRow());
        row.uniqueId = t.getUniqueId();
        row.workingVolume = t.getWorkingVolume();
        row.status = orderStatusLabel(t.getStatus());

        // Record the executed fill (side is not on the trade message; resolve it from the order row).
        String priceStr = priceStr(t.getPrice());
        if (!priceStr.isEmpty() && t.getVolume() > 0) {
            boolean buy = "Buy".equals(row.side);
            String marketId = !t.getMarketId().isEmpty() ? t.getMarketId() : row.marketId;
            long timeMs = t.hasTime()
                    ? t.getTime().getSeconds() * 1000 + t.getTime().getNanos() / 1_000_000
                    : System.currentTimeMillis();
            s.fills.add(new AppState.Fill(timeMs, priceStr, t.getVolume(), buy, marketId, t.getUniqueId()));
            int n = s.fills.size();
            if (n > 2000) {
                s.fills.subList(0, n - 2000).clear();
            }
            s.fillGeneration++;
        }
    }

    private static void applyToken(AppState s, Auth.AuthenticationToken tok) {
        if (tok.hasToken()) {
            s.authToken = tok.getToken();
        }
        if (tok.hasExpireTime()) {
            s.tokenExpirySeconds = tok.getExpireTime().getSeconds();
        }
    }

    // =======================================================================
    // WebSocket listener
    // =======================================================================

    private final class SessionListener implements WebSocket.Listener {
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        @Override
        public void onOpen(WebSocket ws) {
            webSocket = ws;
            ws.request(Long.MAX_VALUE);
            state.write(s -> s.connection = AppState.ConnStatus.CONNECTED);
            state.log("WebSocket connected");
            sendLogin();
            startHeartbeat();
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
            byte[] chunk = new byte[data.remaining()];
            data.get(chunk);
            buffer.writeBytes(chunk);
            if (last) {
                byte[] full = buffer.toByteArray();
                buffer.reset();
                handleServerBytes(full);
            }
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
            state.write(s -> s.connection = AppState.ConnStatus.ERROR);
            state.log("connection closed (" + statusCode + ") " + reason);
            scheduleReconnect();
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            state.write(s -> s.connection = AppState.ConnStatus.ERROR);
            state.log("websocket error: " + rootMessage(error));
            scheduleReconnect();
        }
    }

    // =======================================================================
    // Small helpers
    // =======================================================================

    private static PriceOuterClass.Price price(String value) {
        return PriceOuterClass.Price.newBuilder().setValue(value).build();
    }

    private static String priceStr(PriceOuterClass.Price p) {
        return p == null ? "" : p.getValue();
    }

    private static String sideLabel(Enums.BuySell v) {
        return switch (v) {
            case BUY_SELL_BUY -> "Buy";
            case BUY_SELL_SELL -> "Sell";
            default -> "-";
        };
    }

    private static String priceTypeLabel(Enums.PriceType v) {
        return switch (v) {
            case PRICE_TYPE_MARKET -> "Market";
            case PRICE_TYPE_LIMIT -> "Limit";
            case PRICE_TYPE_STOP_MARKET -> "Stop";
            case PRICE_TYPE_STOP_LIMIT -> "StopLimit";
            default -> "-";
        };
    }

    private static String orderStatusLabel(Enums.OrderStatus v) {
        return switch (v) {
            case ORDER_STATUS_WORKING -> "Working";
            case ORDER_STATUS_FINISHED -> "Finished";
            case ORDER_STATUS_REJECTED -> "Rejected";
            case ORDER_STATUS_HELD -> "Held";
            default -> "-";
        };
    }

    private static String orderDesc(OrderRequest req) {
        return switch (req.kind) {
            case MARKET -> "MKT";
            case LIMIT -> "LMT @ " + req.limitPrice;
            case STOP -> "STP @ " + req.stopPrice;
            case STOP_LIMIT -> "STPLMT " + req.stopPrice + " @ " + req.limitPrice;
        };
    }

    /** Format a price to the active market's decimals (snapped to tick if known). */
    private String fmtPrice(double v) {
        int decimals = state.read(s -> cfg.priceFormat == 0 ? s.marketDecimals : s.marketRealDecimals);
        double tick = state.read(s -> s.marketTickSize);
        double snapped = tick > 0 ? Math.round(v / tick) * tick : v;
        String s = String.format(java.util.Locale.ROOT, "%." + Math.max(0, decimals) + "f", snapped);
        return s;
    }

    private static String fmtOffset(double v) {
        String s = String.format(java.util.Locale.ROOT, "%.10f", v);
        s = s.replaceAll("0+$", "").replaceAll("\\.$", "");
        return (s.isEmpty() || s.equals("-")) ? "0" : s;
    }

    private static Enums.PriceFormat priceFormat(int v) {
        Enums.PriceFormat pf = Enums.PriceFormat.forNumber(v);
        return pf != null ? pf : Enums.PriceFormat.PRICE_FORMAT_DECIMAL;
    }

    private static Double parseD(String s) {
        if (s == null || s.isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static double parseOr0(String s) {
        Double d = parseD(s);
        return d == null ? 0.0 : d;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String rootMessage(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null) {
            c = c.getCause();
        }
        return c.getClass().getSimpleName() + ": " + c.getMessage();
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }
}
