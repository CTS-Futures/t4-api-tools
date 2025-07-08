package com.t4.helpers;

import java.util.logging.Logger;

import t4proto.v1.common.Enums.DepthBuffer;
import t4proto.v1.common.Enums.DepthLevels;
import t4proto.v1.market.Market.MarketDepthSubscribe;

import com.t4.helpers.Callback;

public class MarketSubscriber {

    private static final Logger logger = Logger.getLogger(MarketSubscriber.class.getName());

    private Subscription currentSubscription;
    private String currentMarketId;

    // Subscribe to a market, unsubscribing if necessary
    public void subscribeMarket(String exchangeId, String contractId, String marketId, Callback callback) {
        String key = exchangeId + "_" + contractId + "_" + marketId;

        if (currentSubscription != null) {
            // Unsubscribe from the existing market
            MarketDepthSubscribe unsubscribeMsg = MarketDepthSubscribe.newBuilder()
                .setExchangeId(currentSubscription.getExchangeId())
                .setContractId(currentSubscription.getContractId())
                .setMarketId(currentSubscription.getMarketId())
                .setBuffer(DepthBuffer.DEPTH_BUFFER_NO_SUBSCRIPTION)
                .setDepthLevels(DepthLevels.DEPTH_LEVELS_UNDEFINED)
                .build();

            sendMessage(unsubscribeMsg, new Callback() {
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
            // No active subscription, proceed directly
            proceedWithSubscription(exchangeId, contractId, marketId, callback);
        }
    }

    // Continue with subscription
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

        sendMessage(subscribeMsg, new Callback() {
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

    // Simulate sending a message (replace with gRPC or socket logic)
    private void sendMessage(Object message, Callback callback) {
        try {
            // Placeholder for actual send logic
            logger.info("Sending message: " + message.toString());

            // Simulate a successful send
            callback.onComplete();
        } catch (Exception e) {
            callback.onError(e);
        }
    }

    // Basic callback interface
    public interface Callback {
        void onComplete();
        void onError(Exception e);
    }

    // Minimal subscription class
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