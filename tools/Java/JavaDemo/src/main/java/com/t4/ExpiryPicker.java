package com.t4;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.stage.*;
import org.json.*;

import java.net.URI;
import java.net.http.*;
import java.util.*;
<<<<<<< HEAD
<<<<<<< HEAD
import java.util.function.Consumer;
import javafx.geometry.Pos;
=======
//import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
>>>>>>> a3d168a (Expiry Piacker and fixing Account subscribe)
=======
import java.util.function.Consumer;
import javafx.geometry.Pos;
>>>>>>> f41aaf7 (Expriy working, submit orders working)

public class ExpiryPicker {

    private final Config config;
    private final String exchangeId;
    private final String contractId;

    private final Map<String, JSONArray> groupsCache = new HashMap<>();
    private final Map<String, JSONArray> marketsCache = new HashMap<>();
    private final Set<String> expandedGroups = new HashSet<>();
    private JSONObject selectedExpiry;
    //private CompletableFuture<JSONObject> selectionFuture;
    private Consumer<JSONObject> onExpirySelected;

    private Stage dialogStage;
    private VBox groupsList;
    private ProgressIndicator loadingIndicator;
    private Button selectButton;

    public ExpiryPicker(Config config, String exchangeId, String contractId) {
        this.config = config;
        this.exchangeId = exchangeId;
        this.contractId = contractId;
    }

    public void show(Consumer<JSONObject> onExpirySelected) {
        this.onExpirySelected = onExpirySelected;
        Platform.runLater(this::createDialog);
        loadGroups();
    }

<<<<<<< HEAD
<<<<<<< HEAD

    private void createDialog() {
    dialogStage = new Stage(StageStyle.UTILITY);
    dialogStage.initModality(Modality.APPLICATION_MODAL);
    dialogStage.setTitle("Select Expiry");

    VBox root = new VBox(10);
    root.setStyle("-fx-padding: 15; -fx-background-color: #f9f9f9;");
    
    Label header = new Label("Select Expiry");
    header.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");

    groupsList = new VBox(10);
    ScrollPane scrollPane = new ScrollPane(groupsList);
    scrollPane.setFitToWidth(true);
    scrollPane.setPrefHeight(400);
    scrollPane.setStyle("-fx-background: white; -fx-border-color: #ccc;");

    loadingIndicator = new ProgressIndicator();
    loadingIndicator.setVisible(false);

    selectButton = new Button("Select");
    selectButton.setDisable(true);
    selectButton.setDefaultButton(true);
    selectButton.setStyle("-fx-background-color: #007bff; -fx-text-fill: white;");

    selectButton.setOnAction(e -> {
        if (selectedExpiry != null) close(selectedExpiry);
    });

    Button cancelButton = new Button("Cancel");
    cancelButton.setCancelButton(true);
    cancelButton.setStyle("-fx-border-color: #007bff; -fx-text-fill: #007bff;");

    HBox footer = new HBox(10, cancelButton, selectButton);
    footer.setAlignment(Pos.CENTER_RIGHT);

    cancelButton.setOnAction(e -> close(null));

    root.getChildren().addAll(header, loadingIndicator, scrollPane, footer);

    Scene scene = new Scene(root, 420, 500);
    dialogStage.setScene(scene);
    dialogStage.show();
}
=======
=======

>>>>>>> f41aaf7 (Expriy working, submit orders working)
    private void createDialog() {
    dialogStage = new Stage(StageStyle.UTILITY);
    dialogStage.initModality(Modality.APPLICATION_MODAL);
    dialogStage.setTitle("Select Expiry");

    VBox root = new VBox(10);
    root.setStyle("-fx-padding: 15; -fx-background-color: #f9f9f9;");
    
    Label header = new Label("Select Expiry");
    header.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");

    groupsList = new VBox(10);
    ScrollPane scrollPane = new ScrollPane(groupsList);
    scrollPane.setFitToWidth(true);
    scrollPane.setPrefHeight(400);
    scrollPane.setStyle("-fx-background: white; -fx-border-color: #ccc;");

    loadingIndicator = new ProgressIndicator();
    loadingIndicator.setVisible(false);

    selectButton = new Button("Select");
    selectButton.setDisable(true);
    selectButton.setDefaultButton(true);
    selectButton.setStyle("-fx-background-color: #007bff; -fx-text-fill: white;");

    selectButton.setOnAction(e -> {
        if (selectedExpiry != null) close(selectedExpiry);
    });

    Button cancelButton = new Button("Cancel");
    cancelButton.setCancelButton(true);
    cancelButton.setStyle("-fx-border-color: #007bff; -fx-text-fill: #007bff;");

<<<<<<< HEAD
        Scene scene = new Scene(root, 400, 500);
        dialogStage.setScene(scene);
        dialogStage.show();
    }
>>>>>>> a3d168a (Expiry Piacker and fixing Account subscribe)
=======
    HBox footer = new HBox(10, cancelButton, selectButton);
    footer.setAlignment(Pos.CENTER_RIGHT);

    cancelButton.setOnAction(e -> close(null));

    root.getChildren().addAll(header, loadingIndicator, scrollPane, footer);

    Scene scene = new Scene(root, 420, 500);
    dialogStage.setScene(scene);
    dialogStage.show();
}
>>>>>>> f41aaf7 (Expriy working, submit orders working)

    private void loadGroups() {
        showLoading(true);
        String url = String.format("%s/markets/picker/groups?exchangeid=%s&contractid=%s",
                config.apiUrl, exchangeId, contractId);
        HttpRequest request = buildRequest(url);

        HttpClient.newHttpClient().sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenApply(HttpResponse::body)
                .thenAccept(body -> {
                    JSONArray groups = new JSONArray(body);
                    groupsCache.put("root", groups);
                    Platform.runLater(() -> renderGroups(groups));
                })
                .exceptionally(ex -> {
                    Platform.runLater(() -> groupsList.getChildren().setAll(new Label("Failed to load expiry groups")));
                    return null;
                })
                .whenComplete((r, t) -> Platform.runLater(() -> showLoading(false)));
    }

<<<<<<< HEAD
<<<<<<< HEAD


    private void renderGroups(JSONArray groups) {
    groupsList.getChildren().clear();

    for (int i = 0; i < groups.length(); i++) {
        JSONObject group = groups.getJSONObject(i);
        String strategyType = group.getString("strategyType");
        String expiryDate = group.optString("expiryDate", "");

        boolean isExpanded = expandedGroups.contains(strategyType);
        VBox groupBox = new VBox(5);
        groupBox.setStyle("-fx-padding: 5 0 0 0;");

        Label groupHeader = new Label((isExpanded ? "▼ " : "▶ ") + getStrategyTypeDisplayName(strategyType));
        groupHeader.setStyle("-fx-font-weight: bold; -fx-cursor: hand; -fx-padding: 5 0 5 0;");
        groupHeader.setOnMouseClicked(e -> {
            toggleGroup(group, groupBox);
        });

        groupBox.getChildren().add(groupHeader);

        if (isExpanded) {
            loadAndRenderMarkets(strategyType, expiryDate, groupBox);
        }

        groupsList.getChildren().add(groupBox);
    }
}


    private void toggleGroup(JSONObject group, VBox groupBox) {
    String strategyType = group.getString("strategyType");
    String expiryDate = group.optString("expiryDate", "");

    boolean wasExpanded = expandedGroups.contains(strategyType);
    expandedGroups.remove(strategyType);
    groupsList.getChildren().remove(groupBox);

    if (!wasExpanded) {
        expandedGroups.add(strategyType);
    }

    renderGroups(groupsCache.get("root"));
    }
=======
=======


>>>>>>> f41aaf7 (Expriy working, submit orders working)
    private void renderGroups(JSONArray groups) {
    groupsList.getChildren().clear();

    for (int i = 0; i < groups.length(); i++) {
        JSONObject group = groups.getJSONObject(i);
        String strategyType = group.getString("strategyType");
        String expiryDate = group.optString("expiryDate", "");

        boolean isExpanded = expandedGroups.contains(strategyType);
        VBox groupBox = new VBox(5);
        groupBox.setStyle("-fx-padding: 5 0 0 0;");

        Label groupHeader = new Label((isExpanded ? "▼ " : "▶ ") + getStrategyTypeDisplayName(strategyType));
        groupHeader.setStyle("-fx-font-weight: bold; -fx-cursor: hand; -fx-padding: 5 0 5 0;");
        groupHeader.setOnMouseClicked(e -> {
            toggleGroup(group, groupBox);
        });

        groupBox.getChildren().add(groupHeader);

        if (isExpanded) {
            loadAndRenderMarkets(strategyType, expiryDate, groupBox);
        }

        groupsList.getChildren().add(groupBox);
    }

<<<<<<< HEAD
>>>>>>> a3d168a (Expiry Piacker and fixing Account subscribe)
=======

    private void toggleGroup(JSONObject group, VBox groupBox) {
    String strategyType = group.getString("strategyType");
    String expiryDate = group.optString("expiryDate", "");

    boolean wasExpanded = expandedGroups.contains(strategyType);
    expandedGroups.remove(strategyType);
    groupsList.getChildren().remove(groupBox);

    if (!wasExpanded) {
        expandedGroups.add(strategyType);
    }

    renderGroups(groupsCache.get("root"));
    }
>>>>>>> f41aaf7 (Expriy working, submit orders working)
    private void loadAndRenderMarkets(String strategyType, String expiryDate, VBox parentBox) {
        String cacheKey = strategyType + "_" + (expiryDate.isEmpty() ? "none" : expiryDate);
        if (marketsCache.containsKey(cacheKey)) {
            renderMarkets(marketsCache.get(cacheKey), parentBox);
            return;
        }

        String url = String.format("%s/markets/picker?exchangeid=%s&contractid=%s&strategytype=%s%s",
                config.apiUrl, exchangeId, contractId, strategyType,
                (!"None".equals(strategyType) && !expiryDate.isEmpty()) ? "&expirydate=" + expiryDate : "");

        HttpRequest request = buildRequest(url);
        HttpClient.newHttpClient().sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenApply(HttpResponse::body)
                .thenAccept(body -> {
                    JSONArray markets = new JSONArray(body);
                    marketsCache.put(cacheKey, markets);
                    Platform.runLater(() -> renderMarkets(markets, parentBox));
                })
                .exceptionally(ex -> {
                    System.err.println("Failed to load markets: " + ex.getMessage());
                    return null;
                });
    }

    private void renderMarkets(JSONArray markets, VBox parentBox) {
        VBox marketsBox = new VBox(5);
        for (int i = 0; i < markets.length(); i++) {
            JSONObject market = markets.getJSONObject(i);
            String displayText = market.optString("marketID", "Unknown Market");

            Label label = new Label(displayText);
           label.setOnMouseClicked(e -> {
    selectedExpiry = new JSONObject()
            .put("exchangeId", exchangeId)
            .put("contractId", contractId)
            .put("marketId", market.get("marketID"))
            .put("expiryDate", market.opt("expiryDate"))
            .put("description", market.opt("description"));

    groupsList.lookupAll(".selected").forEach(node -> node.getStyleClass().remove("selected"));
    label.getStyleClass().add("selected");

    selectButton.setDisable(false);

    if (e.getClickCount() == 2) {
        close(selectedExpiry);
    }
});

            marketsBox.getChildren().add(label);
        }

        parentBox.getChildren().add(marketsBox);
    }

    private String getStrategyTypeDisplayName(String strategyType) {
        Map<String, String> map = Map.ofEntries(
            Map.entry("None", "Outright"),
            Map.entry("CalendarSpread", "Calendar Spread"),
            Map.entry("Butterfly", "Butterfly"),
            Map.entry("Vertical", "Vertical"),
            Map.entry("Condor", "Condor"),
            Map.entry("Diagonal", "Diagonal")
            // Add the rest as needed...
        );
        return map.getOrDefault(strategyType, strategyType);
    }

    private void close(JSONObject result) {
        if (dialogStage != null) {
            dialogStage.close();
            dialogStage = null;
        }
        if (onExpirySelected != null) {
            onExpirySelected.accept(result);
        }
    }

    private void showLoading(boolean show) {
        if (loadingIndicator != null) {
            loadingIndicator.setVisible(show);
        }
    }

    private HttpRequest buildRequest(String url) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json");

        if (config.apiKey != null && !config.apiKey.isEmpty()) {
            builder.header("Authorization", "APIKey " + config.apiKey);
        } else if (config.bearerToken != null && !config.bearerToken.isEmpty()) {
            builder.header("Authorization", "Bearer " + config.bearerToken);
        }

        return builder.GET().build();
    }

    // Configuration class
    public static class Config {
        public final String apiUrl;
        public final String apiKey;
        public final String bearerToken;

        public Config(String apiUrl, String apiKey, String bearerToken) {
            this.apiUrl = apiUrl;
            this.apiKey = apiKey;
            this.bearerToken = bearerToken;
        }
    }
}