package com.t4;
import com.t4.ConnectionUI;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.stage.Stage;

public class Main extends Application{
    @Override
    public void start(Stage primaryStage) {
        T4APIClientTest client = T4APIClientTest.getInstance();
        ConnectionUI connectionPane = new ConnectionUI(client);

        Scene scene = new Scene(connectionPane, 500, 200);
        primaryStage.setTitle("T4 API Client - Connection");
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);  //this must be in a top-level class
    }
}
