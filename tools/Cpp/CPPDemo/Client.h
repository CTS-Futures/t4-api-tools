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

#include "t4/v1/market/market.pb.h"
using t4proto::v1::market::MarketDepthSubscribe;
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
        QVector<QJsonObject> exchanges;
        QMap<QString, QVector<QJsonObject>> contractsCache;
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
		void updateMarketHeader(const QString& contractId, QString& expiryDate);
        void refreshToken();
        void load_exchanges();
        void load_contracts(const QString& exchangeId);
        QString getAuthToken();
        QVector<QJsonObject> handleSearch(const QString& text);
        QString getMarketId(const QString& exchangeId, const QString& contractId);
        /*ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict);*/
    signals: // can emit signals to notify other parts of the application 
        void connected();
        void disconnected();
        void authenticated();
        void accountsUpdated();
        void tokenRefreshed();
        void marketHeaderUpdate(const QString& displayText);
		void updateMarketTable(const QString& exchangeId, const QString& contractId, const QString& marketId, const QString& bestBid, const QString& bestOffer, const QString& lastTrade);
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
        QString mdExchangeId;
        QString mdContractId;
        QString _latestRequestKey;

        int priceFormat = 0;

        QString jwtToken;
        QDateTime jwtExpiration;
        std::string pendingTokenRequest;
        QMap<QString, std::function<void(bool)>> tokenResolvers; // requestID -> callback

        // Account and connection state
            // raw response or parsed object
        QMap<QString, t4proto::v1::auth::LoginResponse_Account> accounts;
        QString selectedAccount;
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
        QMap<QString, QJsonObject> orders;
        QMap<QString, QJsonObject> positions;
};

#endif // CLIENT_H