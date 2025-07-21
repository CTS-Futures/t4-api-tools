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
    connect(&socket, &QWebSocket::disconnected, this, &Client::disconnected);
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
  //  ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict) {
  //      
  //      //creates envelope
  //      ClientMessage client_message;


  //      //checks if diciontary is empty
  //      if (message_dict.empty()) {
  //          throw std::invalid_argument("Empty message dictionary");
  //      }

		////gets the first key-value pair from the dictionary
  //      const std::string& key = message_dict.begin()->first;
  //      const google::protobuf::Message* value = message_dict.begin()->second;

		////decides which message type to set based on the key
  //      if (key == "login_request") {
  //          client_message.mutable_login_request()->CopyFrom(*value);
  //      }
  //      else if (key == "authentication_token_request") {
  //          client_message.mutable_authentication_token_request()->CopyFrom(*value);
  //      }
  //      else if (key == "market_depth_subscribe") {
  //          client_message.mutable_market_depth_subscribe()->CopyFrom(*value);
  //      }
  //      else if (key == "market_by_order_subscribe") {
  //          client_message.mutable_market_by_order_subscribe()->CopyFrom(*value);
  //      }
  //      else if (key == "account_subscribe") {
  //          client_message.mutable_account_subscribe()->CopyFrom(*value);
  //      }
  //      else if (key == "order_submit") {
  //          client_message.mutable_order_submit()->CopyFrom(*value);
  //      }
  //      else if (key == "order_revise") {
  //          client_message.mutable_order_revise()->CopyFrom(*value);
  //      }
  //      else if (key == "order_pull") {
  //          client_message.mutable_order_pull()->CopyFrom(*value);
  //      }
  //      else if (key == "create_uds") {
  //          client_message.mutable_create_uds()->CopyFrom(*value);
  //      }
  //      else if (key == "heartbeat") {
  //          client_message.mutable_heartbeat()->CopyFrom(*value);
  //      }
  //      else {
  //          throw std::invalid_argument("Unsupported message type: " + key);
  //      }

  //      return client_message;
  //  }
    void Client::connectToServer() {
        if (socket.state() == QAbstractSocket::ConnectedState) {
            qDebug() << "Already connected. Disconnecting first.";
            socket.close();
        }
        qDebug() << "button pressed!";
        socket.open(websocketUrl);

    }

    void Client::disconnectFromServer() {
        socket.close();
    }

    void Client::sendMessage(const std::string& message){
        socket.sendBinaryMessage(QByteArray::fromRawData(message.data(), message.size()));
    }

    void Client::handleOpen() {
		qDebug() << "WebSocket opening...";
        
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
    void Client::handleLoginResponse(const t4proto::v1::auth::LoginResponse& message) {
        // Check for result code 0 = success
        if (message.result() == 0) {
            loginResponse.CopyFrom(message);  // If you want to store it

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
            //accounts.clear();
            //for (const auto& account : message.accounts()) {
            //    accounts[QString::fromStdString(account.account_id())] = account;
            //}

            // Trigger login event if you're simulating async
            //loginEventSet = true;  // your own flag, or QWaitCondition::wakeAll()

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
        t4proto::v1::service::ServerMessage serverMsg;
        if (serverMsg.ParseFromArray(message.data(), message.size())) {
            qDebug() << "Parsed message of type:" << QString::fromStdString(serverMsg.GetTypeName());
            qDebug() << serverMsg.has_login_response();
            if (serverMsg.has_login_response()) {
                qDebug() << "test";
				handleLoginResponse(serverMsg.login_response());
            }
        }

    }


