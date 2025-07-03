package com.t4;
import com.t4.ConnectionUI;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;
import com.t4.MarketDataPane;

public class Main extends Application{
    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();
        ConnectionUI connectionPane = new ConnectionUI(client);
        MarketDataPane marketPane = new MarketDataPane();

        T4APIClientTest.getInstance().setMarketDataP(marketPane);
        //Scene scene = new Scene(connectionPane, 500, 200);
        VBox root = new VBox(connectionPane, marketPane);
        Scene scene = new Scene(root, 500, 400);
        primaryStage.setTitle("T4 API Client - Connection");
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);  //this must be in a top-level class
    }
}
