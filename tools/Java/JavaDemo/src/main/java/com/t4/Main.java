package com.t4;
import com.t4.ConnectionUI;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.control.SplitPane;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import com.t4.MarketDataPane;

public class Main extends Application{
    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();

        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();

        client.setMarketDataP(marketPane);

        // Set preferred size
        connectionPane.setPrefHeight(100);     // smaller pane
        marketPane.setPrefHeight(300);         // larger pane

        VBox root = new VBox(connectionPane, marketPane);
        VBox.setVgrow(marketPane, Priority.ALWAYS); // Allow market pane to expand

        Scene scene = new Scene(root, 600, 400);
        primaryStage.setTitle("T4 API Client");
        primaryStage.setScene(scene);
        primaryStage.show();


        
    }

    public static void main(String[] args) {
        launch(args);  //this must be in a top-level class
    }
}
