#ifndef MAINWINDOW_H
#define MAINWINDOW_H
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QComboBox>
#include <QPushButton>
#include <QLineEdit>
#include <QSpinBox>
#include <QDoubleSpinBox>
#include <QGroupBox>
#include <QTableWidget>
#include <QTableWidgetItem>
#include "Client.h"
#include "ContractPickerDialog.h"
#include "ExpiryPickerDialog.h"
#include <QMainWindow>

class MainWindow : public QMainWindow {
        Q_OBJECT

    public:
        explicit MainWindow(QWidget* parent = nullptr);
        ~MainWindow();
    public slots:
        void MarketTableUpdate(const QString& exchangeId, const QString& contractId, const QString& marketId, const QString& bestBid, const QString& bestOffer, const QString& lastTrade);
        void onMarketHeaderUpdate(const QString& displayText);
		void PositionTableUpdate(QJsonArray positions);
		void OrderTableUpdate(QMap<QString, t4proto::v1::orderrouting::OrderUpdate> orders);
        void showModifyOrderDialog(const QString& orderId, QString volume, QString price);
        void onOrderRevised(const QString& uniqueId, int currentVol, int workingVol, const QString& price);
private slots:
        void handleSubmitOrder();
        void openExpiryPickerDialog();
        void populateAccounts();
        void onAccountSelected(const QString& text);
		void onDisconnectClicked();
    private:
        QGroupBox* marketGroup;
        QComboBox* accountDropdown;
        QTableWidget* ordersTable;
        QLabel* bestBidLabel;
        QLabel* bestOfferLabel;
        QLabel* lastTradeLabel;
        QPushButton* contractButton;
        QPushButton* expiryButton;
        QComboBox* typeCombo;
        QComboBox* sideCombo;
        QSpinBox* volumeSpin;
        QDoubleSpinBox* priceSpin;
        QLineEdit* tpEdit;
        QLineEdit* slEdit;
        QPushButton* editBtn;
        void setupUi();
		Client* client; // Pointer to the Client object for handling WebSocket communication
       
};

#endif // MAINWINDOW_H