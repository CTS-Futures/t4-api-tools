package com.t4;

import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.layout.VBox;
import javafx.stage.Modality;
import javafx.stage.Stage;
//import t4proto.v1.market.Market.MarketDefinition;

import java.util.List;
import java.util.function.Consumer;

public class ContractSelectorDialog {
   /*  private final Stage dialogStage;
    private final ComboBox<MarketDefinition> comboBox;
    private Consumer<MarketDefinition> onMarketSelected;

    public ContractSelectorDialog(List<MarketDefinition> marketList) {
        dialogStage = new Stage();
        dialogStage.initModality(Modality.APPLICATION_MODAL);
        dialogStage.setTitle("Select a Market");

        comboBox = new ComboBox<>();
        comboBox.getItems().addAll(marketList);
        comboBox.setPrefWidth(300);
        comboBox.setCellFactory(param -> new javafx.scene.control.ListCell<>() {
            @Override
            protected void updateItem(MarketDefinition item, boolean empty) {
                super.updateItem(item, empty);
                if (empty || item == null) {
                    setText(null);
                } else {
                    setText(item.getContractSymbol());
                }
            }
        });
        comboBox.setButtonCell(comboBox.getCellFactory().call(null));

        Button selectButton = new Button("Select");
        selectButton.setOnAction(e -> {
            MarketDefinition selected = comboBox.getSelectionModel().getSelectedItem();
            if (selected != null && onMarketSelected != null) {
                onMarketSelected.accept(selected);
            }
            dialogStage.close();
        });

        VBox layout = new VBox(10);
        layout.setPadding(new Insets(15));
        layout.getChildren().addAll(comboBox, selectButton);

        Scene scene = new Scene(layout);
        dialogStage.setScene(scene);
    }

    public void setOnMarketSelected(Consumer<MarketDefinition> callback) {
        this.onMarketSelected = callback;
    }

    public void show() {
        dialogStage.showAndWait();
    } */
}
