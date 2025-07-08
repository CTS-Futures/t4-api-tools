package com.t4.helpers;

import com.t4.helpers.MarketSubscriber;
import com.t4.helpers.Callback;

public class TestMarketSubscriber {
    public static void main(String[] args) {
        MarketSubscriber subscriber = new MarketSubscriber();

        subscriber.subscribeMarket("CME", "ES", "ESU25", new Callback() {
            @Override
            public void onComplete() {
                System.out.println("✅ Market subscription completed.");
            }

            @Override
            public void onError(Exception e) {
                System.err.println("❌ Subscription failed: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }
}