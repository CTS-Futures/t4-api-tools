#include "Client.h"
#include <QDebug>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QWebSocket>


Client::Client(QObject* parent)
    : QObject(parent)

{ //constructor initializes the websocket client
    loadConfig("config/config.json"); // tries to load the configuration from a JSON file 

    connect(&socket, &QWebSocket::connected, this, &Client::onConnected);
    connect(&socket, &QWebSocket::disconnected, this, &Client::onDisconnected);
    connect(&socket, &QWebSocket::binaryMessageReceived, this, &Client::onBinaryMessageReceived);
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

    //accounts getter
    QMap<QString, t4proto::v1::auth::LoginResponse_Account> Client::getAccounts() const {
        return accounts;
    }

    void Client::connectToServer() {
        if (socket.state() == QAbstractSocket::ConnectedState) {
            qDebug() << "Already connected. Disconnecting first.";
            socket.close();
        }
        qDebug() << "button pressed!";
        socket.open(websocketUrl);

    }

    void Client::disconnectFromServer() {
		qDebug() << "Disconnecting from server...";
        socket.close();
    }

    void Client::sendMessage(const std::string& message){
        socket.sendBinaryMessage(QByteArray::fromRawData(message.data(), message.size()));
    }

    void Client::handleOpen() {
		qDebug() << "WebSocket opening...";
        
	}
    void Client::sendHeartbeat() {
        try {
            qint64 timestampMs = QDateTime::currentDateTimeUtc().toMSecsSinceEpoch();

            // Create protobuf message
            t4proto::v1::service::ClientMessage msg;
            auto* heartbeat = msg.mutable_heartbeat();
            heartbeat->set_timestamp(timestampMs);  // assuming .timestamp is int64

            // Serialize and send
            std::string serialized = msg.SerializeAsString();
            sendMessage(serialized);

            qDebug() << "Heartbeat sent at timestamp:" << timestampMs;
        }
        catch (const std::exception& e) {
            qWarning() << "Failed to send heartbeat:" << e.what();
        }
    }

    void Client::authenticate() {
		//sets the authentication request with the credentials loaded from the config file
		LoginRequest request;
        request.set_firm(firm.toStdString());
		request.set_username(username.toStdString());
		request.set_password(password.toStdString());
		request.set_app_name(appName.toStdString());
		request.set_app_license(appLicense.toStdString());

        //envelope and encrypt the request
        ClientMessage message;
		message.mutable_login_request()->CopyFrom(request);
        std::string serialized_message = message.SerializeAsString();

		//send the message to the server
		sendMessage(serialized_message);
		qDebug() << serialized_message;

	}
    void Client::onConnected() {
        qDebug() << "WebSocket connected!";
        authenticate();
        emit connected();
        
    }

    void Client::onDisconnected() {
        qDebug() << "WebSocket disconnected!";
        
        
        // Stop heartbeat timer if it exists
        if (heartbeatTimer) {
            heartbeatTimer->stop();
            heartbeatTimer->deleteLater();  // Clean up the timer
            heartbeatTimer = nullptr;
            qDebug() << "[heartbeat] Timer stopped";

        }
        emit disconnected();

	}
    void Client::handleLoginResponse(const t4proto::v1::auth::LoginResponse& message) {
        // Check for result code 0 = success
        if (message.result() == 0) {
            loginResponse.CopyFrom(message);  // If you want to store it
            //start heartbeat timer
            if (!heartbeatTimer) {
                heartbeatTimer = new QTimer(this);
                connect(heartbeatTimer, &QTimer::timeout, this, &Client::sendHeartbeat);
                heartbeatTimer->start(20 * 1000);  // Every 20 seconds
                qDebug() << "[heartbeat] Timer started";
            }

            // Store JWT token if available
            if (message.has_authentication_token()) {
                const auto& token = message.authentication_token();
                if (!token.token().empty()) {
                    jwtToken = QString::fromStdString(token.token());

                    if (token.expire_time().seconds() > 0) {
                        // Convert seconds to msec timestamp (epoch)
                        qint64 expirationMs = static_cast<qint64>(token.expire_time().seconds()) * 1000;
                        jwtExpiration = QDateTime::fromSecsSinceEpoch(token.expire_time().seconds());
                        qDebug() << "JWT expiration set to:" << jwtExpiration;
                    }
                }
            }

            // Store accounts
            accounts.clear();
            for (const auto& account : message.accounts()) {
                accounts[QString::fromStdString(account.account_id())] = account;
            }

            emit accountsUpdated();

            // Notify UI
            /*if (onAccountUpdate) {
                QVariantList accountList;
                for (const auto& acc : accounts) {
                    QVariantMap accMap;
                    accMap["account_id"] = QString::fromStdString(acc.account_id());
                    accMap["description"] = QString::fromStdString(acc.description());
                    accountList.append(accMap);
                }

                QVariantMap payload;
                payload["type"] = "accounts";
                payload["accounts"] = accountList;

                onAccountUpdate(payload);
            }*/
        }
        else {
            qDebug() << "Login failed";
        }
	}
    void Client::onBinaryMessageReceived(const QByteArray& message) {
        qDebug() << "[binary] Received message, size:" << message.size();

        // Attempt to decode the protobuf response
        t4proto::v1::service::ServerMessage msg;
        if (msg.ParseFromArray(message.data(), message.size())) {


            if (msg.has_login_response()) {
                handleLoginResponse(msg.login_response());
            }
            else if (msg.has_authentication_token()) {
                qDebug() << "[authentication_token]\n"
                    << QString::fromStdString(msg.authentication_token().DebugString());

            }
            else if (msg.has_account_subscribe_response()) {
                qDebug() << "[account_subscribe_response]\n"
                    << QString::fromStdString(msg.account_subscribe_response().DebugString());

            }
            else if (msg.has_account_update()) {
                qDebug() << "[account_update]\n"
                    << QString::fromStdString(msg.account_update().DebugString());

            }
            else if (msg.has_account_snapshot()) {
                qDebug() << "[account_snapshot]\n"
                    << QString::fromStdString(msg.account_snapshot().DebugString());

            }
            else if (msg.has_account_position()) {
                qDebug() << "[account_position]\n"
                    << QString::fromStdString(msg.account_position().DebugString());

            }
            else if (msg.has_market_details()) {
                qDebug() << "[market_details]\n"
                    << QString::fromStdString(msg.market_details().DebugString());

            }
            else if (msg.has_market_snapshot()) {
                qDebug() << "[market_snapshot]\n"
                    << QString::fromStdString(msg.market_snapshot().DebugString());

            }
            else if (msg.has_account_profit()) {
                qDebug() << "[account_profit]\n"
                    << QString::fromStdString(msg.account_profit().DebugString());

            }
            else if (msg.has_account_position_profit()) {
                qDebug() << "[account_position_profit]\n"
                    << QString::fromStdString(msg.account_position_profit().DebugString());

            }
            else if (msg.has_market_depth()) {
                qDebug() << "[market_depth]\n"
                    << QString::fromStdString(msg.market_depth().DebugString());

            }
            else if (msg.has_order_update_multi()) {
                qDebug() << "[order_update_multi]\n"
                    << QString::fromStdString(msg.order_update_multi().DebugString());

            }
            else if (msg.has_order_update()) {
                qDebug() << "[order_update]\n"
                    << QString::fromStdString(msg.order_update().DebugString());

            }
            else if (msg.has_heartbeat()) {
                qDebug() << "heart beat received";
            }
            else {
                qDebug() << "[unknown message type]";
                qDebug() << "Full message dump:\n"
                    << QString::fromStdString(msg.DebugString());
            }
        }
        else {
            qDebug() << "[error] Failed to parse ServerMessage.";
        }
    }  
    
        void Client::subscribeAccount(const QString& accountId) {
            //if an account is already selected then we can skip
            if (selectedAccount == accountId) {
                return;
            }

            //unsubscribe from the account
            if (!selectedAccount.isEmpty()) {
                AccountSubscribe unsubscribe;
				
                unsubscribe.set_subscribe(t4proto::v1::common::ACCOUNT_SUBSCRIBE_TYPE_NONE);
                unsubscribe.set_subscribe_all_accounts(false);
                unsubscribe.add_account_id(selectedAccount.toStdString());
                unsubscribe.set_upl_mode(t4proto::v1::common::UPL_MODE_NONE);

				ClientMessage unsubscribeMessage;
                unsubscribeMessage.mutable_account_subscribe()->CopyFrom(unsubscribe);
                std::string serializedUnsubscribe = unsubscribeMessage.SerializeAsString();
                sendMessage(serializedUnsubscribe);
				qDebug() << "Unsubscribed from account:" << selectedAccount;

            }

			selectedAccount = accountId; //set the selected account

            AccountSubscribe subscribe;
            subscribe.set_subscribe(t4proto::v1::common::ACCOUNT_SUBSCRIBE_TYPE_ALL_UPDATES);
            subscribe.set_subscribe_all_accounts(false);
            subscribe.add_account_id(accountId.toStdString());
			subscribe.set_upl_mode(t4proto::v1::common::UPL_MODE_AVERAGE);
            ClientMessage subscribeMessage;
            subscribeMessage.mutable_account_subscribe()->CopyFrom(subscribe);
            std::string serializedSubscribe = subscribeMessage.SerializeAsString();
			sendMessage(serializedSubscribe);
			qDebug() << "Subscribing to account:" << accountId;

    }
