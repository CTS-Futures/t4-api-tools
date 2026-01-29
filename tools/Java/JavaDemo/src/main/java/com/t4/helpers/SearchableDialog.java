package com.t4.helpers;

import javafx.application.Platform;
import javafx.collections.FXCollections;
import javafx.collections.transformation.FilteredList;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.stage.Modality;
import javafx.stage.Stage;

import java.util.List;
import java.util.Optional;
import java.util.function.Function;

import com.t4.*;

public class SearchableDialog<T> {

    private final Stage dialogStage;
    private final ListView<T> listView;
    private final TextField searchField;
    private final FilteredList<T> filteredItems;
    private T selectedItem;

    public SearchableDialog(String title, String header, List<T> items, Function<T, String> itemToString) {
        dialogStage = new Stage();
        dialogStage.initModality(Modality.APPLICATION_MODAL);
        dialogStage.setTitle(title);

        VBox root = new VBox(10);
        root.setStyle("-fx-padding: 15;");

        Label headerLabel = new Label(header);
        headerLabel.setStyle("-fx-font-size: 14px; -fx-font-weight: bold;");

        searchField = new TextField();
        searchField.setPromptText("Search...");

        listView = new ListView<>();
        filteredItems = new FilteredList<>(FXCollections.observableArrayList(items), p -> true);
        listView.setItems(filteredItems);

        searchField.textProperty().addListener((obs, oldVal, newVal) -> {
            filteredItems.setPredicate(item -> itemToString.apply(item).toLowerCase().contains(newVal.toLowerCase()));
        });

        Button selectButton = new Button("Select");
        selectButton.setOnAction(e -> {
            selectedItem = listView.getSelectionModel().getSelectedItem();
            dialogStage.close();
        });

        Button cancelButton = new Button("Cancel");
        cancelButton.setOnAction(e -> dialogStage.close());

        HBox buttons = new HBox(10, cancelButton, selectButton);
        buttons.setStyle("-fx-alignment: center-right;");

        root.getChildren().addAll(headerLabel, searchField, listView, buttons);

        Scene scene = new Scene(root, 400, 500);
        dialogStage.setScene(scene);
    }

    public Optional<T> showAndWait() {
        dialogStage.showAndWait();
        return Optional.ofNullable(selectedItem);
    }
}
