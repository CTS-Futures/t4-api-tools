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

    }

    connect(tree, &QTreeWidget::itemExpanded, this, &ContractPickerDialog::onItemExpanded);

    connect(searchEdit, &QLineEdit::textChanged, this, &ContractPickerDialog::filterContracts);
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
    connect(selectBtn, &QPushButton::clicked, this, &ContractPickerDialog::handleSelection);
    connect(tree, &QTreeWidget::itemDoubleClicked, this, &ContractPickerDialog::onItemDoubleClicked);
    connect(tree, &QTreeWidget::itemSelectionChanged, this, [this]() {
        auto* item = tree->currentItem();
        selectBtn->setEnabled(item && item->childCount() == 0);
        });
}

void ContractPickerDialog::onItemExpanded(QTreeWidgetItem* item) {
    // Check if this item already has real children


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
            QString exchangeid = contract.value("exchangeId").toString();
            QString contractType = contract.value("contractType").toString();

            QVariantMap contractMeta;
            contractMeta["exchangeId"] = exchangeId;
            contractMeta["contractId"] = contractId;
            contractMeta["contractType"] = contractType;

            QTreeWidgetItem* contractItem = new QTreeWidgetItem(item);
            contractItem->setText(0, QString("%1 (%2)").arg(contractDesc, contractId));
            contractItem->setData(0, Qt::UserRole, contractMeta); // Optional: store contractID for later
        }
    }
}

void ContractPickerDialog::filterContracts(const QString& text) {

    if (text.length() < 2) {
        tree->clear();
        for (const QJsonObject& obj : nestedClient->exchanges) {
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

        }  // <-- Your custom function to repopulate the tree with exchanges
        return;
    }

    tree->clear();

    //calls nested client handle search
    QMap<QString, QVector<QJsonObject>> grouped;
    QVector<QJsonObject> results = nestedClient->handleSearch(text);

    //groups up all the contracts under their respective exchanges
    for (const QJsonObject& contract : results) {
        QString exchangeId = contract.value("exchangeID").toString();
        QString contractId = contract.value("contractID").toString();

        if (!exchangeId.isEmpty()) {
            grouped[exchangeId].append(contract);
        }
       

    }

    //implements all of the data in to the serach tree
    for (auto it = grouped.begin(); it != grouped.end(); ++it) {
        const QString& exchangeId = it.key();
        const QVector<QJsonObject>& contracts = it.value();

        QTreeWidgetItem* parent = new QTreeWidgetItem(tree);
        parent->setText(0, "Exchange: " + exchangeId);
        parent->setExpanded(true);
        parent->setData(0, Qt::UserRole, exchangeId);

        for (const QJsonObject& contract : contracts) {
            QString label = QString("%1 (%2)")
                .arg(contract.value("description").toString())
                .arg(contract.value("contractID").toString());
            QString contractId = contract.value("contractID").toString();
            QString contractType = contract.value("contractType").toString();

            QVariantMap contractMeta;
            contractMeta["exchangeId"] = exchangeId;
            contractMeta["contractId"] = contractId;
            contractMeta["contractType"] = contractType;
            QTreeWidgetItem* child = new QTreeWidgetItem(parent);
            child->setText(0, label);
            child->setData(0, Qt::UserRole, contractMeta);  // store full contract data if needed
        }
    }

}

//code is very similar for both functions. Grabs the meta data from the tree and subscribes using the client function
void ContractPickerDialog::onItemDoubleClicked(QTreeWidgetItem* item, int column) {
    if (item->childCount() == 0) {
        QVariantMap meta = item->data(0, Qt::UserRole).toMap();
        QString exchangeId = meta.value("exchangeId").toString();
        QString contractId = meta.value("contractId").toString();
        QString contractType = meta.value("contractType").toString();
        QString marketId = nestedClient->getMarketId(exchangeId, contractId);

        nestedClient->subscribeMarket(exchangeId, contractId, marketId);
        emit contractSelected(item->text(0));
        accept();
    }
}
void ContractPickerDialog::handleSelection() {
    QTreeWidgetItem* item = tree->currentItem();
    if (!item || item->childCount() > 0)
        return;

    QVariantMap meta = item->data(0, Qt::UserRole).toMap();
    QString exchangeId = meta.value("exchangeId").toString();
    QString contractId = meta.value("contractId").toString();
    QString contractType = meta.value("contractType").toString();
    QString marketId = nestedClient->getMarketId(exchangeId, contractId);

    nestedClient->subscribeMarket(exchangeId, contractId, marketId);
    emit contractSelected(item->text(0));
    accept();
}

