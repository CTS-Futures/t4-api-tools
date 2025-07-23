#include "ContractPickerDialog.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>

ContractPickerDialog::ContractPickerDialog(Client* client, const QVector<QJsonObject>& exchanges, QWidget* parent)
    : QDialog(parent), nestedClient(client) {
    setWindowTitle("Select a Contract");
    setMinimumSize(400, 500);

    QVBoxLayout* mainLayout = new QVBoxLayout(this);

    searchEdit = new QLineEdit();
    searchEdit->setPlaceholderText("Search contracts...");
    mainLayout->addWidget(searchEdit);

    tree = new QTreeWidget();
    tree->setHeaderHidden(true);
    tree->setSelectionMode(QAbstractItemView::SingleSelection);
    mainLayout->addWidget(tree);

    // Buttons
    QHBoxLayout* buttonLayout = new QHBoxLayout();
    cancelBtn = new QPushButton("Cancel");
    selectBtn = new QPushButton("Select");
    selectBtn->setEnabled(false); // until selection is made

    buttonLayout->addStretch();
    buttonLayout->addWidget(cancelBtn);
    buttonLayout->addWidget(selectBtn);
    mainLayout->addLayout(buttonLayout);

    // Sample data

    for (const QJsonObject& obj : exchanges) {
        QString description = obj["description"].toString();
        QString exchangeId = obj["exchangeId"].toString();

        // Create the parent node
        QTreeWidgetItem* parent = new QTreeWidgetItem(tree);
        parent->setText(0, description);
        parent->setExpanded(false);

        // Store exchangeId as custom user data
        parent->setData(0, Qt::UserRole, exchangeId);

        // Insert dummy child to allow expansion
        new QTreeWidgetItem(parent);

        // Add some mock children for demonstration (e.g., contracts under this exchange)
    }

    connect(tree, &QTreeWidget::itemExpanded, this, &ContractPickerDialog::onItemExpanded);

    connect(searchEdit, &QLineEdit::textChanged, this, &ContractPickerDialog::filterContracts);
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
    connect(selectBtn, &QPushButton::clicked, this, [this]() {
        if (auto* item = tree->currentItem()) {
            emit contractSelected(item->text(0));
            accept();
        }
        });
    connect(tree, &QTreeWidget::itemDoubleClicked, this, &ContractPickerDialog::onItemDoubleClicked);
    connect(tree, &QTreeWidget::itemSelectionChanged, this, [this]() {
        auto* item = tree->currentItem();
        selectBtn->setEnabled(item && item->childCount() == 0);
        });
}

void ContractPickerDialog::onItemExpanded(QTreeWidgetItem* item) {
    // Check if this item already has real children
    if (item->childCount() > 0 && item->child(0)->data(0, Qt::UserRole).isNull() == true) {
        // Remove the dummy node
        item->removeChild(item->child(0));
    }
    else {
        return; // Already populated
    }

    QString exchangeId = item->data(0, Qt::UserRole).toString();

    if (!exchangeId.isEmpty()) {
        if (!nestedClient) {
            qWarning() << "Client pointer is null!";
            return;
        }
        qDebug() << "Loading contracts for exchange:" << exchangeId;
        nestedClient->load_contracts(exchangeId);  // You might want to emit a signal here instead
        // Then dynamically insert contracts below `item` as child QTreeWidgetItems
        // Retrieve cached contracts
        const QVector<QJsonObject>& contracts = nestedClient->contractsCache.value(exchangeId);

        if (contracts.isEmpty()) {
            qDebug() << "[ContractPickerDialog] No contracts found for exchange:" << exchangeId;
            return;
        }

        for (const QJsonObject& contract : contracts) {
            QString contractDesc = contract.value("description").toString();
            QString contractId = contract.value("contractID").toString();

            QTreeWidgetItem* contractItem = new QTreeWidgetItem(item);
            contractItem->setText(0, QString("%1 (%2)").arg(contractDesc, contractId));
            contractItem->setData(0, Qt::UserRole, contractId); // Optional: store contractID for later
        }
    }
}
void ContractPickerDialog::filterContracts(const QString& text) {
    for (int i = 0; i < tree->topLevelItemCount(); ++i) {
        auto* parent = tree->topLevelItem(i);
        bool parentVisible = false;
        for (int j = 0; j < parent->childCount(); ++j) {
            auto* child = parent->child(j);
            bool match = child->text(0).contains(text, Qt::CaseInsensitive);
            child->setHidden(!match);
            parentVisible |= match;
        }
        parent->setHidden(!parentVisible);
    }
}

void ContractPickerDialog::onItemDoubleClicked(QTreeWidgetItem* item, int column) {
    if (item->childCount() == 0) {
        emit contractSelected(item->text(0));
        accept();
    }
}
