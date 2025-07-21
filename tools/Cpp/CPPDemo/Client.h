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
};

#endif // CLIENT_H