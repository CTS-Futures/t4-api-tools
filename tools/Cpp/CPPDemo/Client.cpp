#include "Client.h"
#include <QDebug>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QWebSocket>
#include <QUuid>


Client::Client(QObject* parent)
    : QObject(parent)

{ //constructor initializes the websocket client
    loadConfig("config/config.json"); // tries to load the configuration from a JSON file 

    connect(&socket, &QWebSocket::connected, this, &Client::onConnected);
    connect(&socket, &QWebSocket::disconnected, this, &Client::onDisconnected);
    connect(&socket, &QWebSocket::binaryMessageReceived, this, &Client::onBinaryMessageReceived);
	connect(this, &Client::authenticated, this, &Client::onAuthenticated);
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

        return true;
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
            emit authenticated();
        }
        else {
            qDebug() << "Login failed";
        }
	}
    void Client::handleMarketDetails(const t4proto::v1::market::MarketDetails& detail) {
        // Handle the market details
        qDebug() << "[market_details] Received market details for market ID:"
                 << QString::fromStdString(detail.market_id());
        qDebug() << QString::fromStdString(detail.contract_id());
       // qDebug() << detail.expiry_date();
		// store data
		marketDetails[QString::fromStdString(detail.market_id())] = detail;

	}
    void Client::handleMarketSnapshot(const t4proto::v1::market::MarketSnapshot& snapshot) {
        // Handle the market snapshot
        qDebug() << "[market_snapshot] Received market snapshot for market ID:"
                 << QString::fromStdString(snapshot.market_id());
        // Process the snapshot data as needed
        // For example, you can emit a signal with the snapshot data
   /*     emit marketSnapshotReceived(snapshot);*/

        for (const auto& msg : snapshot.messages()) {
            if (msg.has_market_settlement()) {
                continue;  // Skip market settlement messages
            }
            else if (msg.has_market_depth()) {
                handleMarketDepth(msg.market_depth());
            }
        }
        
        QString marketId = QString::fromStdString(snapshot.market_id());
  // Ensure marketDetails is initialized for this market
        const auto& details = marketDetails[marketId];
        qDebug() << "[snapshot] contract_id:" << QString::fromStdString(details.contract_id());
        qDebug() << "[snapshot] expiry_date:" << details.expiry_date();
        QString formattedExpiry = QString::number(details.expiry_date());
        updateMarketHeader(QString::fromStdString(details.contract_id()), formattedExpiry);


	}

    void Client::handleMarketDepth(const t4proto::v1::market::MarketDepth& depth) {
        // Handle the market depth
		marketSnapshots[QString::fromStdString(depth.market_id())] = depth;

		const auto& detail = marketDetails.value(QString::fromStdString(depth.market_id()));

        QString bestBid = "-";
        if (depth.bids_size() > 0) {
            const auto& bid = depth.bids(0);
            double bidPrice = QString::fromStdString(bid.price().value()).toDouble();
            int bidVolume =bid.volume();

            QString priceStr = QString::number(bidPrice, 'f', priceFormat);
            QString volumeStr = QString::number(bidVolume);
            bestBid = volumeStr + "@" + priceStr;
        }

        QString bestOffer = "-";
        if (depth.offers_size() > 0) {
            const auto& offer = depth.offers(0);
            double offerPrice = QString::fromStdString(offer.price().value()).toDouble();
            int offerVolume =offer.volume();

            QString priceStr = QString::number(offerPrice, 'f', priceFormat);
            QString volumeStr = QString::number(offerVolume);
            bestOffer = volumeStr + "@" + priceStr;
        }

        QString lastTrade = "-";
        if (depth.has_trade_data() && depth.trade_data().has_last_trade_price()) {
            double lastPrice = QString::fromStdString(depth.trade_data().last_trade_price().value()).toDouble();
            int lastVolume = depth.trade_data().last_trade_volume();

            QString priceStr = QString::number(lastPrice, 'f', priceFormat);
            QString volumeStr = QString::number(lastVolume);
            lastTrade = volumeStr + "@" + priceStr;
        }

      

        emit updateMarketTable(
            QString::fromStdString(detail.exchange_id()),
            QString::fromStdString(detail.contract_id()),
            QString::fromStdString(depth.market_id()),
            bestBid,
            bestOffer,
            lastTrade
        );
	}
    void Client::updateMarketHeader(const QString& contractId, QString& expiryDate) {
        // Emit a signal to update the market header
        QString expiryShort;

        //exracts the firs t6 diftis from the expirty date 
        expiryShort = expiryDate.left(6);  // Take first 6 digits
        
        QString displayText = contractId;

        if (expiryShort.length() == 6) {
            QString year = expiryShort.mid(2, 2);  // Last two digits of year
            QString month = expiryShort.mid(4, 2); // Month

            QMap<QString, QString> monthCodes = {
                {"01", "F"}, {"02", "G"}, {"03", "H"}, {"04", "J"}, {"05", "K"}, {"06", "M"},
                {"07", "N"}, {"08", "Q"}, {"09", "U"}, {"10", "V"}, {"11", "X"}, {"12", "Z"}
            };

            QString monthCode = monthCodes.value(month, month);
            displayText += monthCode + year;
        }
        //sends signal
        emit marketHeaderUpdate(displayText);
	}
    void Client::onBinaryMessageReceived(const QByteArray& message) {
      //  qDebug() << "[binary] Received message, size:" << message.size();

        // Attempt to decode the protobuf response
        t4proto::v1::service::ServerMessage msg;
        if (msg.ParseFromArray(message.data(), message.size())) {


            if (msg.has_login_response()) {
                handleLoginResponse(msg.login_response());
            }
            else if (msg.has_authentication_token()) {
                const auto& token = msg.authentication_token();

                jwtToken = QString::fromStdString(token.token());
                jwtExpiration = QDateTime::fromSecsSinceEpoch(token.expire_time().seconds());

                qDebug() << "[auth] JWT updated. Expiration:" << jwtExpiration.toString();

                emit tokenRefreshed();

            }
            else if (msg.has_account_subscribe_response()) {
                qDebug() << "[account_subscribe_response]\n"
                    << QString::fromStdString(msg.account_subscribe_response().DebugString());

            }
            /*else if (msg.has_account_update()) {
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

            }*/
            else if (msg.has_market_details()) {
				handleMarketDetails(msg.market_details());

            }
            else if (msg.has_market_snapshot()) {
				handleMarketSnapshot(msg.market_snapshot());

            }
           /* else if (msg.has_account_profit()) {
                qDebug() << "[account_profit]\n"
                    << QString::fromStdString(msg.account_profit().DebugString());

            }
            else if (msg.has_account_position_profit()) {
                qDebug() << "[account_position_profit]\n"
                    << QString::fromStdString(msg.account_position_profit().DebugString());

            }*/
            else if (msg.has_market_depth()) {
				handleMarketDepth(msg.market_depth());

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
            //else {
            //    qDebug() << "[unknown message type]";
            //    qDebug() << "Full message dump:\n"
            //        << QString::fromStdString(msg.DebugString());
            //}
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

    //sends a request for a new refresh token
    void Client::refreshToken() {
        QString uuid = QUuid::createUuid().toString(QUuid::WithoutBraces);  // "{abc-123}" "abc-123"
        std::string requestID = uuid.toStdString();

        pendingTokenRequest = requestID;
        
        AuthenticationTokenRequest req;
        req.set_request_id(requestID);


        ClientMessage messageReq;
        messageReq.mutable_authentication_token_request()->CopyFrom(req);
        std::string serializedReq = messageReq.SerializeAsString();
        sendMessage(serializedReq);
    }

    QString Client::getAuthToken() {  
        qint64 currentTime = QDateTime::currentSecsSinceEpoch();  

        if (!jwtToken.isEmpty() && jwtExpiration.toSecsSinceEpoch() > currentTime + 30) {  
            return jwtToken;  
        }  
        refreshToken();  
        //sets an event loop to wait for token to be sent
        QEventLoop loop;

        QTimer timeoutTimer;
        timeoutTimer.setSingleShot(true);
        timeoutTimer.start(5000);  // Optional: 5 second timeout
        connect(this, &Client::tokenRefreshed, &loop, &QEventLoop::quit);
        connect(&timeoutTimer, &QTimer::timeout, &loop, &QEventLoop::quit);

        loop.exec();  // This blocks until one of the above is triggered

        return jwtToken; //once the loop ends, the token should be refreshed
    }

    QString Client::getMarketId(const QString& exchangeId, const QString& contractId) {

        QString token = getAuthToken();

        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return QString();
        }
        QUrl url = apiUrl.resolved(QUrl("/markets/picker/firstmarket"));

        QUrlQuery query;
        query.addQueryItem("exchangeid", exchangeId);
        query.addQueryItem("contractid", contractId);
        url.setQuery(query);

        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished

        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[market_id] Network error:" << reply->errorString();
            reply->deleteLater();
            return QString();
        }

        QByteArray response = reply->readAll();
        reply->deleteLater();

        QJsonDocument json = QJsonDocument::fromJson(response);
        if (!json.isObject()) {
            qWarning() << "[market_id] Invalid JSON response";
            return QString();
        }

        QJsonObject obj = json.object();
        QString marketId = obj.value("marketID").toString();

        qDebug() << "[market_id] Resolved market ID:" << marketId;
        return marketId;
    }

    void Client::subscribeMarket(const QString& exchangeId, const QString& contractId, const QString& marketId) {
        
        if (exchangeId.isEmpty() || contractId.isEmpty() || marketId.isEmpty()) {
            qWarning() << "Invalid parameters for market subscription";
            return;
        }
        //emit a signal to change the ui
		//would just have to change the header of the market table
		//turn everything empty briefly before subscribing to the new market

		//emit marketUpdated(exchangeId, contractId, marketId);
        
		//ensures we're not subscribing to the same market multiple times
        QString key = exchangeId + "_" + contractId + "_" + marketId;
        
        if (_latestRequestKey == key) {
            qDebug() << "[subscribe_market] Duplicate request, skipping\n";
            return;
        }
       
		//unsubscribe from the previous market if it exists
        if (!_latestRequestKey.isEmpty()) {
            MarketDepthSubscribe unsubscribe;
            unsubscribe.set_exchange_id(mdExchangeId.toStdString());
            unsubscribe.set_contract_id(mdContractId.toStdString());
            unsubscribe.set_market_id(currentMarketId.toStdString());
            unsubscribe.set_buffer(t4proto::v1::common::DEPTH_BUFFER_NO_SUBSCRIPTION);
            unsubscribe.set_depth_levels(t4proto::v1::common::DEPTH_LEVELS_UNDEFINED);
            ClientMessage unsubscribeMessage;
            unsubscribeMessage.mutable_market_depth_subscribe()->CopyFrom(unsubscribe);
            std::string serializedUnsubscribe = unsubscribeMessage.SerializeAsString();
            t4proto::v1::service::ClientMessage msg;
            qDebug() << QString::fromStdString(unsubscribe.DebugString());
            sendMessage(serializedUnsubscribe);
            qDebug() << "[subscribe_market] Unsubscribed from previous market:";

        }

		_latestRequestKey = key;  // Update the latest request key
        mdExchangeId = exchangeId;
        mdContractId = contractId;
		currentMarketId = marketId;

        //subscribes to the market depth
		MarketDepthSubscribe subscribe;
		subscribe.set_exchange_id(exchangeId.toStdString());
		subscribe.set_contract_id(contractId.toStdString());
		subscribe.set_market_id(marketId.toStdString());
		subscribe.set_buffer(t4proto::v1::common::DEPTH_BUFFER_SMART);
		subscribe.set_depth_levels(t4proto::v1::common::DEPTH_LEVELS_BEST_ONLY);

        ClientMessage subscribeMessage;
		subscribeMessage.mutable_market_depth_subscribe()->CopyFrom(subscribe);
		std::string serializedSubscribe = subscribeMessage.SerializeAsString();
		sendMessage(serializedSubscribe);

        qDebug() << "[subscribe_market] Subscribed to market:" 
			<< exchangeId << contractId << marketId;
	}

    void Client::onAuthenticated() {
        qDebug() << "Client authenticated successfully!";
		QString marketId = getMarketId(mdExchangeId, mdContractId);
		subscribeMarket(mdExchangeId, mdContractId, marketId);

	}

    //Contract Picker Functions
	//loads the exchanges from the API 
    void Client::load_exchanges() {
        //if contracts are already stored, then we don't run this again
        if (!exchanges.isEmpty()) {
            return;
        }

        QString token = getAuthToken();

        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return;
        }
        QUrl url = apiUrl.resolved(QUrl("/markets/exchanges"));


        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished

        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[exchanges] Network error:" << reply->errorString();
            reply->deleteLater();
            return;
        }

        QByteArray response = reply->readAll();
        reply->deleteLater();

        QJsonDocument json = QJsonDocument::fromJson(response);
        if (!json.isObject()) {
            qWarning() << "[exchanges] Invalid JSON response";
        
        }

        QJsonArray exchangeArray = json.array();

        for (const QJsonValue& value : exchangeArray) {
            if (value.isObject()) {
                exchanges.append(value.toObject());
            }
        }
        qDebug() << json;
        // Sort by "description"
        std::sort(exchanges.begin(), exchanges.end(), [](const QJsonObject& a, const QJsonObject& b) {
            return a["description"].toString().toLower() < b["description"].toString().toLower();
            });
        qDebug() << exchanges;

        emit contractsUpdated();  // or a more appropriate signal
        return;
    }

    void Client::load_contracts(const QString& exchangeId) {

		//if contracts are already stored, then we don't run this again
       //todo
        QString token = getAuthToken();

        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return;
        }
        

		//set up url and query parameters
        QUrl url = apiUrl.resolved(QUrl("/markets/contracts"));
        QUrlQuery query;
        query.addQueryItem("exchangeid", exchangeId);
        url.setQuery(query);


        //http request
        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished

        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[contracts] Network error:" << reply->errorString();
            reply->deleteLater();
            return;
        }

        QByteArray response = reply->readAll();
        reply->deleteLater();
        qDebug() << response;
        QJsonDocument json = QJsonDocument::fromJson(response);
        if (!json.isArray()) {
            qWarning() << "[contracts] Invalid JSON response";
            return;
        }
;
        QJsonArray contractArray = json.array();  // example key

        QVector<QJsonObject> contracts;
        for (const QJsonValue& value : contractArray) {
            if (value.isObject()) {
                contracts.append(value.toObject());
            }
        }

        // Sort by "description"
        std::sort(contracts.begin(), contracts.end(), [](const QJsonObject& a, const QJsonObject& b) {
            return a["description"].toString().toLower() < b["description"].toString().toLower();
            });
        qDebug() << contracts;

        //cache the contracts
        contractsCache[exchangeId] = contracts;


    }

    //Uses api "search" method to return list of matching text
    QVector<QJsonObject> Client::handleSearch(const QString& text) {
        QString token = getAuthToken();

        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return QVector<QJsonObject>();
        }


        //set up url and query parameters
        QUrl url = apiUrl.resolved(QUrl("/markets/contracts/search"));
        QUrlQuery query;
        query.addQueryItem("search", text);
        url.setQuery(query);


        //http request
        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished


        //error checks
        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[serach] Network error:" << reply->errorString();
            reply->deleteLater();
            return QVector<QJsonObject>();
        }


        QByteArray response = reply->readAll();//reads the reply from the api
        reply->deleteLater();
        QJsonDocument json = QJsonDocument::fromJson(response);

        //checks if json is valid
        if (!json.isArray()) {
            qWarning() << "[search] Invalid JSON response";
            return QVector<QJsonObject>();
        }

        QJsonArray searchesArray = json.array();
        QVector<QJsonObject> search_objects;

        for (const QJsonValue& value : searchesArray) {
            if (value.isObject()) {
                search_objects.append(value.toObject());
            }
        }

        //sort by "description"
        std::sort(search_objects.begin(), search_objects.end(), [](const QJsonObject& a, const QJsonObject& b) {
            return a["description"].toString().toLower() < b["description"].toString().toLower();
            });


        return search_objects;



    }

    //Expiry Picker Functions
    QVector<QJsonObject> Client::loadGroups(){
        QString token = getAuthToken();

        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return QVector<QJsonObject>();
        }


        //set up url and query parameters
        QUrl url = apiUrl.resolved(QUrl("/markets/picker/groups"));
        QUrlQuery query;
        query.addQueryItem("exchangeid", mdExchangeId);
        query.addQueryItem("contractid", mdContractId);
        url.setQuery(query);


        //http request
        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished


        //error checks
        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[serach] Network error:" << reply->errorString();
            reply->deleteLater();
            return QVector<QJsonObject>();
        }


        QByteArray response = reply->readAll();//reads the reply from the api
        reply->deleteLater();
        QJsonDocument json = QJsonDocument::fromJson(response);

        //checks if json is valid
        if (!json.isArray()) {
            qWarning() << "[search] Invalid JSON response";
            return QVector<QJsonObject>();
        }

        QJsonArray groupsArray = json.array();
        QVector<QJsonObject> groupObjects;

        for (const QJsonValue& value : groupsArray) {
            if (value.isObject()) {
                groupObjects.append(value.toObject());
            }
        }
        QString key = "root";
        groupsCache[key] = groupObjects;
        return groupObjects;

    }

    QVector<QJsonObject> Client::loadMarketsForGroups(QString& strategyType, QString& expiryDate) {
        
        //caches groups
        QString cacheKey = strategyType + "_" + (expiryDate.isEmpty() ? "None" : expiryDate);

        if (marketsCache.contains(cacheKey)) {
            return marketsCache[cacheKey];
        }


        QString token = getAuthToken();


        if (token.isEmpty())
        {
            qDebug() << "token invalid";
            return QVector<QJsonObject>();
        }


        //set up url and query parameters
        QUrl url = apiUrl.resolved(QUrl("/markets/picker"));
        QUrlQuery query;
        query.addQueryItem("exchangeid", mdExchangeId);
        query.addQueryItem("strategytype", strategyType);
        url.setQuery(query);


        //http request
        QNetworkRequest request(url);
        request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        request.setRawHeader("Authorization", "Bearer " + token.toUtf8());

        QNetworkAccessManager manager;
        QNetworkReply* reply = manager.get(request);

        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();  // Block until request is finished


        //error checks
        if (reply->error() != QNetworkReply::NoError) {
            qWarning() << "[market_exppirty] Network error:" << reply->errorString();
            reply->deleteLater();
            return QVector<QJsonObject>();
        }


        QByteArray response = reply->readAll();//reads the reply from the api
        reply->deleteLater();
        QJsonDocument json = QJsonDocument::fromJson(response);

        //checks if json is valid
        if (!json.isArray()) {
            qWarning() << "[market_expiry] Invalid JSON response";
            return QVector<QJsonObject>();
        }

        QJsonArray marketsArray = json.array();
        QVector<QJsonObject> marketObjects;

        for (const QJsonValue& value : marketsArray) {
            if (value.isObject()) {
                marketObjects.append(value.toObject());
            }
        }

        marketsCache[cacheKey] = marketObjects;
        return marketObjects;
      
    }



QString Client::getStrategyDisplayName(const QString& strategyType) {
    static const QMap<QString, QString> strategyTypeMap = {
        {"None", "Outright"},
        {"CalendarSpread", "Calendar Spread"},
        {"RtCalendarSpread", "RT Calendar Spread"},
        {"InterContractSpread", "Inter Contract Spread"},
        {"Butterfly", "Butterfly"},
        {"Condor", "Condor"},
        {"DoubleButterfly", "Double Butterfly"},
        {"Horizontal", "Horizontal"},
        {"Bundle", "Bundle"},
        {"MonthVsPack", "Month vs Pack"},
        {"Pack", "Pack"},
        {"PackSpread", "Pack Spread"},
        {"PackButterfly", "Pack Butterfly"},
        {"BundleSpread", "Bundle Spread"},
        {"Strip", "Strip"},
        {"Crack", "Crack"},
        {"TreasurySpread", "Treasury Spread"},
        {"Crush", "Crush"},
        {"ThreeWay", "Three Way"},
        {"ThreeWayStraddleVsCall", "Three Way Straddle vs Call"},
        {"ThreeWayStraddleVsPut", "Three Way Straddle vs Put"},
        {"Box", "Box"},
        {"XmasTree", "Christmas Tree"},
        {"ConditionalCurve", "Conditional Curve"},
        {"Double", "Double"},
        {"HorizontalStraddle", "Horizontal Straddle"},
        {"IronCondor", "Iron Condor"},
        {"Ratio1X2", "Ratio 1x2"},
        {"Ratio1X3", "Ratio 1x3"},
        {"Ratio2X3", "Ratio 2x3"},
        {"RiskReversal", "Risk Reversal"},
        {"StraddleStrip", "Straddle Strip"},
        {"Straddle", "Straddle"},
        {"Strangle", "Strangle"},
        {"Vertical", "Vertical"},
        {"JellyRoll", "Jelly Roll"},
        {"IronButterfly", "Iron Butterfly"},
        {"Guts", "Guts"},
        {"Generic", "Generic"},
        {"Diagonal", "Diagonal"}
    };

    return strategyTypeMap.value(strategyType, strategyType);
}
