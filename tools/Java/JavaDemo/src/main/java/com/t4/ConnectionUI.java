package com.t4;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;
import javafx.scene.text.Font;
import com.t4.T4APIClientTest;
import com.t4.T4Config;

public class ConnectionUI extends VBox{
    

     private final ComboBox<String> accountComboBox = new ComboBox<>();
    private final Button connectButton = new Button("Connect");
    private final Button disconnectButton = new Button("Disconnect");
    private final Label statusLabel = new Label("Disconnected");
    private final Circle statusIndicator = new Circle(6, Color.RED);

    private final T4APIClientTest client;

    public ConnectionUI(T4APIClientTest client) {
        this.client = client;

        Label titleLabel = new Label("Connection & Account");
        titleLabel.setFont(new Font("Arial", 18));

        HBox statusBox = new HBox(10, statusIndicator, statusLabel);
        HBox connectionControls = new HBox(10, new Label("Account:"), accountComboBox, connectButton, disconnectButton);

        this.setSpacing(10);
        this.setPadding(new Insets(15));
        this.getChildren().addAll(titleLabel, statusBox, connectionControls);
        this.setStyle("-fx-border-color: lightgray; -fx-border-radius: 5; -fx-background-color: #f9f9f9;");

        initListeners();

        // Load account from config (default single account setup)
        loadAccounts(new String[]{T4Config.USERNAME});
        accountComboBox.getSelectionModel().selectFirst();
    }

    private void initListeners() {
        connectButton.setOnAction(event -> {
            String account = accountComboBox.getValue();
            if (account != null) {
                new Thread(() -> {
                    boolean success = client.connect(()-> {
                        Platform.runLater(() -> setStatus(true));
                        System.out.println("Connected.");
                    });
                    Platform.runLater(() -> setStatus(success));
                }).start();
            }
        });

        disconnectButton.setOnAction(event -> {
            client.disconnect();
            setStatus(false);
        });
    }

    public void setStatus(boolean connected) {
        statusIndicator.setFill(connected ? Color.LIMEGREEN : Color.RED);
        statusLabel.setText(connected ? "Connected" : "Disconnected");
    }

    public void loadAccounts(String[] accounts) {
        Platform.runLater(() -> {
            accountComboBox.getItems().clear();
            accountComboBox.getItems().addAll(accounts);
        });
    }

    public void setOnConnect(Runnable handler) {
        connectButton.setOnAction(e -> handler.run());
    }
}
