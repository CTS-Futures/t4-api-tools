#ifndef CLIENT_H
#define CLIENT_H

#include <QObject> //signals and slots
#include <QWebSocket>


//object called client inheriting from Qobject (required to use signals and slots))
class Client : public QObject {
    Q_OBJECT
    public:
        explicit Client(QObject* parent = nullptr); //constructor method

        bool loadConfig(const QString& path);

		//functions to connect, disconnect, and send messages
        void connectToServer(const QUrl& url);
        void disconnectFromServer();
        void sendMessage(const QString& message);

    signals: // can emit signals to notify other parts of the application
        void connected();
        void disconnected();
        void messageReceived(QString message);

    private slots:
        void onConnected();
        void onTextMessageReceived(const QString& message);

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