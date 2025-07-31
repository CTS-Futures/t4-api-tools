<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
/* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.scene.text.TextAlignment;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("(--)");
    private final Label bidLabel = new Label("Best Bid\n--");
    private final Label askLabel = new Label("Best Offer\n--");
    private final Label lastLabel = new Label("Last Trade\n--");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;
    private Runnable onOpenExpiryPicker = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(12));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6; -fx-background-radius: 6;");
        setAlignment(Pos.TOP_LEFT);

        // === Title Section ===
        Label titleLabel = new Label("Market Data - ");
        titleLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));

        symbolLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));
        symbolLabel.setTextFill(Color.BLACK); // BLACK symbol

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label calendarIcon = new Label("\uD83D\uDCC5");
        calendarIcon.setStyle("-fx-cursor: hand; -fx-font-size: 18px; -fx-text-fill: #007bff;");
        calendarIcon.setOnMouseClicked(e -> {
            if (onOpenExpiryPicker != null) onOpenExpiryPicker.run();
        });

        HBox titleBar = new HBox(titleLabel, symbolLabel, spacer, calendarIcon);
        titleBar.setAlignment(Pos.CENTER_LEFT);

        // === Select Market Button ===
        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) onSelectMarket.run();
        });

        // === Quote Grid ===
        GridPane quoteGrid = new GridPane();
        quoteGrid.setHgap(10);
        quoteGrid.setVgap(5);
        quoteGrid.setPadding(new Insets(10, 0, 0, 0));
        quoteGrid.setAlignment(Pos.CENTER_LEFT);

        setupQuoteBox(bidLabel, "#007bff", 13);   // Blue
        setupQuoteBox(askLabel, "#dc3545", 13);   // Red
        setupQuoteBox(lastLabel, "#28a745", 13);  // Green

        quoteGrid.add(bidLabel, 0, 0);
        quoteGrid.add(askLabel, 1, 0);
        quoteGrid.add(lastLabel, 2, 0);

        getChildren().addAll(titleBar, selectMarketButton, quoteGrid);
    }

    private void setupQuoteBox(Label label, String colorHex, int fontSize) {
        label.setStyle("-fx-border-color: #ccc; -fx-border-radius: 6; -fx-background-radius: 6;" +
                "-fx-background-color: white; -fx-padding: 8 12 8 12; -fx-font-size: " + fontSize + ";" +
                "-fx-text-fill: " + colorHex + ";");
        label.setMinWidth(110);
        label.setMaxWidth(110);
        label.setWrapText(true);
        label.setTextAlignment(TextAlignment.CENTER);
        label.setAlignment(Pos.CENTER);
    }

    public void setOnOpenExpiryPicker(Runnable onOpen) {
        this.onOpenExpiryPicker = onOpen;
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("(" + symbol + ")"));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Best Bid\n" + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Best Offer\n" + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last Trade\n" + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
} */


=======
>>>>>>> e7263a4 (Started on Market pane)
package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
<<<<<<< HEAD
<<<<<<< HEAD
=======
/* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
>>>>>>> 5b236e0 (Working on UI)
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.scene.text.TextAlignment;

import java.util.HashMap;
import java.util.Map;

public class MarketDataPane extends VBox {

    private final Label marketNameLabel = new Label("(--)");
    private final Label bidLabel = new Label("Best Bid\n--");
    private final Label askLabel = new Label("Best Offer\n--");
    private final Label lastLabel = new Label("Last Trade\n--");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;
    private Runnable onOpenExpiryPicker = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(12));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6; -fx-background-radius: 6;");
        setAlignment(Pos.TOP_LEFT);

        // === Title Section ===
        Label titleLabel = new Label("Market Data - ");
        titleLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));

        marketNameLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));
        marketNameLabel.setTextFill(Color.BLACK); // BLACK symbol

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label calendarIcon = new Label("\uD83D\uDCC5");
        calendarIcon.setStyle("-fx-cursor: hand; -fx-font-size: 18px; -fx-text-fill: #007bff;");
        calendarIcon.setOnMouseClicked(e -> {
            if (onOpenExpiryPicker != null) onOpenExpiryPicker.run();
        });

        HBox titleBar = new HBox(titleLabel, marketNameLabel, spacer, calendarIcon);
        titleBar.setAlignment(Pos.CENTER_LEFT);

        // === Select Market Button ===
        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) onSelectMarket.run();
        });

        // === Quote Grid ===
        GridPane quoteGrid = new GridPane();
        quoteGrid.setHgap(10);
        quoteGrid.setVgap(5);
        quoteGrid.setPadding(new Insets(10, 0, 0, 0));
        quoteGrid.setAlignment(Pos.CENTER_LEFT);

        setupQuoteBox(bidLabel, "#007bff", 13);   // Blue
        setupQuoteBox(askLabel, "#dc3545", 13);   // Red
        setupQuoteBox(lastLabel, "#28a745", 13);  // Green

        quoteGrid.add(bidLabel, 0, 0);
        quoteGrid.add(askLabel, 1, 0);
        quoteGrid.add(lastLabel, 2, 0);

        getChildren().addAll(titleBar, selectMarketButton, quoteGrid);
    }

    private void setupQuoteBox(Label label, String colorHex, int fontSize) {
        label.setStyle("-fx-border-color: #ccc; -fx-border-radius: 6; -fx-background-radius: 6;" +
                "-fx-background-color: white; -fx-padding: 8 12 8 12; -fx-font-size: " + fontSize + ";" +
                "-fx-text-fill: " + colorHex + ";");
        label.setMinWidth(110);
        label.setMaxWidth(110);
        label.setWrapText(true);
        label.setTextAlignment(TextAlignment.CENTER);
        label.setAlignment(Pos.CENTER);
    }

    public void setOnOpenExpiryPicker(Runnable onOpen) {
        this.onOpenExpiryPicker = onOpen;
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void setMarketName(String contractId, int expiryDate) {
        String formatted = formatMarketName(contractId, expiryDate);
        Platform.runLater(() -> marketNameLabel.setText(formatted));
    }

    private String formatMarketName(String contractId, int expiryDate) {
        String expiryStr = String.valueOf(expiryDate);
        if (expiryStr.length() < 6) return "--";

        String year = expiryStr.substring(2, 4);
        String month = expiryStr.substring(4, 6);

        Map<String, String> monthCodes = new HashMap<>();
        monthCodes.put("01", "F"); monthCodes.put("02", "G"); monthCodes.put("03", "H");
        monthCodes.put("04", "J"); monthCodes.put("05", "K"); monthCodes.put("06", "M");
        monthCodes.put("07", "N"); monthCodes.put("08", "Q"); monthCodes.put("09", "U");
        monthCodes.put("10", "V"); monthCodes.put("11", "X"); monthCodes.put("12", "Z");

        String monthCode = monthCodes.getOrDefault(month, month);
        return contractId + monthCode + year;
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Best Bid\n" + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Best Offer\n" + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last Trade\n" + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
=======
import javafx.scene.control.Label;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.VBox;
=======
import javafx.scene.control.*;
import javafx.scene.layout.*;
>>>>>>> 8d45f4c (Starting the market drop down)
import javafx.scene.text.Font;

import java.util.Map;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");

    private final ComboBox<String> marketDropdown = new ComboBox<>();
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
            marketDropdown.show();
        });

        marketDropdown.setMaxWidth(Double.MAX_VALUE);

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleLabel, selectMarketButton, marketDropdown, grid);
        VBox.setVgrow(this, Priority.ALWAYS);
        setMaxWidth(Double.MAX_VALUE);
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("Symbol: " + symbol));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Bid: " + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Ask: " + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last: " + last));
    }
<<<<<<< HEAD
    
}
>>>>>>> e7263a4 (Started on Market pane)
=======

<<<<<<< HEAD
    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }
<<<<<<< HEAD
}
>>>>>>> 8d45f4c (Starting the market drop down)
=======

    // Called by controller/client to populate the market list
public void populateMarkets(Map<String, String> labelToMarketId, MarketSelectionHandler handler) {
    Platform.runLater(() -> {
        marketDropdown.getItems().clear();
        marketDropdown.getItems().addAll(labelToMarketId.keySet());

        marketDropdown.setOnAction(e -> {
            String label = marketDropdown.getValue();
            if (label != null && labelToMarketId.containsKey(label)) {
                String marketId = labelToMarketId.get(label);
                handler.onMarketSelected(marketId);
            }
        });
    });
}

=======
>>>>>>> 5b236e0 (Working on UI)
    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }

    public void populateMarkets(Map<String, String> labelToMarketId, MarketSelectionHandler handler) {
        Platform.runLater(() -> {
            marketDropdown.getItems().clear();
            marketDropdown.getItems().addAll(labelToMarketId.keySet());

            marketDropdown.setOnAction(e -> {
                String label = marketDropdown.getValue();
                if (label != null && labelToMarketId.containsKey(label)) {
                    String marketId = labelToMarketId.get(label);
                    handler.onMarketSelected(marketId);
                }
            });
        });
    }

    public interface MarketSelectionHandler {
        void onMarketSelected(String marketId);
    }
} */

/* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
        });

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleLabel, selectMarketButton, grid);
        VBox.setVgrow(this, Priority.ALWAYS);
        setMaxWidth(Double.MAX_VALUE);
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("Symbol: " + symbol));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Bid: " + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Ask: " + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last: " + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
<<<<<<< HEAD
<<<<<<< HEAD


}
>>>>>>> 04527d8 (Contract selector revisons)
=======
>>>>>>> 5b236e0 (Working on UI)
=======
 */
=======

>>>>>>> f41aaf7 (Expriy working, submit orders working)

 /* package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.text.Font;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("Symbol: --");
    private final Label bidLabel = new Label("Bid: --");
    private final Label askLabel = new Label("Ask: --");
    private final Label lastLabel = new Label("Last: --");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;
    private Runnable onOpenExpiryPicker = null;


    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(15));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6px; -fx-background-radius: 6px;");
        setAlignment(Pos.TOP_LEFT);
        setFillWidth(true);

        Label titleLabel = new Label("Market Data");
        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        //New Icon for Expiry Picker
        Label calendarIcon = new Label("\uD83D\uDCC5"); // 📅 emoji
        calendarIcon.setStyle(
            "-fx-cursor: hand; -fx-font-size: 18px; -fx-text-fill: #007bff; " +
            "-fx-padding: 2 6 2 6; -fx-border-radius: 4; -fx-border-color: transparent;"
        );

        HBox titleBar = new HBox(titleLabel, spacer, calendarIcon);
        titleBar.setAlignment(Pos.CENTER_LEFT);
        titleLabel.setFont(Font.font("Arial", 16));
        titleLabel.setStyle("-fx-font-weight: bold;");

        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) {
                onSelectMarket.run();
            }
        });


        // Placeholder for action
        calendarIcon.setOnMouseClicked(e -> {
        if (onOpenExpiryPicker != null) onOpenExpiryPicker.run();
        });

        GridPane grid = new GridPane();
        grid.setHgap(20);
        grid.setVgap(10);
        grid.setPadding(new Insets(10, 0, 0, 0));

        grid.add(symbolLabel, 0, 0);
        grid.add(bidLabel, 0, 1);
        grid.add(askLabel, 1, 1);
        grid.add(lastLabel, 0, 2);

        getChildren().addAll(titleBar, selectMarketButton, grid);

        setMaxWidth(Double.MAX_VALUE);
        setPrefWidth(Region.USE_COMPUTED_SIZE);
        HBox.setHgrow(this, Priority.ALWAYS);
    }

    
    public void setOnOpenExpiryPicker(Runnable onOpen) {
        this.onOpenExpiryPicker = onOpen;
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("Symbol: " + symbol));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Bid: " + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Ask: " + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last: " + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
<<<<<<< HEAD
>>>>>>> 3fa8ae3 (Correct Ui)
=======
 */

 package com.t4;
=======
/* package com.t4;
>>>>>>> b4682bd (Comitting to access changes)

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.scene.text.TextAlignment;

public class MarketDataPane extends VBox {

    private final Label symbolLabel = new Label("(--)");
    private final Label bidLabel = new Label("Best Bid\n--");
    private final Label askLabel = new Label("Best Offer\n--");
    private final Label lastLabel = new Label("Last Trade\n--");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;
    private Runnable onOpenExpiryPicker = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(12));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6; -fx-background-radius: 6;");
        setAlignment(Pos.TOP_LEFT);

        // === Title Section ===
        Label titleLabel = new Label("Market Data - ");
        titleLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));

        symbolLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));
        symbolLabel.setTextFill(Color.BLACK); // BLACK symbol

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label calendarIcon = new Label("\uD83D\uDCC5");
        calendarIcon.setStyle("-fx-cursor: hand; -fx-font-size: 18px; -fx-text-fill: #007bff;");
        calendarIcon.setOnMouseClicked(e -> {
            if (onOpenExpiryPicker != null) onOpenExpiryPicker.run();
        });

        HBox titleBar = new HBox(titleLabel, symbolLabel, spacer, calendarIcon);
        titleBar.setAlignment(Pos.CENTER_LEFT);

        // === Select Market Button ===
        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) onSelectMarket.run();
        });

        // === Quote Grid ===
        GridPane quoteGrid = new GridPane();
        quoteGrid.setHgap(10);
        quoteGrid.setVgap(5);
        quoteGrid.setPadding(new Insets(10, 0, 0, 0));
        quoteGrid.setAlignment(Pos.CENTER_LEFT);

        setupQuoteBox(bidLabel, "#007bff", 13);   // Blue
        setupQuoteBox(askLabel, "#dc3545", 13);   // Red
        setupQuoteBox(lastLabel, "#28a745", 13);  // Green

        quoteGrid.add(bidLabel, 0, 0);
        quoteGrid.add(askLabel, 1, 0);
        quoteGrid.add(lastLabel, 2, 0);

        getChildren().addAll(titleBar, selectMarketButton, quoteGrid);
    }

    private void setupQuoteBox(Label label, String colorHex, int fontSize) {
        label.setStyle("-fx-border-color: #ccc; -fx-border-radius: 6; -fx-background-radius: 6;" +
                "-fx-background-color: white; -fx-padding: 8 12 8 12; -fx-font-size: " + fontSize + ";" +
                "-fx-text-fill: " + colorHex + ";");
        label.setMinWidth(110);
        label.setMaxWidth(110);
        label.setWrapText(true);
        label.setTextAlignment(TextAlignment.CENTER);
        label.setAlignment(Pos.CENTER);
    }

    public void setOnOpenExpiryPicker(Runnable onOpen) {
        this.onOpenExpiryPicker = onOpen;
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void updateSymbol(String symbol) {
        Platform.runLater(() -> symbolLabel.setText("(" + symbol + ")"));
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Best Bid\n" + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Best Offer\n" + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last Trade\n" + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
<<<<<<< HEAD
}
>>>>>>> 0e4f995 (Before changes to main to change naming conventions)
=======
} */


package com.t4;

import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.scene.text.TextAlignment;

import java.util.HashMap;
import java.util.Map;

public class MarketDataPane extends VBox {

    private final Label marketNameLabel = new Label("(--)");
    private final Label bidLabel = new Label("Best Bid\n--");
    private final Label askLabel = new Label("Best Offer\n--");
    private final Label lastLabel = new Label("Last Trade\n--");
    private final Button selectMarketButton = new Button("Select Market");

    private Runnable onSelectMarket = null;
    private Runnable onOpenExpiryPicker = null;

    public MarketDataPane() {
        setSpacing(10);
        setPadding(new Insets(12));
        setStyle("-fx-background-color: white; -fx-border-color: #cccccc; -fx-border-radius: 6; -fx-background-radius: 6;");
        setAlignment(Pos.TOP_LEFT);

        // === Title Section ===
        Label titleLabel = new Label("Market Data - ");
        titleLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));

        marketNameLabel.setFont(Font.font("Arial", FontWeight.BOLD, 18));
        marketNameLabel.setTextFill(Color.BLACK); // BLACK symbol

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Label calendarIcon = new Label("\uD83D\uDCC5");
        calendarIcon.setStyle("-fx-cursor: hand; -fx-font-size: 18px; -fx-text-fill: #007bff;");
        calendarIcon.setOnMouseClicked(e -> {
            if (onOpenExpiryPicker != null) onOpenExpiryPicker.run();
        });

        HBox titleBar = new HBox(titleLabel, marketNameLabel, spacer, calendarIcon);
        titleBar.setAlignment(Pos.CENTER_LEFT);

        // === Select Market Button ===
        selectMarketButton.setOnAction(e -> {
            if (onSelectMarket != null) onSelectMarket.run();
        });

        // === Quote Grid ===
        GridPane quoteGrid = new GridPane();
        quoteGrid.setHgap(10);
        quoteGrid.setVgap(5);
        quoteGrid.setPadding(new Insets(10, 0, 0, 0));
        quoteGrid.setAlignment(Pos.CENTER_LEFT);

        setupQuoteBox(bidLabel, "#007bff", 13);   // Blue
        setupQuoteBox(askLabel, "#dc3545", 13);   // Red
        setupQuoteBox(lastLabel, "#28a745", 13);  // Green

        quoteGrid.add(bidLabel, 0, 0);
        quoteGrid.add(askLabel, 1, 0);
        quoteGrid.add(lastLabel, 2, 0);

        getChildren().addAll(titleBar, selectMarketButton, quoteGrid);
    }

    private void setupQuoteBox(Label label, String colorHex, int fontSize) {
        label.setStyle("-fx-border-color: #ccc; -fx-border-radius: 6; -fx-background-radius: 6;" +
                "-fx-background-color: white; -fx-padding: 8 12 8 12; -fx-font-size: " + fontSize + ";" +
                "-fx-text-fill: " + colorHex + ";");
        label.setMinWidth(110);
        label.setMaxWidth(110);
        label.setWrapText(true);
        label.setTextAlignment(TextAlignment.CENTER);
        label.setAlignment(Pos.CENTER);
    }

    public void setOnOpenExpiryPicker(Runnable onOpen) {
        this.onOpenExpiryPicker = onOpen;
    }

    public void setOnSelectMarket(Runnable onSelect) {
        this.onSelectMarket = onSelect;
    }

    public void setMarketName(String contractId, int expiryDate) {
        String formatted = formatMarketName(contractId, expiryDate);
        Platform.runLater(() -> marketNameLabel.setText(formatted));
    }

    private String formatMarketName(String contractId, int expiryDate) {
        String expiryStr = String.valueOf(expiryDate);
        if (expiryStr.length() < 6) return "--";

        String year = expiryStr.substring(2, 4);
        String month = expiryStr.substring(4, 6);

        Map<String, String> monthCodes = new HashMap<>();
        monthCodes.put("01", "F"); monthCodes.put("02", "G"); monthCodes.put("03", "H");
        monthCodes.put("04", "J"); monthCodes.put("05", "K"); monthCodes.put("06", "M");
        monthCodes.put("07", "N"); monthCodes.put("08", "Q"); monthCodes.put("09", "U");
        monthCodes.put("10", "V"); monthCodes.put("11", "X"); monthCodes.put("12", "Z");

        String monthCode = monthCodes.getOrDefault(month, month);
        return contractId + monthCode + year;
    }

    public void updateBid(String bid) {
        Platform.runLater(() -> bidLabel.setText("Best Bid\n" + bid));
    }

    public void updateAsk(String ask) {
        Platform.runLater(() -> askLabel.setText("Best Offer\n" + ask));
    }

    public void updateLast(String last) {
        Platform.runLater(() -> lastLabel.setText("Last Trade\n" + last));
    }

    public void enableSelectMarket(boolean enable) {
        Platform.runLater(() -> selectMarketButton.setDisable(!enable));
    }
}
>>>>>>> b4682bd (Comitting to access changes)
