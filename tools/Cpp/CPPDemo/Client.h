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
//object called client inheriting from Qobject (required to use signals and slots))
class Client : public QObject {
    Q_OBJECT
    public:
        explicit Client(QObject* parent = nullptr); //constructor method

        bool loadConfig(const QString& path);

		//functions to connect, disconnect, and send messages
        QMap<QString, t4proto::v1::auth::LoginResponse_Account> getAccounts() const;
        void disconnectFromServer();
        void sendMessage(const std::string& message);
        void handleOpen();
        void authenticate();
		void handleLoginResponse(const t4proto::v1::auth::LoginResponse& response);
        void refreshToken();
        QString getAuthToken();
        /*ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict);*/
    signals: // can emit signals to notify other parts of the application 
        void connected();
        void disconnected();
        void accountsUpdated();
        void tokenRefreshed();
    public slots:
        void connectToServer();
        void subscribeAccount(const QString& accountId);
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
        QMap<QString, QJsonObject> marketDetails;
        QMap<QString, QJsonObject> marketSnapshots;
        QJsonObject marketUpdate;
        QJsonObject marketHeaderUpdate;
        std::function<void()> onMarketSwitch;

        // Orders and positions
        QMap<QString, QJsonObject> orders;
        QMap<QString, QJsonObject> positions;
};

#endif // CLIENT_H