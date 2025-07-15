#ifndef T4CLIENT_H
#define T4CLIENT_H

#include <QObject>
#include <QWebSocket>
#include <QUrl>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QTimer>


class T4Client : public QObject
{
    Q_OBJECT

public:
    explicit T4Client(QObject *parent = nullptr);

    void loadConfig(const QString &filename);
    void sendMessage();
    void authenticate();
    void connectToWebSocket();
    void disconnectWebSocket();
    void sendWebSocketMessage(const QByteArray &data);

    void makeRestCall(const QUrl &url);  // Simple GET for now

signals:
    void webSocketConnected();
    void webSocketDisconnected();
    void webSocketMessageReceived(const QByteArray &message);

    void restReplyReceived(const QByteArray &data);

private slots:
    void onWebSocketConnected();
    void onWebSocketDisconnected();
    void onWebSocketMessage(const QByteArray &message);
    void onRestReply(QNetworkReply *reply);

private:
    QUrl wsUrl;
    QUrl apiUrl;
    QString apiKey;
    QString firm;
    QString userName;
    QString password;
    QString appName;
    QString appLicense;
    int priceFormat = 0;
    int heartbeatIntervalMs = 20000;
    int messageTimeoutMs = 60000;
    QString mdExchangeId;
    QString mdContractId;

    // === WebSocket state ===
    QWebSocket m_webSocket;
    QNetworkAccessManager m_networkManager;
    bool isConnected = false;
    QVariant loginResponse;
    QMap<QString, QVariant> accounts;
    QString selectedAccount;

    // === JWT management ===
    QString jwtToken;
    QDateTime jwtExpiration;
    bool pendingTokenRequest = false;

    // === Market Data ===
    QMap<QString, QVariant> marketSnapshots;
    QString currentSubscription;
    QMap<QString, QVariant> marketDetails;
    QString currentMarketId;

    // === Orders and Positions ===
    QMap<QString, QVariant> positions;
    QMap<QString, QVariant> orders;

    // === Heartbeat & retry ===
    QTimer heartbeatTimer;
    QDateTime lastMessageReceived;
    int reconnectAttempts = 0;
    int maxReconnectAttempts = 10;
    int reconnectDelay = 1000;
    bool isDisposed = false;

    // === Event callbacks (as function pointers or signals in practice) ===
    // You may want to replace these with signals later
    std::function<void(bool)> onConnectionStatusChanged;
    std::function<void(QVariant)> onAccountUpdate;
    std::function<void(QVariant)> onMarketHeaderUpdate;
    std::function<void(QVariant)> onMarketUpdate;
    std::function<void(QByteArray)> onMessageSent;
    std::function<void(QByteArray)> onMessageReceived;
};

#endif // T4CLIENT_H
