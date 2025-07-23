#include "ExpiryPickerDialog.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>

ExpiryPickerDialog::ExpiryPickerDialog(Client* client, QWidget* parent)
    : QDialog(parent), nestedClient(client) {
    setWindowTitle("Select Expiry");
    setMinimumSize(400, 300);

    QVBoxLayout* mainLayout = new QVBoxLayout(this);

    tree = new QTreeWidget();
    tree->setHeaderHidden(true);
    mainLayout->addWidget(tree);

    // Outright and Calendar Spread root items
    QTreeWidgetItem* outrightItem = new QTreeWidgetItem(tree);
    outrightItem->setText(0, "Outright");

    QTreeWidgetItem* spreadItem = new QTreeWidgetItem(tree);
    spreadItem->setText(0, "Calendar Spread");

    // Dummy example children for now
    new QTreeWidgetItem(outrightItem, QStringList() << "2025-SEP");
    new QTreeWidgetItem(outrightItem, QStringList() << "2025-DEC");

    new QTreeWidgetItem(spreadItem, QStringList() << "SEP-DEC");
    new QTreeWidgetItem(spreadItem, QStringList() << "DEC-MAR");

    outrightItem->setExpanded(false);
    spreadItem->setExpanded(false);

    // Buttons
    QHBoxLayout* buttonLayout = new QHBoxLayout();
    cancelBtn = new QPushButton("Cancel");
    selectBtn = new QPushButton("Select");
    selectBtn->setEnabled(false);

    buttonLayout->addStretch();
    buttonLayout->addWidget(cancelBtn);
    buttonLayout->addWidget(selectBtn);
    mainLayout->addLayout(buttonLayout);

    connect(tree, &QTreeWidget::itemSelectionChanged, this, [this]() {
        QTreeWidgetItem* item = tree->currentItem();
        bool isLeaf = item && item->childCount() == 0;
        selectBtn->setEnabled(isLeaf);
        });

    connect(selectBtn, &QPushButton::clicked, this, &ExpiryPickerDialog::handleSelection);
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
}

void ExpiryPickerDialog::handleSelection() {
    QTreeWidgetItem* item = tree->currentItem();
    if (!item || item->childCount() > 0)
        return;

    QString label = item->text(0);
    selectedMeta["label"] = label;
    emit expirySelected(label);
    accept();
}

QVariantMap ExpiryPickerDialog::selectedExpiryMeta() const {
    return selectedMeta;
}
