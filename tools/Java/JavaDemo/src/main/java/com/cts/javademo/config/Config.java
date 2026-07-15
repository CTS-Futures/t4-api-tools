package com.cts.javademo.config;

import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Runtime configuration, loaded from {@code config.json} — same shape as the
 * Rust/C++ demos' {@code config.sample.json}.
 */
public final class Config {

    public WsConfig websocket;

    public static final class WsConfig {
        /** WebSocket endpoint, e.g. {@code wss://wss-sim.t4login.com/v1}. */
        public String url;
        /** REST base URL, e.g. {@code https://api-sim.t4login.com}. */
        public String api;

        public String firm;
        public String username;
        public String password;

        @SerializedName("app_name")
        public String appName;
        @SerializedName("app_license")
        public String appLicense;

        /** Default market-data product (exchange + contract), e.g. {@code CME_Eq} / {@code ES}. */
        @SerializedName("md_exchange_id")
        public String mdExchangeId;
        @SerializedName("md_contract_id")
        public String mdContractId;

        /** Display price format (0=Decimal, 1=Real, 2=Clearing). */
        @SerializedName("priceFormat")
        public int priceFormat;
    }

    public static Config load(Path path) throws IOException {
        String text = Files.readString(path);
        Config cfg = new Gson().fromJson(text, Config.class);
        if (cfg == null || cfg.websocket == null) {
            throw new IOException("config.json is empty or missing the \"websocket\" object");
        }
        return cfg;
    }
}
