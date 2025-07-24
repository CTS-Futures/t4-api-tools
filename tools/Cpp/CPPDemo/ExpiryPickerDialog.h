#pragma once

#include <QDialog>
#include <QTreeWidget>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>
#include <QFrame>
#include "Client.h"

class ExpiryPickerDialog : public QDialog {
    Q_OBJECT

public:
    explicit ExpiryPickerDialog(QWidget* parent = nullptr, Client* client = nullptr, std::function<void(QString)> onSelect = nullptr);
    void loadAndRenderMarkets(QTreeWidgetItem* item, QString strategy, QString expiry);
    QJsonObject selectedExpiry;
signals:
    void expirySelected(const QString& expiry);
private slots:
    void onItemExpanded(QTreeWidgetItem* item);
    void onItemSelected();
    void onConfirmSelection();
    void loadAndRenderGroups();

private:
    void buildUI();

    Client* client;
  
    std::function<void(QString)> onSelectCallback;

    QString exchangeId;
    QString contractId;
 

    QTreeWidget* treeWidget;
    QPushButton* selectButton;
};
