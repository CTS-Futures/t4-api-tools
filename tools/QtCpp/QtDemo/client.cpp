#include "client.h"
#include <QDebug>
#include <QNetworkRequest>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QDebug>

T4Client::T4Client(QObject *parent)
    : QObject(parent)
{
    //loads all the necessary constructor info
    loadConfig("config.json");

    // connect(&m_webSocket, &QWebSocket::connected, this, &T4Client::onWebSocketConnected);
    // connect(&m_webSocket, &QWebSocket::disconnected, this, &T4Client::onWebSocketDisconnected);
    // connect(&m_webSocket, &QWebSocket::binaryMessageReceived, this, &T4Client::onWebSocketMessage);

    // connect(&m_networkManager, &QNetworkAccessManager::finished, this, &T4Client::onRestReply);
}

void T4Client::loadConfig(const QString &filename)
{
    QFile file(filename);
    if (!file.open(QIODevice::ReadOnly)) {
        qWarning() << "Failed to open config file:" << filename;
        return;
    }

    QByteArray data = file.readAll();
    file.close();

    QJsonParseError parseError;
    QJsonDocument doc = QJsonDocument::fromJson(data, &parseError);
    if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
        qWarning() << "Failed to parse JSON config:" << parseError.errorString();
        return;
    }

    QJsonObject root = doc.object();
    QJsonObject ws = root["websocket"].toObject();

    // Top-level connection URLs
    this->wsUrl = QUrl(ws["url"].toString());
    this->apiUrl = QUrl(ws["api"].toString());

    // Credentials

    this->firm        = ws["firm"].toString();
    this->userName    = ws["username"].toString();
    this->password    = ws["password"].toString();
    this->appName     = ws["app_name"].toString();
    this->appLicense  = ws["app_license"].toString();

    // Market Data
    this->mdExchangeId   = ws["md_exchange_id"].toString();
    this->mdContractId   = ws["md_contract_id"].toString();
    this->priceFormat    = ws["priceFormat"].toInt(2);  // default = 2

    // Optional hardcoded values or fallback
    this->heartbeatIntervalMs = root.value("heartbeatIntervalMs").toInt(20000);
    this->messageTimeoutMs    = root.value("messageTimeoutMs").toInt(60000);

    qDebug() << "Config loaded:"
             << "\n WebSocket URL:" << wsUrl
             << "\n API URL:" << apiUrl
             << "\n Firm:" << firm
             << "\n Username:" << userName
             << "\n Exchange:" << mdExchangeId
             << "\n Contract:" << mdContractId;
}
void T4Client::connectToWebSocket()
{
    if (isConnected){
        qDebug() << "already connected";
        return;
    }

    qDebug() <<"Connecting to websocket";



    // Connect signal handlers once
    connect(&m_webSocket, &QWebSocket::connected, this, &T4Client::onWebSocketConnected);
    connect(&m_webSocket, &QWebSocket::disconnected, this, &T4Client::onWebSocketDisconnected);
    connect(&m_webSocket, &QWebSocket::binaryMessageReceived, this, &T4Client::onWebSocketMessage);
    // connect(&m_webSocket, QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::error),
    //         [](QAbstractSocket::SocketError error) {
    //             qWarning() << "WebSocket error:" << error;
    //         });

    m_webSocket.open(wsUrl);
}

void T4Client::disconnectWebSocket()
{
    m_webSocket.close();
}

void T4Client::sendWebSocketMessage(const QByteArray &data)
{
    m_webSocket.sendBinaryMessage(data);
}

void T4Client::makeRestCall(const QUrl &url)
{
    QNetworkRequest request(url);
    m_networkManager.get(request);  // Simple GET call
}


//handler for when the websocket connects
void T4Client::onWebSocketConnected()
{
    //authenticate

    //send heartbeat
    qDebug() << "WebSocket connected";
    emit webSocketConnected();
}


//handler for when the websocket disconnects
void T4Client::onWebSocketDisconnected()
{
    qDebug() << "WebSocket disconnected";
    emit webSocketDisconnected();
}

void T4Client::onWebSocketMessage(const QByteArray &message)
{
    qDebug() << "WebSocket received:" << message;
    emit webSocketMessageReceived(message);
}

void T4Client::onRestReply(QNetworkReply *reply)
{
    QByteArray response = reply->readAll();
    qDebug() << "REST response:" << response;
    emit restReplyReceived(response);
    reply->deleteLater();
}

void T4Client::authenticate()
{

}
