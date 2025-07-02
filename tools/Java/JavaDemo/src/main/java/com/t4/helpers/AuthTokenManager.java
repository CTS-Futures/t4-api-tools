package com.t4.helpers;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;

public class AuthTokenManager {
    private String jwtToken;
    private long jwtExpiration; // Epoch time in milliseconds
    private CompletableFuture<String> pendingTokenRequest;

    // Simulates the async token request (replace with real API call)
    private CompletableFuture<String> requestNewToken() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                // Simulate network delay
                Thread.sleep(1000);
            } catch (InterruptedException ignored) {}
            // Simulate token and expiration
            this.jwtToken = "new.jwt.token";
            this.jwtExpiration = System.currentTimeMillis() + 60 * 60 * 1000; // 1 hour
            return jwtToken;
        });
    }

    public synchronized CompletableFuture<String> getAuthToken() {
        long now = System.currentTimeMillis();
        if (jwtToken != null && jwtExpiration > now + 30000) {
            return CompletableFuture.completedFuture(jwtToken);
        }

        if (pendingTokenRequest != null && !pendingTokenRequest.isDone()) {
            return pendingTokenRequest;
        }

        pendingTokenRequest = requestNewToken()
            .whenComplete((result, ex) -> {
                synchronized (this) {
                    pendingTokenRequest = null; // clear after completion
                }
            });

        return pendingTokenRequest;
    }

    // For testing
    public static void main(String[] args) throws ExecutionException, InterruptedException {
        AuthTokenManager manager = new AuthTokenManager();

        // First call triggers token generation
        System.out.println("Token 1: " + manager.getAuthToken().get());

        // Second call returns cached token
        System.out.println("Token 2: " + manager.getAuthToken().get());
    }
}