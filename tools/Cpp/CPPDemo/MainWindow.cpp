#include "mainwindow.h"

MainWindow::MainWindow(QWidget* parent)
    : QMainWindow(parent) {
    client = new Client(this);
    setupUi();
    qDebug() << "client pointer:" << client;
 
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
    QComboBox* accountDropdown = new QComboBox(); //the dropwdown for accounts
    accountDropdown->addItem("Select Account..."); //adds a default item
    QPushButton* connectBtn = new QPushButton("Connect"); //the onnect button

    bool success = QObject::connect(connectBtn, &QPushButton::clicked, client, &Client::connectToServer);
    qDebug() << "Connection success:" << success;
    QPushButton* disconnectBtn = new QPushButton("Disconnect"); // the disconnec


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
    QGroupBox* marketGroup = new QGroupBox("Market Data - (...)");
    QGridLayout* marketLayout = new QGridLayout();
    marketLayout->addWidget(new QLabel("Best Bid"), 0, 0);
    marketLayout->addWidget(new QLabel("-"), 1, 0);
    marketLayout->addWidget(new QLabel("Best Offer"), 0, 1);
    marketLayout->addWidget(new QLabel("-"), 1, 1);
    marketLayout->addWidget(new QLabel("Last Trade"), 0, 2);
    marketLayout->addWidget(new QLabel("-"), 1, 2);
    marketGroup->setLayout(marketLayout);

    // Submit Order Group
    QGroupBox* submitGroup = new QGroupBox("Submit Order");
    QGridLayout* submitLayout = new QGridLayout();

    submitLayout->addWidget(new QLabel("Type:"), 0, 0);
    QComboBox* typeCombo = new QComboBox();
    typeCombo->addItems({ "Limit", "Market" });
    submitLayout->addWidget(typeCombo, 1, 0);

    submitLayout->addWidget(new QLabel("Side:"), 0, 1);
    QComboBox* sideCombo = new QComboBox();
    sideCombo->addItems({ "Buy", "Sell" });
    submitLayout->addWidget(sideCombo, 1, 1);

    submitLayout->addWidget(new QLabel("Volume:"), 2, 0);
    QSpinBox* volumeSpin = new QSpinBox();
    volumeSpin->setRange(1, 10000);
    submitLayout->addWidget(volumeSpin, 3, 0);

    submitLayout->addWidget(new QLabel("Price:"), 2, 1);
    QDoubleSpinBox* priceSpin = new QDoubleSpinBox();
    priceSpin->setRange(0.01, 99999);
    priceSpin->setDecimals(2);
    priceSpin->setValue(100);
    submitLayout->addWidget(priceSpin, 3, 1);

    submitLayout->addWidget(new QLabel("Take Profit ($):"), 4, 0);
    QLineEdit* tpEdit = new QLineEdit("Optional");
    submitLayout->addWidget(tpEdit, 5, 0);

    submitLayout->addWidget(new QLabel("Stop Loss ($):"), 4, 1);
    QLineEdit* slEdit = new QLineEdit("Optional");
    submitLayout->addWidget(slEdit, 5, 1);

    QPushButton* submitBtn = new QPushButton("Submit Order");
    submitLayout->addWidget(submitBtn, 6, 0, 1, 2);

    submitGroup->setLayout(submitLayout);

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
    QTableWidget* ordersTable = new QTableWidget(0, 7);
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
    resize(1400, 900);
}
