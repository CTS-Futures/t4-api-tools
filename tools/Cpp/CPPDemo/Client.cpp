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
    ClientMessage createClientMessage(const std::map<std::string, google::protobuf::Message*>& message_dict) {
        
        //creates envelope
        ClientMessage client_message;


        //checks if diciontary is empty
        if (message_dict.empty()) {
            throw std::invalid_argument("Empty message dictionary");
        }

		//gets the first key-value pair from the dictionary
        const std::string& key = message_dict.begin()->first;
        const google::protobuf::Message* value = message_dict.begin()->second;

		//decides which message type to set based on the key
        if (key == "login_request") {
            client_message.mutable_login_request()->CopyFrom(*value);
        }
        else if (key == "authentication_token_request") {
            client_message.mutable_authentication_token_request()->CopyFrom(*value);
        }
        else if (key == "market_depth_subscribe") {
            client_message.mutable_market_depth_subscribe()->CopyFrom(*value);
        }
        else if (key == "market_by_order_subscribe") {
            client_message.mutable_market_by_order_subscribe()->CopyFrom(*value);
        }
        else if (key == "account_subscribe") {
            client_message.mutable_account_subscribe()->CopyFrom(*value);
        }
        else if (key == "order_submit") {
            client_message.mutable_order_submit()->CopyFrom(*value);
        }
        else if (key == "order_revise") {
            client_message.mutable_order_revise()->CopyFrom(*value);
        }
        else if (key == "order_pull") {
            client_message.mutable_order_pull()->CopyFrom(*value);
        }
        else if (key == "create_uds") {
            client_message.mutable_create_uds()->CopyFrom(*value);
        }
        else if (key == "heartbeat") {
            client_message.mutable_heartbeat()->CopyFrom(*value);
        }
        else {
            throw std::invalid_argument("Unsupported message type: " + key);
        }

        return client_message;
    }
    void Client::connectToServer() {
        qDebug() << "button pressed!";
        socket.open(apiUrl);
		handleOpen();
    }

    void Client::disconnectFromServer() {
        socket.close();
    }

    void Client::sendMessage(const QString& message) {
        socket.sendTextMessage(message);
    }

    void Client::handleOpen() {
        authenticate();
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
		sendMessage(QString::fromStdString(serialized_message));
        

	}
    void Client::onConnected() {
        qDebug() << "WebSocket connected!";
        emit connected();
    }

    void Client::onTextMessageReceived(const QString& message) {
        qDebug() << "Received message:" << message;
        emit messageReceived(message);
   }

