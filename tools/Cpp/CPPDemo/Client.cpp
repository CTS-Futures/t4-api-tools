#include "Client.h"
#include <QDebug>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QDebug>
#include <QWebSocket>


Client::Client(QObject* parent)
    : QObject(parent)

{ //constructor initializes the websocket client
    loadConfig("config.json"); // tries to load the configuration from a JSON file 

    connect(&socket, &QWebSocket::connected, this, &Client::onConnected);
    connect(&socket, &QWebSocket::disconnected, this, &Client::disconnected);
    connect(&socket, &QWebSocket::textMessageReceived, this, &Client::onTextMessageReceived);
}
        //LOAD CONFIGURATION FROM JSON FILE
    bool Client::loadConfig(const QString & path) {
        QFile file(path);
        if (!file.open(QIODevice::ReadOnly)) {
            qWarning() << "Failed to open config file:" << path;
            return false;
        }

        QByteArray data = file.readAll();
        file.close();

        QJsonParseError parseError;
        QJsonDocument doc = QJsonDocument::fromJson(data, &parseError);
        if (parseError.error != QJsonParseError::NoError) {
            qWarning() << "JSON parse error:" << parseError.errorString();
            return false;
        }

        QJsonObject root = doc.object();
        QJsonObject ws = root.value("websocket").toObject();

        websocketUrl = QUrl(ws.value("url").toString());
        apiUrl = QUrl(ws.value("api").toString());

        firm = ws.value("firm").toString();
        username = ws.value("username").toString();
        password = ws.value("password").toString();
        appName = ws.value("app_name").toString();
        appLicense = ws.value("app_license").toString();

        mdExchangeId = ws.value("md_exchange_id").toString();
        mdContractId = ws.value("md_contract_id").toString();
        priceFormat = ws.value("priceFormat").toInt();

        qDebug() << "Config loaded:\n"
            << websocketUrl << apiUrl << username << mdContractId;

      
    }
    void Client::connectToServer(const QUrl& url) {
        qDebug() << "Connecting to:" << url;
        socket.open(url);
    }

    void Client::disconnectFromServer() {
        socket.close();
    }

    void Client::sendMessage(const QString& message) {
        socket.sendTextMessage(message);
    }

    void Client::onConnected() {
        qDebug() << "WebSocket connected!";
        emit connected();
    }

    void Client::onTextMessageReceived(const QString& message) {
        qDebug() << "Received message:" << message;
        emit messageReceived(message);
   }

