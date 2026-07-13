package com.cts.javademo;

import com.cts.javademo.config.Config;
import com.cts.javademo.net.RestClient;
import com.cts.javademo.net.T4Client;
import com.cts.javademo.state.AppState;
import com.cts.javademo.ui.MainWindow;
import com.formdev.flatlaf.FlatDarkLaf;

import javax.swing.JOptionPane;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Entry point: load {@code config.json}, bring up the Swing window, and start the
 * WebSocket session.
 */
public final class Main {

    public static void main(String[] args) {
        Path configPath = Path.of(args.length > 0 ? args[0] : "config.json");
        if (!Files.exists(configPath)) {
            fail("Config not found: " + configPath.toAbsolutePath()
                    + "\n\nCopy config.sample.json to config.json and fill in your T4 sim credentials.");
            return;
        }

        Config cfg;
        try {
            cfg = Config.load(configPath);
        } catch (Exception e) {
            fail("Failed to read " + configPath + ":\n" + e.getMessage());
            return;
        }

        // Modern dark theme (FlatLaf). The in-app toolbar toggle can switch to light at runtime.
        FlatDarkLaf.setup();

        AppState state = new AppState();
        RestClient rest = new RestClient(cfg.websocket.api);
        T4Client client = new T4Client(cfg.websocket, state, rest);

        MainWindow window = new MainWindow(state, client);
        window.show();

        Runtime.getRuntime().addShutdownHook(new Thread(client::shutdown));
        client.start();
    }

    private static void fail(String message) {
        System.err.println(message);
        try {
            JOptionPane.showMessageDialog(null, message, "T4 Java Demo", JOptionPane.ERROR_MESSAGE);
        } catch (Throwable ignored) {
            // headless — stderr already has it
        }
    }

    private Main() {
    }
}
