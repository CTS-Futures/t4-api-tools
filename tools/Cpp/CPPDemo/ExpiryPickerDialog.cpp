#include "ExpiryPickerDialog.h"

ExpiryPickerDialog::ExpiryPickerDialog(QWidget* parent, Client* client, std::function<void(QString)> onSelect)
    : QDialog(parent), client(client), onSelectCallback(onSelect) {
    setWindowTitle("Select Expiry");
    resize(500, 600);
    setModal(true);

    exchangeId = client->mdExchangeId;
    contractId = client->mdContractId;

    buildUI();
    QTimer::singleShot(0, this, &ExpiryPickerDialog::loadAndRenderGroups);
}

void ExpiryPickerDialog::buildUI() {
    auto layout = new QVBoxLayout(this);

    // Title
    auto title = new QLabel("Select Expiry");
    QFont font = title->font();
    font.setBold(true);
    font.setPointSize(12);
    title->setFont(font);
    layout->addWidget(title);

    // Tree container
    treeWidget = new QTreeWidget(this);
    treeWidget->setHeaderHidden(true);
    layout->addWidget(treeWidget, 1); // stretch

    connect(treeWidget, &QTreeWidget::itemExpanded, this, &ExpiryPickerDialog::onItemExpanded);
    connect(treeWidget, &QTreeWidget::itemSelectionChanged, this, &ExpiryPickerDialog::onItemSelected);

    // Separator
    QFrame* separator = new QFrame(this);
    separator->setFrameShape(QFrame::HLine);
    separator->setFrameShadow(QFrame::Sunken);
    layout->addWidget(separator);

    // Button bar
    auto btnLayout = new QHBoxLayout();
    QPushButton* cancelBtn = new QPushButton("Cancel");
    selectButton = new QPushButton("Select");
    selectButton->setEnabled(false);

    connect(cancelBtn, &QPushButton::clicked, this, &ExpiryPickerDialog::reject);
    connect(selectButton, &QPushButton::clicked, this, &ExpiryPickerDialog::onConfirmSelection);
    connect(treeWidget, &QTreeWidget::itemDoubleClicked, this, &ExpiryPickerDialog::onConfirmSelection);

    btnLayout->addStretch();
    btnLayout->addWidget(selectButton);
    btnLayout->addWidget(cancelBtn);
    layout->addLayout(btnLayout);
}

void ExpiryPickerDialog::loadAndRenderGroups() {
    QVector<QJsonObject> groups = client->loadGroups();  // Sync or async if needed
    if (groups.isEmpty()) {
        treeWidget->clear();
        return;
	}
    treeWidget->clear();
    for (const QJsonObject& group : groups) {
        QString strategy= group["strategyType"].toString();
        QString expiry = group["expiryDate"].toString();
        QString label = client->getStrategyDisplayName(strategy);
        int marketCount = group["marketCount"].toInt();

        // Unique ID equivalent: strategy + "_" + expiry
        QString nodeId = QString("%1_%2").arg(strategy, expiry.isEmpty() ? "none" : expiry);

        // Create top-level parent item
        QTreeWidgetItem* parentItem = new QTreeWidgetItem(treeWidget);
        parentItem->setText(0, label);
        parentItem->setData(0, Qt::UserRole, nodeId);  // simulate iid
        parentItem->setData(0, Qt::UserRole + 1, "group");
        parentItem->setData(0, Qt::UserRole + 2, strategy);
        parentItem->setData(0, Qt::UserRole + 3, expiry);

        // Add dummy child to make expandable
        QTreeWidgetItem* dummyChild = new QTreeWidgetItem();
        dummyChild->setText(0, "");  // empty so it stays hidden
        parentItem->addChild(dummyChild);

        treeWidget->addTopLevelItem(parentItem);
    }
    qDebug() << "Loaded" << groups;
}
void ExpiryPickerDialog::loadAndRenderMarkets(QTreeWidgetItem* item, QString strategy, QString expiry) {
    QVector<QJsonObject> markets = client->loadMarketsForGroups(strategy, expiry);  // synchronous

    if (markets.isEmpty()) return;

    for (const QJsonObject& m : markets) {
        QString marketId = m["marketID"].toString();
        QString expiryDate = m["expiryDate"].toString();
        QString description = m["description"].toString();
        QString label = description.isEmpty() ? marketId : description;

        QTreeWidgetItem* marketItem = new QTreeWidgetItem(item);  // Insert into the parent
        marketItem->setText(0, label);
        marketItem->setData(0, Qt::UserRole + 1, "market");
        marketItem->setData(0, Qt::UserRole + 2, marketId);
        marketItem->setData(0, Qt::UserRole + 3, expiryDate);
        marketItem->setData(0, Qt::UserRole + 4, description);
    }
}
void ExpiryPickerDialog::onItemExpanded(QTreeWidgetItem* item) {
    QString type = item->data(0, Qt::UserRole + 1).toString();
    if (type != "group") return;

    // Clear dummy child
    item->takeChildren();

    QString strategy = item->data(0, Qt::UserRole + 2).toString();
    QString expiry = item->data(0, Qt::UserRole + 3).toString();

    loadAndRenderMarkets(item, strategy, expiry);  // call 3rd function
}

void ExpiryPickerDialog::onItemSelected() {
    
    QList<QTreeWidgetItem*> selectedItems = treeWidget->selectedItems();
    qDebug() << selectedItems;
    if (selectedItems.isEmpty()) {
        selectedExpiry = QJsonObject();  // clear
        selectButton->setEnabled(false);
        return;
    }

    QTreeWidgetItem* item = selectedItems.first();
    QString type = item->data(0, Qt::UserRole + 1).toString();

    if (type == "market") {
        QString marketId = item->data(0, Qt::UserRole + 2).toString();
        QString expiryDate = item->data(0, Qt::UserRole + 3).toString();
        QString description = item->data(0, Qt::UserRole + 4).toString();

        // Store in a QJsonObject (mimics a Python dict)
        selectedExpiry = QJsonObject{
            { "marketId", marketId },
            { "expiryDate", expiryDate },
            { "description", description },
            { "exchangeId", exchangeId },
            { "contractId", contractId }
        };
        qDebug() << selectedExpiry;
        selectButton->setEnabled(true);
    }
    else {
        selectedExpiry = QJsonObject();  // clear
        selectButton->setEnabled(false);
    }
}

void ExpiryPickerDialog::onConfirmSelection() {

    //subscribes to the market with the new ifnormation
    client->subscribeMarket(
        selectedExpiry["exchangeId"].toString(),
        selectedExpiry["contractId"].toString(),
        selectedExpiry["marketId"].toString()
	);
    
    accept();
}
