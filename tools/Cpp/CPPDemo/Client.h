#ifndef CLIENT_H
#define CLIENT_H
#include "t4/v1/service.pb.h"
using t4proto::v1::service::ClientMessage;
#include "t4/v1/auth/auth.pb.h"
using t4proto::v1::auth::LoginRequest;
#include <QObject> //signals and slots
#include <QWebSocket>
#include <map>
#include <string>
#include <iostream>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonValue>

//object called client inheriting from Qobject (required to use signals and slots))
class Client : public QObject {
    Q_OBJECT
    public:
        explicit Client(QObject* parent = nullptr); //constructor method

        bool loadConfig(const QString& path);

		//functions to connect, disconnect, and send messages
  
        void disconnectFromServer();
        void sendMessage(const std::string& message);
        void handleOpen();
        void authenticate();
		void handleLoginResponse(const t4proto::v1::auth::LoginResponse& response);
        /*ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict);*/
    signals: // can emit signals to notify other parts of the application
        void connected();
        void disconnected();
        void messageReceived(QString message);
    public slots:
        void connectToServer();
    private slots:
        void onConnected();
        void onBinaryMessageReceived(const QByteArray& message);

    private:
        QWebSocket socket;
        QUrl connectionUrl;
        bool isConnected = false;
        // Connection info
        QUrl websocketUrl;
        QUrl apiUrl;

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
        QString pendingTokenRequest;
        QMap<QString, std::function<void(bool)>> tokenResolvers; // requestID -> callback

        // Account and connection state
            // raw response or parsed object
        QMap<QString, QJsonObject> accounts;
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