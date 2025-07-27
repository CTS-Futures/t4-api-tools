#ifndef CLIENT_H
#define CLIENT_H
#include "t4/v1/service.pb.h"
using t4proto::v1::service::ClientMessage;
#include "t4/v1/auth/auth.pb.h"
using t4proto::v1::auth::LoginRequest;
using t4proto::v1::auth::AuthenticationTokenRequest;
#include "t4/v1/account/account.pb.h"
using t4proto::v1::account::AccountSubscribe;

#include "t4/v1/common/enums.pb.h"
using t4proto::v1::common::AccountSubscribeType_descriptor;
using t4proto::v1::common::BuySell;
using t4proto::v1::common::OrderLink;
using t4proto::v1::common::TimeType;
using t4proto::v1::common::ActivationType;

#include "t4/v1/market/market.pb.h"
using t4proto::v1::market::MarketDepthSubscribe;

#include "t4/v1/orderrouting/orderrouting.pb.h"
using t4proto::v1::orderrouting::OrderSubmit;
using t4proto::v1::orderrouting::OrderSubmit_Order;
using t4proto::v1::orderrouting::OrderPull_Pull;
using t4proto::v1::orderrouting::OrderPull;
using t4proto::v1::orderrouting::OrderRevise_Revise;
using t4proto::v1::orderrouting::OrderRevise;
#include "t4/v1/common/price.pb.h"
using t4proto::v1::common::PriceType;
using t4proto::v1::common::Price;
#include <QObject> //signals and slots
#include <QWebSocket>
#include <map>
#include <string>
#include <iostream>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonValue>
#include <QUuid>
#include <QTimer>
#include <QEventLoop>

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrlQuery>
#include <QJsonDocument>
#include <QDebug>
//object called client inheriting from Qobject (required to use signals and slots))
class Client : public QObject {
    Q_OBJECT
    public:
        QString mdExchangeId;
        QString mdContractId;
        QString selectedAccount;
        QMap<QString, t4proto::v1::orderrouting::OrderUpdate> orders;
        QVector<QJsonObject> exchanges;
        QMap<QString, QVector<QJsonObject>> contractsCache;
        QMap<QString, QVector<QJsonObject>> groupsCache;
        QMap<QString, QVector<QJsonObject>> marketsCache;

        explicit Client(QObject* parent = nullptr); //constructor method
         
        bool loadConfig(const QString& path);

		//functions to connect, disconnect, and send messages
        QMap<QString, t4proto::v1::auth::LoginResponse_Account> getAccounts() const;
        void disconnectFromServer();
        void sendMessage(const std::string& message);
        void handleOpen();
        void authenticate();
		void handleLoginResponse(const t4proto::v1::auth::LoginResponse& response);
		void handleMarketSnapshot(const t4proto::v1::market::MarketSnapshot& snapshot);
		void handleMarketDetails(const t4proto::v1::market::MarketDetails& detail);
        void handleMarketDepth(const t4proto::v1::market::MarketDepth& depth);
        void handleAccountUpdate(const t4proto::v1::account::AccountUpdate update);
        void handleAccountSnapshot(const t4proto::v1::account::AccountSnapshot snapshot);
        void handleAccountPositionProfit(const t4proto::v1::account::AccountPositionProfit message);
        void handleAccountPosition(const t4proto::v1::account::AccountPosition message);
        void handleOrderUpdate(const t4proto::v1::orderrouting::OrderUpdate& update);
		void handleOrderUpdateStatus(const t4proto::v1::orderrouting::OrderUpdateStatus& status);
		void handleOrderUpdateTrade(const t4proto::v1::orderrouting::OrderUpdateTrade& trade);
		void handleOrderUpdateTradeLeg(const t4proto::v1::orderrouting::OrderUpdateTradeLeg& tradeLeg);
        void handleOrderUpdateFailed(const t4proto::v1::orderrouting::OrderUpdateFailed& failed);
		void handleOrderUpdateMulti(const t4proto::v1::orderrouting::OrderUpdateMulti& multiUpdate);
        void updateMarketHeader(const QString& contractId, QString& expiryDate);
        void submitOrder(const QString& side, double volume, const QString& price, const QString& priceType = "limit", std::optional<double> takeProfitDollars = std::nullopt, std::optional<double> stopLossDollars = std::nullopt);
        void pullOrder(const QString& orderId);
        void reviseOrder(const QString& orderId, int volume, double price, const QString& priceType);
       /* void reviseOrder(*/
        void refreshToken();
        void load_exchanges();
        void load_contracts(const QString& exchangeId);
        QVector<QJsonObject> loadGroups();
        QVector<QJsonObject> loadMarketsForGroups(QString& strategyType, QString& expiryDate);
        QString getStrategyDisplayName(const QString& strategyType);
        QString getAuthToken();
        QVector<QJsonObject> handleSearch(const QString& text);
        QString getMarketId(const QString& exchangeId, const QString& contractId);
        /*ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict);*/
    signals: // can emit signals to notify other parts of the application 
        void connected();
        void disconnected();
        void authenticated();
        void accountsUpdated();
        void accountsPositionsUpdated(QJsonArray positions);
        void tokenRefreshed();
        void marketHeaderUpdate(const QString& displayText);
		void updateMarketTable(const QString& exchangeId, const QString& contractId, const QString& marketId, const QString& bestBid, const QString& bestOffer, const QString& lastTrade);
		void ordersUpdated(QMap<QString, t4proto::v1::orderrouting::OrderUpdate> orders);
        void contractsUpdated();

 //       void marketUpdated(const QString& exchangeId, const QString& contractId, const QString& marketId);
    public slots:
        void connectToServer();
        void subscribeAccount(const QString& accountId);
        void subscribeMarket(const QString& exchangeId, const QString& contractId, const QString& marketId);
        void onAuthenticated();

    private slots:
        void onConnected();
		void onDisconnected();
        void onBinaryMessageReceived(const QByteArray& message);
        void sendHeartbeat();

    private:
        QWebSocket socket;
        QUrl connectionUrl;
        bool isConnected = false;
        // Connection info
        QUrl websocketUrl;
        QUrl apiUrl;
        QTimer* heartbeatTimer = nullptr;
        // Credentials
        QString firm;
        QString username;
        QString password;
        QString appName;
        QString appLicense;
        
        // Market data config

        QString _latestRequestKey;

        int priceFormat = 0;

        QString jwtToken;
        QDateTime jwtExpiration;
        std::string pendingTokenRequest;
        QMap<QString, std::function<void(bool)>> tokenResolvers; // requestID -> callback

        // Account and connection state
            // raw response or parsed object
        QMap<QString, t4proto::v1::auth::LoginResponse_Account> accounts;
       
        std::function<void(QJsonObject)> onAccountUpdate;
        t4proto::v1::auth::LoginResponse loginResponse;
        // Market data
        QString currentMarketId;
        QString currentSubscription;
        QMap<QString, t4proto::v1::market::MarketDetails> marketDetails;
        QMap<QString, t4proto::v1::market::MarketDepth> marketSnapshots;
        QJsonObject marketUpdate;
        
        std::function<void()> onMarketSwitch;

        // Orders and positions
        
        QMap<QString, QJsonObject> positions;
};

#endif // CLIENT_H