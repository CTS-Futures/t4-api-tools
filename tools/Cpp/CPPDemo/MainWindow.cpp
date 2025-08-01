#include "mainwindow.h"
#include <QScreen>
MainWindow::MainWindow(QWidget* parent)
    : QMainWindow(parent) {
    client = new Client(this);
    
    setupUi();

    //connects signals to slots or functions
    connect(client, &Client::accountsUpdated, this, &MainWindow::populateAccounts);//signal from clients, called accountsUpdated, will use a in this current object and invoke populateAccounts
    connect(accountDropdown, &QComboBox::currentTextChanged,this, &MainWindow::onAccountSelected);//signal from the accoutn dropdown, when text is changed, will invoke onAccountSelected
	connect(client, &Client::disconnected, this, &MainWindow::onDisconnectClicked); //signal from client when disconnected, will invoke onDisconnectClicked
    connect(client, &Client::updateMarketTable, this, &MainWindow::MarketTableUpdate);
	connect(client, &Client::marketHeaderUpdate, this, &MainWindow::onMarketHeaderUpdate);
	connect(client, &Client::accountsPositionsUpdated, this, &MainWindow::PositionTableUpdate);
    connect(client, &Client::ordersUpdated, this, &MainWindow::OrderTableUpdate);
	connect(client, &Client::orderRevised, this, &MainWindow::onOrderRevised);
    

}

MainWindow::~MainWindow() {}

void MainWindow::setupUi() {
    QWidget* central = new QWidget(this);
    QVBoxLayout* mainLayout = new QVBoxLayout(central);

    // === Connection & Account ===
    QGroupBox* connectGroup = new QGroupBox("Connection & Account"); //the connection and account box w/ title
    QGridLayout* connectLayout = new QGridLayout();//the layout for the box

    QLabel* statusLabel = new QLabel("Disconnected"); //the status label
    QLabel* accountLabel = new QLabel("Account:"); //account label
    accountDropdown = new QComboBox(); //the dropwdown for accounts
    accountDropdown->addItem("Select Account..."); //adds a default item
    QPushButton* connectBtn = new QPushButton("Connect"); //the onnect button

    bool success = QObject::connect(connectBtn, &QPushButton::clicked, client, &Client::connectToServer);
    qDebug() << "Connection success:" << success;
    QPushButton* disconnectBtn = new QPushButton("Disconnect"); // the disconnec
	QObject::connect(disconnectBtn, &QPushButton::clicked, client, &Client::disconnectFromServer);


    //places the widgets into the connect layout
    connectLayout->addWidget(statusLabel, 0, 0);
    connectLayout->addWidget(accountLabel, 1, 0);
    connectLayout->addWidget(accountDropdown, 1, 1);
    connectLayout->addWidget(connectBtn, 1, 2);
    connectLayout->addWidget(disconnectBtn, 1, 3);

    //places the connect layout into the connect box
    connectGroup->setLayout(connectLayout);

    // === 2x2 Grid for Market Data, Submit Order, Positions, Orders ===
    QGridLayout* gridLayout = new QGridLayout();
    gridLayout->setSpacing(16);

    // Market Data Group
    
    marketGroup = new QGroupBox("Market Data - (...)");
    marketGroup->setStyleSheet("QGroupBox::title { font-weight: bold; font-size: 14pt; padding: 4px; }");

    QGridLayout* marketLayout = new QGridLayout();

    // Font for market values
    QFont valueFont;
    valueFont.setPointSize(14);
    valueFont.setBold(true);

    // Font for labels
    QFont labelFont;
    labelFont.setPointSize(10);
    labelFont.setBold(true);

    QLabel* bestBidText = new QLabel("Best Bid");
    bestBidText->setAlignment(Qt::AlignCenter);
    bestBidText->setFont(labelFont);
    marketLayout->addWidget(bestBidText, 0, 0);

    bestBidLabel = new QLabel("-");
    bestBidLabel->setFont(valueFont);
    bestBidLabel->setAlignment(Qt::AlignCenter);
    bestBidLabel->setStyleSheet("border: 2px solid #4CAF50; background-color: #e8f5e9; color: #2e7d32; padding: 6px;");
    marketLayout->addWidget(bestBidLabel, 1, 0);

    QLabel* bestOfferText = new QLabel("Best Offer");
    bestOfferText->setAlignment(Qt::AlignCenter);
    bestOfferText->setFont(labelFont);
    marketLayout->addWidget(bestOfferText, 0, 1);

    bestOfferLabel = new QLabel("-");
    bestOfferLabel->setFont(valueFont);
    bestOfferLabel->setAlignment(Qt::AlignCenter);
    bestOfferLabel->setStyleSheet("border: 2px solid #f44336; background-color: #ffebee; color: #c62828; padding: 6px;");
    marketLayout->addWidget(bestOfferLabel, 1, 1);

    QLabel* lastTradeText = new QLabel("Last Trade");
    lastTradeText->setAlignment(Qt::AlignCenter);
    lastTradeText->setFont(labelFont);
    marketLayout->addWidget(lastTradeText, 0, 2);

    lastTradeLabel = new QLabel("-");
    lastTradeLabel->setFont(valueFont);
    lastTradeLabel->setAlignment(Qt::AlignCenter);
    lastTradeLabel->setStyleSheet("border: 2px solid #1976d2; background-color: #e3f2fd; color: #0d47a1; padding: 6px;");
    marketLayout->addWidget(lastTradeLabel, 1, 2);


    // Create horizontal layout for the two buttons
    QHBoxLayout* buttonLayout = new QHBoxLayout();
    buttonLayout->setSpacing(8); // space between buttons
    buttonLayout->setAlignment(Qt::AlignRight); // align to top-right

    contractButton = new QPushButton("Contract");
	contractButton->setEnabled(false); 
    connect(contractButton, &QPushButton::clicked, client, &Client::load_exchanges);
    expiryButton = new QPushButton("Expiry");
	expiryButton->setEnabled(false);
    connect(expiryButton, &QPushButton::clicked, this, &MainWindow::openExpiryPickerDialog);

    connect(contractButton, &QPushButton::clicked, this, [this, client = this->client]() {
        ContractPickerDialog dlg(this->client, client->exchanges, this);

        connect(&dlg, &ContractPickerDialog::contractSelected, this, [](const QString& contract) {
            qDebug() << "Selected:" << contract;
            });

        dlg.exec();
        });

    buttonLayout->addWidget(contractButton);
    buttonLayout->addStretch();
    buttonLayout->addWidget(expiryButton);
    

    // Wrap the top row in a horizontal layout that includes buttons and table headers
    QHBoxLayout* topRowLayout = new QHBoxLayout();
    buttonLayout->setContentsMargins(0, 0, 0, 0);
    topRowLayout->addLayout(buttonLayout);

    // Insert the top row into the grid layout at row 0 spanning all 3 columns
    marketLayout->addLayout(topRowLayout, 0, 0, 1, 3);

    marketLayout->addWidget(bestBidText, 1, 0);
    marketLayout->addWidget(bestBidLabel, 2, 0);
    marketLayout->addWidget(bestOfferText, 1, 1);
    marketLayout->addWidget(bestOfferLabel, 2, 1);
    marketLayout->addWidget(lastTradeText, 1, 2);
    marketLayout->addWidget(lastTradeLabel, 2, 2);

    bestBidLabel->setMinimumHeight(100);
    bestOfferLabel->setMinimumHeight(100);
    lastTradeLabel->setMinimumHeight(100);
    // Create a container layout for the entire market group
    QVBoxLayout* marketContainerLayout = new QVBoxLayout();
    marketContainerLayout->addLayout(buttonLayout);  // buttons on top
    marketContainerLayout->addLayout(marketLayout);  // market data grid below

    marketGroup->setLayout(marketContainerLayout);

    marketGroup->setLayout(marketLayout);


    // Submit Order Group
    QGroupBox* submitGroup = new QGroupBox("Submit Order");
    QGridLayout* submitLayout = new QGridLayout();

    submitLayout->addWidget(new QLabel("Type:"), 0, 0);
    typeCombo = new QComboBox();
    typeCombo->addItems({ "Limit", "Market" });
    submitLayout->addWidget(typeCombo, 1, 0);

    submitLayout->addWidget(new QLabel("Side:"), 0, 1);
    sideCombo = new QComboBox();
    sideCombo->addItems({ "Buy", "Sell" });
    submitLayout->addWidget(sideCombo, 1, 1);

    submitLayout->addWidget(new QLabel("Volume:"), 2, 0);
    volumeSpin = new QSpinBox();
    volumeSpin->setRange(1, 10000);
    submitLayout->addWidget(volumeSpin, 3, 0);

    submitLayout->addWidget(new QLabel("Price:"), 2, 1);
    priceSpin = new QDoubleSpinBox();
    priceSpin->setRange(0.01, 99999);
    priceSpin->setDecimals(2);
    priceSpin->setValue(100);
    submitLayout->addWidget(priceSpin, 3, 1);

    submitLayout->addWidget(new QLabel("Take Profit ($):"), 4, 0);
    tpEdit = new QLineEdit("Optional");
    submitLayout->addWidget(tpEdit, 5, 0);

    submitLayout->addWidget(new QLabel("Stop Loss ($):"), 4, 1);
    slEdit = new QLineEdit("Optional");
    submitLayout->addWidget(slEdit, 5, 1);

    QPushButton* submitBtn = new QPushButton("Submit Order");
    submitLayout->addWidget(submitBtn, 6, 0, 1, 2);

    submitGroup->setLayout(submitLayout);
	connect(submitBtn, &QPushButton::clicked, this, &MainWindow::handleSubmitOrder);
    // Positions Group
    QGroupBox* positionsGroup = new QGroupBox("Positions");
    QVBoxLayout* posLayout = new QVBoxLayout();
    QTableWidget* positionsTable = new QTableWidget(0, 4);
    positionsTable->setHorizontalHeaderLabels({ "Market", "Net", "P&L", "Working" });
    posLayout->addWidget(positionsTable);
    positionsGroup->setLayout(posLayout);

    // Orders Group
    QGroupBox* ordersGroup = new QGroupBox("Orders");
    QVBoxLayout* ordersLayout = new QVBoxLayout();
    ordersTable = new QTableWidget(0, 7);
    ordersTable->setHorizontalHeaderLabels({ "Time", "Market", "Side", "Volume", "Price", "Status", "Action" });
    ordersLayout->addWidget(ordersTable);
    ordersGroup->setLayout(ordersLayout);

    // Add to 2x2 grid
    gridLayout->addWidget(marketGroup, 0, 0);
    gridLayout->addWidget(submitGroup, 0, 1);
    gridLayout->addWidget(positionsGroup, 1, 0);
    gridLayout->addWidget(ordersGroup, 1, 1);

    // Combine all sections
    mainLayout->addWidget(connectGroup);
    mainLayout->addLayout(gridLayout);

    central->setLayout(mainLayout);
    setCentralWidget(central);
    setWindowTitle("T4 Qt Trader");

	//additional styling for the groups
    connectGroup->setStyleSheet("QGroupBox::title { font-weight: bold; font-size: 14pt; padding: 4px; }");
    submitGroup->setStyleSheet("QGroupBox::title { font-weight: bold; font-size: 14pt;  padding: 4px; }");
    positionsGroup->setStyleSheet("QGroupBox::title { font-weight: bold; font-size: 14pt;  padding: 4px; }");
    ordersGroup->setStyleSheet("QGroupBox::title { font-weight: bold; font-size: 14pt; padding: 4px; }");

    resize(1920, 1080);
    QTimer::singleShot(0, this, [this]() {
        this->layout()->activate();  // Ensures the layout recalculates sizes
        this->updateGeometry();      // Triggers a geometry refresh
        });

}
void MainWindow::openExpiryPickerDialog() {
    ExpiryPickerDialog* dlg = new ExpiryPickerDialog(this, client);

    connect(dlg, &ExpiryPickerDialog::expirySelected, this, [](const QString& expiry) {
        qDebug() << "User selected expiry:" << expiry;
        });

    dlg->setAttribute(Qt::WA_DeleteOnClose);  // optional cleanup
    dlg->exec();  // modal; blocks until closed
}

//populates accounts into the account drop down
void MainWindow::populateAccounts() {
    auto accountMap = client->getAccounts(); //gets accounts from the client object


    //loops through all the available accounts
    for (auto it = accountMap.begin(); it != accountMap.end(); ++it) {

        const auto& account = it.value();

        QString accountId = QString::fromStdString(account.account_id());
        QString accountName = QString::fromStdString(account.account_name());
        QString accountNumber = QString::fromStdString(account.account_number());

        QString displayText = QString("%1 - %2").arg(accountName, accountId);
        accountDropdown->removeItem(0); //removes the "select account" place holder
        accountDropdown->addItem(displayText, accountId); 
    }
}

//subscribes to the account that is selected within the account dropedown
void MainWindow::onAccountSelected(const QString& text) {
    QString accountId = text.section(" - ", 1, 1).trimmed();

    if (!accountId.isEmpty()) {
        qDebug() << "Selected Account ID:" << accountId;
        client->subscribeAccount(accountId);
    }

}

void MainWindow::onDisconnectClicked() {
	accountDropdown->clear(); //clears the account dropdown
    accountDropdown->addItem("Select Account..."); //adds the default item back
	marketGroup->setTitle("Market Data - (...)"); //resets the market group title
	bestBidLabel->setText("-");
	bestOfferLabel->setText("-");
	lastTradeLabel->setText("-");
	contractButton->setEnabled(false); //disables the contract button
	expiryButton->setEnabled(false); //disables the expiry button
	qDebug() << "Disconnected from server, accounts cleared.";

	//TODO: clear the market data, positions, orders, etc.
}

void MainWindow::MarketTableUpdate(const QString& exchangeId, const QString& contractId, const QString& marketId, const QString& bestBid, const QString& bestOffer, const QString& lastTrade) {
    bestBidLabel->setText(bestBid);
    bestOfferLabel->setText(bestOffer);
    lastTradeLabel->setText(lastTrade);
    auto highlightChange = [](QLabel* label, const QString& newValue, const QColor& flashColor) {
        if (label->text() != newValue) {
            label->setText(newValue);
            label->setStyleSheet(QString("background-color: %1;").arg(flashColor.name()));

            QTimer::singleShot(300, [label]() {
                label->setStyleSheet("");  // Reset style after flash
                });
        }
        };

    highlightChange(bestBidLabel, bestBid, QColor("#ccffcc"));     // light green
    highlightChange(bestOfferLabel, bestOffer, QColor("#ffcccc")); // light red
    highlightChange(lastTradeLabel, lastTrade, QColor("#cce5ff")); // light blue
}

void MainWindow::PositionTableUpdate(QJsonArray positions) {
    //this function would update the positions table in the UI
   
	//find the positions table widget
    QTableWidget* positionsTable = findChild<QTableWidget*>();
    if (!positionsTable) {
        qWarning() << "Positions table not found!";
        return;
    }

    //clear the table
    positionsTable->setRowCount(0);

    //loop through the positions data and populate table
    for (const QJsonValue& val : positions) {
        if (!val.isObject()) continue;

        QJsonObject pos = val.toObject();
        QString market = pos.value("market_id").toString();
        int buys = pos.value("buys").toInt();
        int sells = pos.value("sells").toInt();
        int net = buys - sells;
        double pnl = pos.value("total_pnl").toDouble();
        int workingBuys = pos.value("working_buys").toInt();
        int workingSells = pos.value("working_sells").toInt();
        QString working = QString("%1/%2").arg(workingBuys).arg(workingSells);

        //add a row
        int row = positionsTable->rowCount();
        positionsTable->insertRow(row);
        positionsTable->setItem(row, 0, new QTableWidgetItem(market));
        positionsTable->setItem(row, 1, new QTableWidgetItem(QString::number(net)));
        positionsTable->setItem(row, 2, new QTableWidgetItem(QString::number(pnl, 'f', 2)));
        positionsTable->setItem(row, 3, new QTableWidgetItem(working));

		//widens the first column to fit the market names
        positionsTable->setColumnWidth(0, 200);


		//todo: make the P&L column green/red based on positive/negative P&L
        // Set color based on P&L
        //QColor backgroundColor;
        //if (pnl > 0)
        //    backgroundColor = QColor("#e8f5e9");  // green-ish
        //else if (pnl < 0)
        //    backgroundColor = QColor("#ffebee");  // red-ish
        //else
        //    backgroundColor = QColor("#f5f5f5");  // neutral gray

        //for (int col = 0; col < 4; ++col) {
        //    QTableWidgetItem* item = positionsTable->item(row, col);
        //    if (item) {
        //        item->setBackground(backgroundColor);
        //    }
        //}
    }
}

void MainWindow::OrderTableUpdate(QMap<QString, t4proto::v1::orderrouting::OrderUpdate> orders) {
    qDebug() << "table being updated";
	//this function would update the orders table in the UI 
   
    //filters all of the ordres of the current acocunt
    QJsonArray filteredOrders;

    for (const auto& order : orders) {
        if (QString::fromStdString(order.account_id()) != this->client->selectedAccount)
            continue;

        QJsonObject obj;
       
        // Convert only required fields
		obj["unique_id"] = QString::fromStdString(order.unique_id());
        obj["time"] = static_cast<qint64>(order.time().seconds());  // Just seconds

        obj["market_id"] = QString::fromStdString(order.market_id());
        obj["buy_sell"] = static_cast<int>(order.buy_sell());

        obj["new_volume"] = order.new_volume();  // optional: use has_new_volume()
        obj["current_volume"] = order.current_volume();
        obj["working_volume"] = order.working_volume();
        obj["status"] = order.status();
        if (order.has_new_limit_price()) {
            const std::string& priceStr = order.new_limit_price().value();
            if (!priceStr.empty()) {
                bool ok = false;
                double priceVal = QString::fromStdString(priceStr).toDouble(&ok);
                if (ok) {
                    obj["new_limit_price"] = QString::number(priceVal, 'f', 2);
                }
                else {
                    qWarning() << "Invalid price string:" << QString::fromStdString(priceStr);
                }
            }
            else {
                qWarning() << "Price value is empty despite has_new_limit_price()";
            }
        }

        filteredOrders.append(obj);
    }

    //ui update!
    // Step 2: Populate the QTableWidget
    if (!ordersTable) return;

    ordersTable->setRowCount(0);  // Clear table
    for (const QJsonValue& val : filteredOrders) {
        QJsonObject order = val.toObject();
        int row = ordersTable->rowCount();
        ordersTable->insertRow(row);

        QString timeStr = QDateTime::fromSecsSinceEpoch(order["time"].toVariant().toLongLong())
            .toString("HH:mm:ss");

        // Market
        QString market = order["market_id"].toString();

        // Side (buy/sell)
        QString side = (order["buy_sell"].toInt() == 1) ? "Buy" : "Sell";

        // Volume: prefer new_volume if present and > 0, otherwise fallback
        int newVol = order["new_volume"].toInt();
        int currVol = order["current_volume"].toInt();
        int workingVol = order["working_volume"].toInt();
        QString volume = QString("%1")
            .arg(workingVol);

        // Price (handle value safely)
        QJsonValue priceVal = order["new_limit_price"];
        qDebug() << priceVal;
		qDebug() << "Price value type:" << priceVal.type();
        QString price;
        if (priceVal.type() == 0) {
			price = "";  // No price set
        }
        else if (priceVal.isDouble()) {
            price = QString::number(priceVal.toDouble(), 'f', 2);
        }
        // Handle JSON string
        else if (priceVal.isString()) {
            QString s = priceVal.toString();

            // Remove any non-digit / non-decimal chars (protects against U+FFFD and others)
            s.remove(QRegularExpression("[^0-9\\.-]"));

            bool ok = false;
            double val = s.toDouble(&ok);
            price = ok ? QString::number(val, 'f', 2) : "�";
        }
        // Null / undefined / wrong type
        else {
            price = "�";
        }
        
  
        // Status
        QString status = QString::number(order["status"].toInt());
        
        if (order["status"].toInt() == 1) {
            editBtn = new QPushButton("Edit");

            connect(editBtn, &QPushButton::clicked, this, [=]() {
                showModifyOrderDialog(order["unique_id"].toString(), volume, price);  // replace with actual ID
                });

            ordersTable->setCellWidget(row, 6, editBtn);
        }
        else {
            ordersTable->setItem(row, 6, new QTableWidgetItem(""));  // Empty cell
        }
        auto* timeItem = new QTableWidgetItem(timeStr);
        timeItem->setData(Qt::UserRole, order["unique_id"].toString());  // embed unique ID
        ordersTable->setItem(row, 0, timeItem);
        ordersTable->setItem(row, 0, new QTableWidgetItem(timeStr));
        ordersTable->setItem(row, 1, new QTableWidgetItem(market));
        ordersTable->setItem(row, 2, new QTableWidgetItem(side));
        ordersTable->setItem(row, 3, new QTableWidgetItem(volume));
        ordersTable->setItem(row, 4, new QTableWidgetItem(price));
        ordersTable->setItem(row, 5, new QTableWidgetItem(status));
        
    }

    ordersTable->resizeColumnsToContents();
}
void MainWindow::onOrderRevised(const QString& uniqueId, int filledVol, int workingVol, const QString& price) {
    for (int row = 0; row < ordersTable->rowCount(); ++row) {
        QTableWidgetItem* timeItem = ordersTable->item(row, 0);
        if (!timeItem) continue;

        QString id = timeItem->data(Qt::UserRole).toString();  // read hidden ID
        if (id == uniqueId) {
            //  This is the correct row!

            // Update volume
            if (filledVol >= 0 || workingVol >= 0) {
                QString currentText = ordersTable->item(row, 3)->text();
                QString newText = QString("%1/%2")
                    .arg(filledVol >= 0 ? QString::number(filledVol) : currentText.section("/", 0, 0))
                    .arg(workingVol >= 0 ? QString::number(workingVol) : currentText.section("/", 1, 1));

                ordersTable->item(row, 3)->setText(newText);
            }

            // Update price
            if (!price.isEmpty()) {
                ordersTable->item(row, 4)->setText(price + " (fill)");
                ordersTable->item(row, 4)->setForeground(QBrush(Qt::darkGreen));
            }

            break;
        }
    }
}
void MainWindow::onMarketHeaderUpdate(const QString& displayText) {
	contractButton->setEnabled(true); 
	expiryButton->setEnabled(true); //enables the contract and expiry buttons when the market is ready to play with
    marketGroup->setTitle("Market Data - " + displayText);
}

void MainWindow::handleSubmitOrder() {
    QString priceTypeStr = typeCombo->currentText();
    QString sideStr = sideCombo->currentText();
    double price = priceSpin->value();
    int volume = volumeSpin->value();

    std::optional<double> tpDollars = std::nullopt;
    std::optional<double> slDollars = std::nullopt;

    bool ok;

    double tpVal = tpEdit->text().toDouble(&ok);
    if (ok) tpDollars = tpVal;

    double slVal = slEdit->text().toDouble(&ok);
    if (ok) slDollars = slVal;

    // Convert everything and call submitOrder
    client->submitOrder(
        sideStr.toLower(),              // "buy" or "sell"
        volume,
        QString::number(price, 'f', 2), // force string format
        priceTypeStr.toLower(),         // "limit" or "market"
        tpDollars,
        slDollars
    );
}

void MainWindow::showModifyOrderDialog(const QString& orderId, QString volume, QString price) {
    QDialog dialog(this);
    dialog.setWindowTitle("Modify Order");
    dialog.setModal(true);
    dialog.setFixedSize(300, 200);  // Optional sizing

    QVBoxLayout* mainLayout = new QVBoxLayout(&dialog);

    // Volume input
    QLabel* volumeLabel = new QLabel("Volume:");
    QSpinBox* volumeSpin = new QSpinBox();
    volumeSpin->setRange(1, 10000);
	volumeSpin->setValue(volume.toInt());
    mainLayout->addWidget(volumeLabel);
    mainLayout->addWidget(volumeSpin);

    // Price input
    QLabel* priceLabel = new QLabel("Price:");
    QLineEdit* priceEdit = new QLineEdit();

   


// Set initial value
    priceEdit->setText(price);
    mainLayout->addWidget(priceLabel);
    mainLayout->addWidget(priceEdit);

    // Buttons
    QHBoxLayout* buttonLayout = new QHBoxLayout();

    QPushButton* pullBtn = new QPushButton("Pull");
    pullBtn->setStyleSheet("background-color: red; color: white;");
    buttonLayout->addWidget(pullBtn);

    QPushButton* reviseBtn = new QPushButton("Revise");
    reviseBtn->setStyleSheet("background-color: royalblue; color: white;");
    buttonLayout->addWidget(reviseBtn);

    QPushButton* cancelBtn = new QPushButton("Cancel");
    buttonLayout->addWidget(cancelBtn);

    mainLayout->addLayout(buttonLayout);

    // Connect buttons
    connect(pullBtn, &QPushButton::clicked, &dialog, [=, &dialog]() {
        client->pullOrder(orderId);
        dialog.accept();
        });

    connect(reviseBtn, &QPushButton::clicked, &dialog, [=, &dialog]() {
        double pri = priceEdit->text().toDouble();
        int vol = volumeSpin->value();
        client->reviseOrder(orderId, vol, pri, "limit");
        dialog.accept();
        });

    connect(cancelBtn, &QPushButton::clicked, &dialog, &QDialog::reject);

    dialog.exec();
}
