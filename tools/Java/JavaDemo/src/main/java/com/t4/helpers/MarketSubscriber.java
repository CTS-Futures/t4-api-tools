package com.t4.helpers;

import java.util.function.BiConsumer;
import java.util.logging.Logger;

import t4proto.v1.common.Enums.DepthBuffer;
import t4proto.v1.common.Enums.DepthLevels;
import t4proto.v1.market.Market.MarketDepthSubscribe;
import t4proto.v1.service.Service; // For ClientMessage

public class MarketSubscriber {

    private static final Logger logger = Logger.getLogger(MarketSubscriber.class.getName());

    private Subscription currentSubscription;
    private String currentMarketId;

    private BiConsumer<Service.ClientMessage, Callback> messageSender;

    // Public setter for message sending strategy
    public void setMessageSender(BiConsumer<Service.ClientMessage, Callback> sender) {
        this.messageSender = sender;
    }

    // Main subscribe method
    public void subscribeMarket(String exchangeId, String contractId, String marketId, Callback callback) {
        String key = exchangeId + "_" + contractId + "_" + marketId;

        if (currentSubscription != null) {
            // Unsubscribe from previous
            MarketDepthSubscribe unsubscribeMsg = MarketDepthSubscribe.newBuilder()
                .setExchangeId(currentSubscription.getExchangeId())
                .setContractId(currentSubscription.getContractId())
                .setMarketId(currentSubscription.getMarketId())
                .setBuffer(DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION)
                .setDepthLevels(DepthLevels.DEPTH_LEVELS_UNDEFINED)
                .build();

            Service.ClientMessage wrappedUnsub = Service.ClientMessage.newBuilder()
                .setMarketDepthSubscribe(unsubscribeMsg)
                .build();

            messageSender.accept(wrappedUnsub, new Callback() {
                @Override
                public void onComplete() {
                    logger.info("Unsubscribed from market: " + currentSubscription.getMarketId());
                    currentSubscription = null;
                    proceedWithSubscription(exchangeId, contractId, marketId, callback);
                }

                @Override
                public void onError(Exception e) {
                    logger.severe("Failed to unsubscribe: " + e.getMessage());
                    callback.onError(e);
                }
            });
        } else {
            proceedWithSubscription(exchangeId, contractId, marketId, callback);
        }
    }

    private void proceedWithSubscription(String exchangeId, String contractId, String marketId, Callback callback) {
        currentSubscription = new Subscription(exchangeId, contractId, marketId);
        currentMarketId = marketId;

        MarketDepthSubscribe subscribeMsg = MarketDepthSubscribe.newBuilder()
            .setExchangeId(exchangeId)
            .setContractId(contractId)
            .setMarketId(marketId)
            .setBuffer(DepthBuffer.DEPTH_BUFFER_SMART)
            .setDepthLevels(DepthLevels.DEPTH_LEVELS_BEST_ONLY)
            .build();
            System.out.println(subscribeMsg);

        Service.ClientMessage wrappedSub = Service.ClientMessage.newBuilder()
            .setMarketDepthSubscribe(subscribeMsg)
            .build();

        messageSender.accept(wrappedSub, new Callback() {
            @Override
            public void onComplete() {
                logger.info("Subscribed to market: " + marketId);
                callback.onComplete();
            }

            @Override
            public void onError(Exception e) {
                logger.severe("Failed to subscribe: " + e.getMessage());
                callback.onError(e);
            }
        });
    }

    public void unsubscribeCurrent(Callback callback) {
    if (currentSubscription == null) {
        logger.info("No current market subscription to unsubscribe.");
        callback.onComplete();
        return;
    }

    MarketDepthSubscribe unsubscribeMsg = MarketDepthSubscribe.newBuilder()
        .setExchangeId(currentSubscription.getExchangeId())
        .setContractId(currentSubscription.getContractId())
        .setMarketId(currentSubscription.getMarketId())
        .setBuffer(DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION)
        .setDepthLevels(DepthLevels.DEPTH_LEVELS_UNDEFINED)
        .build();

    Service.ClientMessage wrappedUnsub = Service.ClientMessage.newBuilder()
        .setMarketDepthSubscribe(unsubscribeMsg)
        .build();

    messageSender.accept(wrappedUnsub, new Callback() {
        @Override
        public void onComplete() {
            logger.info("Unsubscribed from market: " + currentSubscription.getMarketId());
            currentSubscription = null;
            currentMarketId = null;
            callback.onComplete();
        }

        @Override
        public void onError(Exception e) {
            logger.severe("Unsubscribe error: " + e.getMessage());
            callback.onError(e);
        }
    });
}

    // Simple subscription wrapper
    public static class Subscription {
        private final String exchangeId;
        private final String contractId;
        private final String marketId;

        public Subscription(String exchangeId, String contractId, String marketId) {
            this.exchangeId = exchangeId;
            this.contractId = contractId;
            this.marketId = marketId;
        }

        public String getExchangeId() {
            return exchangeId;
        }

        public String getContractId() {
            return contractId;
        }

        public String getMarketId() {
            return marketId;
        }
    }
}