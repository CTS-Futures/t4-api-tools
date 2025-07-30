#pragma once
#ifndef CONTRACTPICKERDIALOG_H
#define CONTRACTPICKERDIALOG_H
#include <QDialog>
#include <QTreeWidget>
#include <QLineEdit>
#include <QPushButton>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonValue>
#include "Client.h"  // make sure this is included
class ContractPickerDialog : public QDialog {
    Q_OBJECT
public:
    explicit ContractPickerDialog(Client* client, const QVector<QJsonObject>& exchanges, QWidget* parent = nullptr);

signals:
    void contractSelected(const QString& contractId);

private slots:
    void filterContracts(const QString& text);
    void onItemDoubleClicked(QTreeWidgetItem* item, int column);
    void onItemExpanded(QTreeWidgetItem* item);
    void handleSelection();
private:
    Client* nestedClient;
    QLineEdit* searchEdit;
    QTreeWidget* tree;
    QPushButton* selectBtn;
    QPushButton* cancelBtn;
};
#endif // CONTRACTPICKERDIALOG_H