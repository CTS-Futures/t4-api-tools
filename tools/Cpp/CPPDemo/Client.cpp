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
            double bidPrice = QString::fromStdString(bid.price().value()).toDouble() / 100.0;
            int bidVolume =bid.volume();

            QString priceStr = QString::number(bidPrice, 'f', priceFormat);
            QString volumeStr = QString::number(bidVolume);
            bestBid = volumeStr + "@" + priceStr;
        }

        QString bestOffer = "-";
        if (depth.offers_size() > 0) {
            const auto& offer = depth.offers(0);
            double offerPrice = QString::fromStdString(offer.price().value()).toDouble() /100.0;
            int offerVolume =offer.volume();

            QString priceStr = QString::number(offerPrice, 'f', priceFormat);
            QString volumeStr = QString::number(offerVolume);
            bestOffer = volumeStr + "@" + priceStr;
        }

        QString lastTrade = "-";
        if (depth.has_trade_data() && depth.trade_data().has_last_trade_price()) {
            double lastPrice = QString::fromStdString(depth.trade_data().last_trade_price().value()).toDouble() / 100.0;
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

    void Client::handleAccountUpdate(const t4proto::v1::account::AccountUpdate update) {
        qDebug() << "pass";
    }

    
    void Client::handleAccountPosition(const t4proto::v1::account::AccountPosition message) {
		//generates a key for the position
        QString key = QString::fromStdString(message.account_id()) + "_" + QString::fromStdString(message.market_id());


        QJsonObject posObj{
            { "account_id",    QString::fromStdString(message.account_id()) },
            { "exchange_id",   QString::fromStdString(message.exchange_id()) },
            { "contract_id",   QString::fromStdString(message.contract_id()) },
            { "market_id",     QString::fromStdString(message.market_id()) },
            { "buys",          static_cast<int>(message.buys()) },
            { "sells",         static_cast<int>(message.sells()) },
            { "working_buys",  static_cast<int>(message.working_buys()) },
            { "working_sells", static_cast<int>(message.working_sells()) },
            { "upl",           0.0 },
            { "rpl",           0.0 },
            { "total_pnl",     0.0 }
            };

		positions[key] = posObj; //stores the position in the position map
       

        QJsonArray filteredPositions;
        for (const auto& pos : positions) {
            if (pos["account_id"].toString() == selectedAccount) {
                filteredPositions.append(pos);
			}
            

        }
        //emit a signal to the ui
        emit accountsPositionsUpdated(filteredPositions);


    }
    void Client::handleAccountPositionProfit(const t4proto::v1::account::AccountPositionProfit message) {
        qDebug() << "[account_position_profit] Received profit update for account ID:"
            << QString::fromStdString(message.account_id());

        // Create key for position
        QString key = QString::fromStdString(message.account_id()) + "_" + QString::fromStdString(message.market_id());

        // Load existing or initialize position object
        QJsonObject position;
        if (positions.contains(key)) {
            position = positions[key];
        }
        else {
            position = QJsonObject{
                { "account_id",    QString::fromStdString(message.account_id()) },
                { "exchange_id",   QString::fromStdString(message.exchange_id()) },
                { "contract_id",   QString::fromStdString(message.contract_id()) },
                { "market_id",     QString::fromStdString(message.market_id()) },
                { "buys",          0 },
                { "sells",         0 },
                { "working_buys",  0 },
                { "working_sells", 0 }
            };

        }
        // Update P&L fields
        double upl = message.upl_trade();
        double rpl = message.rpl();
        double totalPnl = upl + rpl;

        position["upl"] = upl;
        position["rpl"] = rpl;
        position["total_pnl"] = totalPnl;

        // Save updated position
        positions[key] = position;

        // Optional: enrich log with market snapshot info
        QString marketId = QString::fromStdString(message.market_id());
        QString marketInfo;
        auto insertDecimal = [](const std::string& raw) -> QString {
            if (raw.size() <= 2) {
                return QString::fromStdString("0." + std::string(2 - raw.size(), '0') + raw);
            }
            std::string formatted = raw;
            formatted.insert(formatted.size() - 2, ".");
            return QString::fromStdString(formatted);
            };
        if (marketSnapshots.contains(marketId)) {
            const auto& snapshot = marketSnapshots[marketId];

            QString bestBid = "-";
            if (snapshot.bids_size() > 0) {
                const auto& bid = snapshot.bids(0);
                bestBid = QString("%1@%2")
                    .arg(bid.volume())
                    .arg(QString::number(std::stod(bid.price().value()) / 100.0, 'f', 2));
				qDebug() << "Best bid:" << bestBid;
            }
            QString bestOffer = "-";
            if (snapshot.offers_size() > 0) {
                const auto& offer = snapshot.offers(0);
                bestOffer = QString("%1@%2")
                    .arg(offer.volume())
                    .arg(insertDecimal(offer.price().value()));
            }
            QString lastTrade = "-";
            if (snapshot.has_trade_data() && snapshot.trade_data().has_last_trade_price()) {
                lastTrade = QString("%1@%2")
                    .arg(snapshot.trade_data().last_trade_volume())
                    .arg(insertDecimal(snapshot.trade_data().last_trade_price().value()));
            }

            marketInfo = QString(" (Bid: %1, Offer: %2, Last: %3)").arg(bestBid, bestOffer, lastTrade);
        }

        //qDebug() << QString("[Position P&L update] Market: %1%2, UPL: %3, RPL: %4, Total P&L: %5")
        //    .arg(marketId, marketInfo)
        //    .arg(upl)
        //    .arg(rpl)
        //    .arg(totalPnl);

        // Emit filtered positions for the selected account
        if (QString::fromStdString(message.account_id()) == selectedAccount) {
            QJsonArray filteredPositions;
            for (const auto& pos : positions) {
                if (pos["account_id"].toString() == selectedAccount) {
                    filteredPositions.append(pos);
                }
            }

            emit accountsPositionsUpdated(filteredPositions);
         }
        }


	
    void Client::handleAccountSnapshot(const t4proto::v1::account::AccountSnapshot snapshot) {
        
        //grabs all the differnt information from the snapshot and sends it to handlers
        for (const auto& msg : snapshot.messages()) {
            switch (msg.payload_case()) {

            case t4proto::v1::account::AccountSnapshotMessage::kAccountUpdate:
                handleAccountUpdate(msg.account_update());
                break;
            case t4proto::v1::account::AccountSnapshotMessage::kAccountPosition:
                handleAccountPosition(msg.account_position());
                break;
            case t4proto::v1::account::AccountSnapshotMessage::kOrderUpdateMulti:
                handleOrderUpdateMulti(msg.order_update_multi());
                break;

            case t4proto::v1::account::AccountSnapshotMessage::PAYLOAD_NOT_SET:
            default:
                
                break;
            }
         
        }
    }

    void Client::handleOrderUpdate(const t4proto::v1::orderrouting::OrderUpdate& update) {
        // Handle order updates
        
        
		orders[QString::fromStdString(update.unique_id())] = update;

        emit ordersUpdated(orders);
	}

    void Client::handleOrderUpdateStatus(const t4proto::v1::orderrouting::OrderUpdateStatus& status) {

        QString uniqueId = QString::fromStdString(status.unique_id());

        if (!orders.contains(uniqueId)) {
            qWarning() << "Order ID not found:" << uniqueId;
            return;
        }

        t4proto::v1::orderrouting::OrderUpdate existingOrder = orders[uniqueId];

        existingOrder.set_status(status.status());
        *existingOrder.mutable_time() = status.time();
        existingOrder.set_price_type(status.price_type());
        existingOrder.set_time_type(status.time_type());
        existingOrder.set_current_volume(status.current_volume());
        existingOrder.set_working_volume(status.working_volume());
        existingOrder.set_exchange_order_id(status.exchange_order_id());
        existingOrder.set_status_detail(status.status_detail());

        //  Add these fields if present
        if (status.has_current_limit_price()) {
            *existingOrder.mutable_current_limit_price() = status.current_limit_price();
        }
        if (status.has_new_limit_price()) {
            *existingOrder.mutable_new_limit_price() = status.new_limit_price();
        }
        if (status.has_current_stop_price()) {
            *existingOrder.mutable_current_stop_price() = status.current_stop_price();
        }
        if (status.has_new_stop_price()) {
            *existingOrder.mutable_new_stop_price() = status.new_stop_price();
        }
      

        orders[uniqueId] = existingOrder;
        emit ordersUpdated(orders);
	}


    //debug functions
    void Client::handleOrderUpdateTrade(const t4proto::v1::orderrouting::OrderUpdateTrade& tradeUpdate) {
        QString uniqueId = QString::fromStdString(tradeUpdate.unique_id());
   
        if (!orders.contains(uniqueId)) {
            qWarning() << "Order ID not found:" << uniqueId;
            return;
        }
 
        
        QString execPrice = QString::fromStdString(tradeUpdate.price().value());
        int currVol = tradeUpdate.volume();     // default: 0
        int workVol = tradeUpdate.working_volume();     // default: 0

        emit orderRevised(
            uniqueId,
            currVol,
            workVol,
            execPrice
        );
    }

    void Client::handleOrderUpdateTradeLeg(const t4proto::v1::orderrouting::OrderUpdateTradeLeg& legUpdate) {
        qDebug() << "Trade leg update:"
            << QString::fromStdString(legUpdate.unique_id())
            << ", leg index:"
            << legUpdate.leg_index();
    }

    void Client::handleOrderUpdateFailed(const t4proto::v1::orderrouting::OrderUpdateFailed& failedUpdate) {
        qDebug() << "Order failed:"
            << QString::fromStdString(failedUpdate.unique_id())
            << ", status:"
            << QString::fromStdString(failedUpdate.status_detail());
    }

    
    void Client::handleOrderUpdateMulti(const t4proto::v1::orderrouting::OrderUpdateMulti& multiUpdate) {
        int updatesProcessed = 0;

        for (const auto& update : multiUpdate.updates()) {
            if (update.has_order_update()) {
                updatesProcessed++;
                handleOrderUpdate(update.order_update());
            }
            else if (update.has_order_update_status()) {
                updatesProcessed++;
                handleOrderUpdateStatus(update.order_update_status());
            }
            else if (update.has_order_update_trade()) {
                updatesProcessed++;
                handleOrderUpdateTrade(update.order_update_trade());
            }
            else if (update.has_order_update_trade_leg()) {
                updatesProcessed++;
                handleOrderUpdateTradeLeg(update.order_update_trade_leg());
            }
            else if (update.has_order_update_failed()) {
                updatesProcessed++;
                handleOrderUpdateFailed(update.order_update_failed());
            }
            else {
                qWarning() << "[OrderUpdateMulti] Unknown update type in message";
            }
        }

        if (updatesProcessed != multiUpdate.updates_size()) {
            qWarning() << "[OrderUpdateMulti] Mismatch: expected"
                << multiUpdate.updates_size() << "processed" << updatesProcessed;
        }
        else {
            qDebug() << "[OrderUpdateMulti] Processed" << updatesProcessed << "updates";
        }
        
	}
    void Client::submitOrder(const QString& side,
        double volume,
        const QString& price,
        const QString& priceType,
        std::optional<double> takeProfitDollars,
        std::optional<double> stopLossDollars)
    {
        if (currentMarketId.isEmpty()) {
            qDebug() << "No market selected";
            return;
        }
        if (!marketDetails.contains(currentMarketId)) {
            qDebug() << "Market details not found";
            return;
        }
        auto market = marketDetails.value(currentMarketId);


        // Convert price type string to enum
        auto priceTypeVal = (priceType.toLower() == "market")
            ? PriceType::PRICE_TYPE_MARKET
            : PriceType::PRICE_TYPE_LIMIT;

        // Convert buy/sell string to enum
        BuySell buySellValue = (side.toLower() == "buy")
            ? BuySell::BUY_SELL_BUY
            : BuySell::BUY_SELL_SELL;

        // Determine if bracket orders are needed
        bool hasBracketOrders = takeProfitDollars.has_value() || stopLossDollars.has_value();

        OrderLink orderLinkVal = hasBracketOrders
            ? OrderLink::ORDER_LINK_AUTO_OCO
            : OrderLink::ORDER_LINK_NONE;

        // Main order

        OrderSubmit_Order mainOrder;
        mainOrder.set_buy_sell(buySellValue);
        mainOrder.set_price_type(priceTypeVal);
        mainOrder.set_time_type(TimeType::TIME_TYPE_NORMAL);
        mainOrder.set_volume(volume);

        double tickPrice = price.toDouble();
        if (priceTypeVal == PriceType::PRICE_TYPE_LIMIT) {
            Price* limitPrice = new Price();
            limitPrice->set_value(QString::number(tickPrice).toStdString());
            mainOrder.set_allocated_limit_price(limitPrice);
        }

        // Add main order to order list
        std::vector<OrderSubmit_Order> orders;
        orders.push_back(mainOrder);

        // Protection side is opposite of main
        BuySell protectionSide = (buySellValue == BuySell::BUY_SELL_BUY)
            ? BuySell::BUY_SELL_SELL
            : BuySell::BUY_SELL_BUY;
        
        //// Take profit
        if (takeProfitDollars.has_value()) {
            double pointValue = std::stod(market.point_value().value());
            double minTick = std::stod(market.min_price_increment().value());

            double points = takeProfitDollars.value() / pointValue;
            double tpPrice = points * minTick;

            OrderSubmit_Order tpOrder;
            tpOrder.set_buy_sell(protectionSide);
            tpOrder.set_price_type(PriceType::PRICE_TYPE_LIMIT);
            tpOrder.set_time_type(TimeType::TIME_TYPE_GOOD_TILL_CANCELLED);
            tpOrder.set_volume(0);
            tpOrder.set_activation_type(ActivationType::ACTIVATION_TYPE_HOLD);

            Price* tpLimit = new Price();
            tpLimit->set_value(QString::number(tpPrice).toStdString());
            tpOrder.set_allocated_limit_price(tpLimit);

            orders.push_back(tpOrder);
        }

        //// Stop loss
        if (stopLossDollars.has_value()) {
            double pointValue = std::stod(market.point_value().value());
            double minTick = std::stod(market.min_price_increment().value());

            double points = stopLossDollars.value() / pointValue;
            double slPrice = points * minTick;

            OrderSubmit_Order slOrder;
            slOrder.set_buy_sell(protectionSide);
            slOrder.set_price_type(PriceType::PRICE_TYPE_STOP_MARKET);
            slOrder.set_time_type(TimeType::TIME_TYPE_GOOD_TILL_CANCELLED);
            slOrder.set_volume(0);
            slOrder.set_activation_type(ActivationType::ACTIVATION_TYPE_HOLD);

            Price* stopPrice = new Price();
            stopPrice->set_value(QString::number(slPrice).toStdString());
            slOrder.set_allocated_stop_price(stopPrice);

            orders.push_back(slOrder);
        }

        //// Compose final OrderSubmit message
        OrderSubmit orderSubmit;
        orderSubmit.set_account_id(selectedAccount.toStdString());
        orderSubmit.set_market_id(currentMarketId.toStdString());
        orderSubmit.set_order_link(orderLinkVal);
        orderSubmit.set_manual_order_indicator(true);

        for (const auto& ord : orders) {
            *orderSubmit.add_orders() = ord;
        }

        //// Send it
        ClientMessage orderMessage;
        orderMessage.mutable_order_submit()->CopyFrom(orderSubmit);
        std::string serializedOrder = orderMessage.SerializeAsString();
        qDebug().noquote() << QString::fromStdString(orderMessage.DebugString());
        sendMessage(serializedOrder);
        

       
        // Console logs
        QString sideText = (buySellValue == BuySell::BUY_SELL_BUY) ? "Buy" : "Sell";
        QString priceText = (priceTypeVal == PriceType::PRICE_TYPE_MARKET) ? "Market" : price;
        qDebug() << "Order submitted:" << sideText << volume << "@" << priceText << "(Type:" << priceType << ")";

        if (takeProfitDollars.has_value()) {
            QString tpSide = (protectionSide == BuySell::BUY_SELL_BUY) ? "Buy" : "Sell";
            qDebug() << "Take profit: $" << takeProfitDollars.value() << "(" << tpSide << ")";
        }

        if (stopLossDollars.has_value()) {
            QString slSide = (protectionSide == BuySell::BUY_SELL_BUY) ? "Buy" : "Sell";
            qDebug() << "Stop loss: $" << stopLossDollars.value() << "(" << slSide << ")";
        }

        if (hasBracketOrders) {
            qDebug() << "OCO (One Cancels Other) bracket order applied";
        }
    }

    void Client::pullOrder(const QString& orderId) {
        // Check if the order exists
        if (!orders.contains(orderId)) {
            qDebug() << "Order ID not found:" << orderId;
            return;
        }
        // Create the pull request
        OrderPull pullRequest;
        pullRequest.set_account_id(selectedAccount.toStdString());
        pullRequest.set_market_id(currentMarketId.toStdString());
        pullRequest.set_manual_order_indicator(true);

        // Add a pull object to the request
        auto* pull = pullRequest.add_pulls();
        pull->set_unique_id(orderId.toStdString());

        ClientMessage messagePull;
        messagePull.mutable_order_pull()->CopyFrom(pullRequest);
        std::string serializedMessage = messagePull.SerializeAsString();
        // Send the pull request
		sendMessage(serializedMessage);
        qDebug() << "Pull request sent for order ID:" << orderId;
            // Optionally, remove the order from local cache
   
            
	}

    void Client::reviseOrder(const QString& orderId, int volume, double price, const QString& priceType) {
        if (selectedAccount.isEmpty()) {
            qDebug() << "No selected account (revise order)";
            return;
        }



        // Create the revision message
        OrderRevise_Revise revise;
        revise.set_unique_id(orderId.toStdString());
        revise.set_volume(volume);
        if (priceType == "limit" && price >= 0) {
            auto* limitPrice = new Price();
            limitPrice->set_value(QString::number(price).toStdString());
            revise.set_allocated_limit_price(limitPrice);
        }
        else {
            revise.clear_limit_price();  // just in case
        }



        // Create the top-level OrderRevise message
        OrderRevise reviseRequest;
        reviseRequest.set_account_id(selectedAccount.toStdString());
        reviseRequest.set_market_id(currentMarketId.toStdString());
        reviseRequest.set_manual_order_indicator(true);
        reviseRequest.add_revisions()->CopyFrom(revise);

        // Wrap in ClientMessage
        ClientMessage message;
        message.mutable_order_revise()->CopyFrom(reviseRequest);

        std::string serialized = message.SerializeAsString();
        sendMessage(serialized);

        qDebug() << "Order revised:" << orderId
            << "- new vol:" << volume
            << "- new price:" << price;
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
             else if (msg.has_account_snapshot()) {
                 
                 handleAccountSnapshot(msg.account_snapshot());
             }
            else if (msg.has_account_position()) {
               
				handleAccountPosition(msg.account_position());

            }
            else if (msg.has_market_details()) {
				handleMarketDetails(msg.market_details());

            }
            else if (msg.has_market_snapshot()) {
				handleMarketSnapshot(msg.market_snapshot());

            }
            else if (msg.has_account_position_profit()) {
                
				handleAccountPositionProfit(msg.account_position_profit());
            }
            else if (msg.has_market_depth()) {
				handleMarketDepth(msg.market_depth());

            }
            else if (msg.has_order_update_multi()) {
				handleOrderUpdateMulti(msg.order_update_multi());

            }
            else if (msg.has_order_update()) {
				handleOrderUpdate(msg.order_update());

            }
            else if (msg.has_heartbeat()) {
                qDebug() << "heart beat received";
            }

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
		query.addQueryItem("contractid", mdContractId);
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
            qWarning() << "[market_expiry] Network error:" << reply->errorString();
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
