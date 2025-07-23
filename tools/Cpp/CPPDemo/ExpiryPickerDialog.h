#ifndef EXPIRYPICKERDIALOG_H
#define EXPIRYPICKERDIALOG_H

#include <QDialog>
#include <QTreeWidget>
#include <QPushButton>
#include "Client.h"

class ExpiryPickerDialog : public QDialog {
    Q_OBJECT

public:
    explicit ExpiryPickerDialog(Client* client, QWidget* parent = nullptr);
    QVariantMap selectedExpiryMeta() const;

signals:
    void expirySelected(const QString& label);

private slots:
    void handleSelection();

private:
    Client* nestedClient;
    QTreeWidget* tree;
    QPushButton* cancelBtn;
    QPushButton* selectBtn;
    QVariantMap selectedMeta;  // Stores exchangeId, expiryID, etc.
};

#endif // EXPIRYPICKERDIALOG_H
