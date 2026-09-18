"""Async WebSocket/REST client for the T4 API v2 demo.

The v2 protocol uses one ``MarketSubscribe`` request, decimal order volumes,
and a single ``OrderUpdate`` message for the order lifecycle. The client keeps
the callback-oriented surface used by the Tk demo and chart tools.
"""

import asyncio
import math
import os
import sys
import time
import uuid

import httpx
import websockets

# Generated bindings are emitted as the top-level ``t4`` package. Keep this
# import path setup in the client as well as in the small helper modules so the
# client can be imported from either the demo directory or a test runner.
_PROTO_ROOT = os.path.join(os.path.dirname(__file__), "proto")
if _PROTO_ROOT not in sys.path:
    sys.path.insert(0, _PROTO_ROOT)

from tools.ClientMessageHelper import ClientMessageHelper
from tools.ProtoUtils import decode_message, encode_message
from t4.v2 import service_pb2
from t4.v2.account import account_pb2
from t4.v2.auth import auth_pb2
from t4.v2.common.enums_pb2 import (
    ActivationType,
    BuySell,
    OrderLink,
    PriceType,
    Quotes,
    TimeType,
)
from t4.v2.common.price_pb2 import Decimal, Price
from t4.v2.market import market_pb2
from t4.v2.orderrouting import orderrouting_pb2


class Client:
    """T4 v2 client used by ``PyDemo`` and its companion chart."""

    def __init__(self, config):
        self.config = config
        websocket_config = config["websocket"]

        self.wsUrl = websocket_config["url"]
        self.apiUrl = websocket_config["api"]
        self.apiKey = websocket_config.get("api_key") or None
        self.firm = websocket_config.get("firm", "")
        self.username = websocket_config.get("username", "")
        self.password = websocket_config.get("password", "")
        self.app_name = websocket_config.get("app_name", "")
        self.app_license = websocket_config.get("app_license", "")
        self.priceFormat = int(websocket_config.get("priceFormat", 2))
        self.auto_subscribe_accounts = bool(
            websocket_config.get("auto_subscribe_accounts", False)
        )

        self.md_exchange_id = websocket_config.get("md_exchange_id", "")
        self.md_contract_id = websocket_config.get("md_contract_id", "")

        self.ws = None
        self.running = False
        self.lastMessage = None
        self.heartbeat_time = 20
        self.login_event = asyncio.Event()
        self.listen_task = None
        self.heartbeat_task = None

        self.accounts = {}
        self.selected_account = None
        self.login_response = None
        self.on_account_update = None

        self.jw_token = None
        self.jw_expiration = None  # milliseconds since epoch
        self.pending_token_request = None
        self.token_resolvers = {}

        self.current_market_id = None
        self.current_subscription = None
        self.market_details = {}
        self.market_snapshots = {}
        self.market_by_order_books = {}
        self.market_update = None
        self.market_header_update = None
        self.on_market_update = None
        self.on_market_switch = None
        self.market_subscription_type = websocket_config.get(
            "subscription_type", "full_order_book"
        )
        if self.market_subscription_type not in {"top_of_book", "full_order_book", "mbo"}:
            self.market_subscription_type = "full_order_book"
        self.market_ticker = bool(websocket_config.get("ticker", False))

        self.orders = {}
        self.positions = {}
        self.account_updates = {}
        self.account_profits = {}
        self.subscribed_accounts = set()
        self.on_trade = None
        self.on_depth = None
        self.on_batch_update = None
        self.pending_batches = {}
        self._last_ttv_by_market = {}
        self._last_trade_key_by_market = {}

    # ------------------------------------------------------------------
    # Connection and framing
    # ------------------------------------------------------------------

    async def connect(self):
        if self.running:
            return

        self.login_event.clear()
        self.ws = await websockets.connect(self.wsUrl)
        self.running = True
        self.listen_task = asyncio.create_task(self.listen())
        self.heartbeat_task = asyncio.create_task(self.send_heartbeat())
        await self.authenticate()

        try:
            await asyncio.wait_for(self.login_event.wait(), timeout=10)
        except asyncio.TimeoutError as exc:
            await self.disconnect()
            raise RuntimeError("Login timed out") from exc

        if self.login_response is None or self.login_response.result != 0:
            await self.disconnect()
            raise RuntimeError("Authentication failed")

    async def disconnect(self):
        self.running = False
        if self.ws is not None:
            await self.ws.close(code=1000, reason="client disconnect")
            self.ws = None

        tasks = [task for task in (self.listen_task, self.heartbeat_task) if task]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.listen_task = None
        self.heartbeat_task = None
        self.selected_account = None
        self.subscribed_accounts.clear()

    async def send_message(self, message):
        if self.ws is None or not self.running:
            raise RuntimeError("WebSocket not connected")
        request = ClientMessageHelper.create_client_message(message)
        self.lastMessage = request
        await self.ws.send(encode_message(request))

    async def listen(self):
        try:
            while self.running and self.ws is not None:
                try:
                    raw = await asyncio.wait_for(self.ws.recv(), timeout=2)
                except asyncio.TimeoutError:
                    continue
                if raw is None:
                    break
                self.process_server_message(raw)
        except asyncio.CancelledError:
            return
        except websockets.exceptions.ConnectionClosed:
            self.running = False
        except Exception as exc:  # noqa: BLE001 - keep the demo loop alive
            print(f"Error while listening: {exc}")
            self.running = False

    async def send_heartbeat(self):
        try:
            while self.running:
                await asyncio.sleep(self.heartbeat_time)
                if self.running:
                    await self.send_message(
                        {"heartbeat": service_pb2.Heartbeat(timestamp=int(time.time() * 1000))}
                    )
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            print(f"Heartbeat stopped: {exc}")

    # ------------------------------------------------------------------
    # Authentication and REST token handling
    # ------------------------------------------------------------------

    async def authenticate(self):
        if self.apiKey:
            login_info = auth_pb2.LoginRequest(api_key=self.apiKey)
        else:
            login_info = auth_pb2.LoginRequest(
                firm=self.firm,
                username=self.username,
                password=self.password,
                app_name=self.app_name,
                app_license=self.app_license,
                price_format=self.priceFormat,
            )
        await self.send_message({"login_request": login_info})

    def handle_login(self, message):
        self.login_response = message
        if message.result != 0:
            print(f"Login failed (result={message.result}): {message.error_message}")
            self.login_event.set()
            return

        if message.HasField("authentication_token"):
            self._store_token(message.authentication_token)

        for account in message.accounts:
            self.accounts[account.account_id] = account

        if self.auto_subscribe_accounts:
            asyncio.create_task(self._subscribe_all_accounts())

        self.login_event.set()
        self._notify({"type": "accounts", "accounts": list(self.accounts.values())})

    async def _subscribe_all_accounts(self):
        await self.send_message(
            {
                "account_subscribe": account_pb2.AccountSubscribe(
                    subscribe=2,
                    subscribe_all_accounts=True,
                    upl_mode=1,
                )
            }
        )

    def _store_token(self, token_message):
        if token_message.HasField("token"):
            self.jw_token = token_message.token
        if token_message.HasField("expire_time"):
            self.jw_expiration = int(token_message.expire_time.seconds) * 1000

    def handle_authentication_token(self, message):
        self._store_token(message)
        request_id = message.request_id
        future = self.token_resolvers.pop(request_id, None)
        if future is not None and not future.done():
            if message.HasField("token"):
                future.set_result(message.token)
            else:
                future.set_exception(RuntimeError(message.fail_message or "Token request failed"))

    async def refresh_token(self):
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.token_resolvers[request_id] = future
        await self.send_message(
            {
                "authentication_token_request": auth_pb2.AuthenticationTokenRequest(
                    request_id=request_id
                )
            }
        )
        try:
            return await asyncio.wait_for(future, timeout=30)
        except Exception:
            self.token_resolvers.pop(request_id, None)
            raise

    async def get_auth_token(self):
        if self.jw_token and self.jw_expiration and self.jw_expiration > time.time() * 1000 + 30_000:
            return self.jw_token
        if self.pending_token_request is None:
            self.pending_token_request = asyncio.create_task(self.refresh_token())
        try:
            return await self.pending_token_request
        finally:
            self.pending_token_request = None

    # ------------------------------------------------------------------
    # Account and market subscriptions
    # ------------------------------------------------------------------

    async def subscribe_account(self, account_id):
        if self.selected_account == account_id:
            return

        if self.selected_account and not self.auto_subscribe_accounts:
            await self.send_message(
                {
                    "account_subscribe": account_pb2.AccountSubscribe(
                        subscribe=0,
                        account_id=[self.selected_account],
                    )
                }
            )
            self.subscribed_accounts.discard(self.selected_account)

        self.selected_account = account_id
        if account_id and not self.auto_subscribe_accounts:
            await self.send_message(
                {
                    "account_subscribe": account_pb2.AccountSubscribe(
                        subscribe=2,
                        account_id=[account_id],
                        upl_mode=1,
                    )
                }
            )
            self.subscribed_accounts.add(account_id)

    async def ensure_accounts_subscribed(self, account_ids):
        if self.auto_subscribe_accounts:
            return
        requested = {account_id for account_id in account_ids if account_id}
        missing = sorted(requested - self.subscribed_accounts)
        if not missing:
            return
        await self.send_message(
            {
                "account_subscribe": account_pb2.AccountSubscribe(
                    subscribe=2,
                    account_id=missing,
                    upl_mode=1,
                )
            }
        )
        self.subscribed_accounts.update(missing)

    async def set_market_subscription(self, subscription_type=None, ticker=None):
        if subscription_type is not None:
            self.market_subscription_type = subscription_type
        if ticker is not None:
            self.market_ticker = bool(ticker)
        previous = self.current_subscription
        if previous:
            await self.unsubscribe_market()
            await self.subscribe_market(
                previous["exchange_id"], previous["contract_id"], previous["market_id"]
            )

    async def set_subscription_type(self, subscription_type):
        """Change the quote depth while preserving the current market/ticker."""
        await self.set_market_subscription(subscription_type=subscription_type)

    async def set_ticker(self, ticker):
        """Toggle standalone MarketTrade messages for the current subscription."""
        await self.set_market_subscription(ticker=ticker)

    async def unsubscribe_market(self):
        if not self.current_subscription:
            return
        subscription = self.current_subscription
        await self.send_message(
            {
                "market_subscribe": market_pb2.MarketSubscribe(
                    exchange_id=subscription["exchange_id"],
                    contract_id=subscription["contract_id"],
                    market_id=subscription["market_id"],
                    quotes=Quotes.QUOTES_NONE,
                )
            }
        )
        self.market_by_order_books.pop(subscription["market_id"], None)
        self.market_snapshots.pop(subscription["market_id"], None)
        self._last_ttv_by_market.pop(subscription["market_id"], None)
        self._last_trade_key_by_market.pop(subscription["market_id"], None)
        self.current_subscription = None

    def _market_quotes(self):
        return {
            "top_of_book": Quotes.QUOTES_TOP_OF_BOOK,
            "full_order_book": Quotes.QUOTES_FULL_ORDER_BOOK,
            "mbo": Quotes.QUOTES_MARKET_BY_ORDER,
        }.get(self.market_subscription_type, Quotes.QUOTES_FULL_ORDER_BOOK)

    async def subscribe_market(self, exchange_id, contract_id, market_id):
        if not market_id:
            raise ValueError("Market id is required")
        if self.on_market_switch:
            self.on_market_switch()
        if self.current_subscription:
            await self.unsubscribe_market()

        self.md_exchange_id = exchange_id
        self.md_contract_id = contract_id
        self.current_market_id = market_id
        self.current_subscription = {
            "exchange_id": exchange_id,
            "contract_id": contract_id,
            "market_id": market_id,
        }
        await self.send_message(
            {
                "market_subscribe": market_pb2.MarketSubscribe(
                    exchange_id=exchange_id,
                    contract_id=contract_id,
                    market_id=market_id,
                    quotes=self._market_quotes(),
                    ticker=self.market_ticker,
                )
            }
        )

    async def get_market_id(self, exchange_id, contract_id):
        headers = {"Content-Type": "application/json"}
        if self.apiKey:
            headers["Authorization"] = f"APIKey {self.apiKey}"
        else:
            headers["Authorization"] = f"Bearer {await self.get_auth_token()}"

        async with httpx.AsyncClient() as rest:
            response = await rest.get(
                f"{self.apiUrl}/markets/picker/firstmarket"
                f"?exchangeid={exchange_id}&contractid={contract_id}",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
        return data.get("marketID") or data.get("marketId")

    # ------------------------------------------------------------------
    # Server message dispatch and market/account state
    # ------------------------------------------------------------------

    def process_server_message(self, raw_message):
        message = decode_message(raw_message)
        self.lastMessage = message
        message_type = message.WhichOneof("payload")
        if not message_type:
            return

        handlers = {
            "login_response": lambda: self.handle_login(message.login_response),
            "authentication_token": lambda: self.handle_authentication_token(message.authentication_token),
            "account_subscribe_response": lambda: self.handle_subscribe_response(message.account_subscribe_response),
            "account_details": lambda: self.handle_account_details(message.account_details),
            "account_position": lambda: self.handle_account_position(message.account_position),
            "account_update": lambda: self.handle_account_update(message.account_update),
            "account_snapshot": lambda: self.handle_account_snapshot(message.account_snapshot),
            "account_profit": lambda: self.handle_account_profit(message.account_profit),
            "account_position_profit": lambda: self.handle_account_position_profit(message.account_position_profit),
            "market_details": lambda: self.handle_market_detail(message.market_details),
            "market_depth": lambda: self.handle_market_depth(message.market_depth),
            "market_trade": lambda: self.handle_market_trade(message.market_trade),
            "market_snapshot": lambda: self.handle_market_snapshot(message.market_snapshot),
            "market_by_order_snapshot": lambda: self.handle_market_by_order_snapshot(message.market_by_order_snapshot),
            "market_by_order_update": lambda: self.handle_market_by_order_update(message.market_by_order_update),
            "market_subscribe_reject": lambda: print(f"Market subscribe rejected: {message.market_subscribe_reject}"),
            "order_update": lambda: self.handle_order_update(message.order_update),
            "order_trade": lambda: self.handle_order_trade(message.order_trade),
            "order_batch_acknowledge": lambda: self.handle_order_batch_acknowledge(message.order_batch_acknowledge),
            "order_batch_reject": lambda: self.handle_order_batch_reject(message.order_batch_reject),
            "margin_inquiry_response": lambda: print(f"Margin inquiry: {message.margin_inquiry_response}"),
        }
        handler = handlers.get(message_type)
        if handler:
            handler()

    def handle_market_detail(self, message):
        self.market_details[message.market_id] = message
        if message.contract_id and message.expiry_date:
            self.update_market_header(message.contract_id, message.expiry_date)

    def handle_market_snapshot(self, message):
        for item in message.messages:
            payload = item.WhichOneof("payload")
            if payload == "market_depth":
                self.handle_market_depth(item.market_depth)
            elif payload == "market_trade":
                self.handle_market_trade(item.market_trade)

    def handle_market_depth(self, message):
        self.market_snapshots[message.market_id] = message
        if self.on_depth:
            self.on_depth(message)

        details = self.market_details.get(message.market_id)
        if details and details.contract_id and details.expiry_date:
            self.update_market_header(details.contract_id, details.expiry_date)

        trade_data = message.trade_data if message.HasField("trade_data") else None
        has_trade = trade_data is not None and trade_data.HasField("last_trade_price")
        best_bid = self._depth_line_text(message.bids)
        best_offer = self._depth_line_text(message.offers)
        last_trade = (
            f"{trade_data.last_trade_volume}@{trade_data.last_trade_price.value}"
            if has_trade
            else "-"
        )
        if has_trade:
            self._emit_trade_tick(
                message.market_id,
                trade_data.last_trade_price.value,
                trade_data.last_trade_volume,
                trade_data.total_traded_volume,
            )

        market_update = {
            "market_id": message.market_id,
            "contract_id": details.contract_id if details else "",
            "exchange_id": details.exchange_id if details else "",
            "expiry_date": details.expiry_date if details else 0,
            "best_bid": best_bid,
            "best_offer": best_offer,
            "last_trade": last_trade,
            "last_trade_price": trade_data.last_trade_price.value if has_trade else None,
            "last_trade_volume": trade_data.last_trade_volume if has_trade else 0,
            "total_traded_volume": trade_data.total_traded_volume if has_trade else 0,
        }
        if self.on_market_update:
            self.on_market_update(market_update)

    def handle_market_trade(self, message):
        if not message.HasField("last_trade_price"):
            return

        self._emit_trade_tick(
            message.market_id,
            message.last_trade_price.value,
            message.last_trade_volume,
            message.total_traded_volume,
        )
        if message.market_id in self.market_by_order_books:
            # MBO trades are delivered as the unified MarketTrade message in v2.
            # Keep the last print on the order book so the market panel continues
            # to move even when no MarketDepth messages are being sent.
            self.market_by_order_books[message.market_id]["last_trade"] = message
            self._publish_market_by_order(message.market_id)
            return

        if self.on_market_update:
            depth = self.market_snapshots.get(message.market_id)
            details = self.market_details.get(message.market_id)
            self.on_market_update(
                {
                    "market_id": message.market_id,
                    "contract_id": details.contract_id if details else "",
                    "exchange_id": details.exchange_id if details else "",
                    "expiry_date": details.expiry_date if details else 0,
                    "best_bid": self._depth_line_text(depth.bids) if depth else "-",
                    "best_offer": self._depth_line_text(depth.offers) if depth else "-",
                    "last_trade": f"{message.last_trade_volume}@{message.last_trade_price.value}",
                    "last_trade_price": message.last_trade_price.value,
                    "last_trade_volume": message.last_trade_volume,
                    "total_traded_volume": message.total_traded_volume,
                }
            )

    def handle_market_by_order_snapshot(self, message):
        book = self._new_market_by_order_book()
        for order in message.orders:
            self._mbo_add_order(book, order)
        book["mode"] = message.mode
        book["time"] = message.time
        book["last_sequence"] = message.last_sequence
        self.market_by_order_books[message.market_id] = book
        self._publish_market_by_order(message.market_id)

    def handle_market_by_order_update(self, message):
        book = self.market_by_order_books.setdefault(
            message.market_id, self._new_market_by_order_book()
        )
        for update in message.updates:
            if update.update_type == 1:  # UPDATE_TYPE_DELETE
                self._mbo_remove_order(book, update.order_id)
            elif update.update_type == 2:  # UPDATE_TYPE_CLEAR
                self._mbo_clear(book)
            else:
                self._mbo_add_order(book, update)
        book["mode"] = message.mode
        book["time"] = message.time
        book["sequence"] = message.sequence
        self._publish_market_by_order(message.market_id)

    @staticmethod
    def _new_market_by_order_book():
        return {
            "orders": {},
            "bids": {},
            "offers": {},
            "last_trade": None,
            "mode": None,
            "time": None,
            "last_sequence": 0,
            "sequence": 0,
        }

    @staticmethod
    def _mbo_clear(book):
        book["orders"].clear()
        book["bids"].clear()
        book["offers"].clear()

    @staticmethod
    def _mbo_levels(book, bid_offer):
        if bid_offer == 1:  # BidOffer.BID_OFFER_BID
            return book["bids"]
        if bid_offer == 2:  # BidOffer.BID_OFFER_OFFER
            return book["offers"]
        return None

    @staticmethod
    def _mbo_price_key(price):
        if price is None or not price.value:
            return None
        try:
            value = float(price.value)
        except (TypeError, ValueError):
            return None
        return value if math.isfinite(value) else None

    def _mbo_remove_order(self, book, order_id):
        order = book["orders"].pop(order_id, None)
        if order is None:
            return

        levels = self._mbo_levels(book, order["bid_offer"])
        if levels is None:
            return
        level = levels.get(order["price_key"])
        if level is None:
            return

        level["volume"] -= order["volume"]
        level["order_count"] -= 1
        if level["order_count"] <= 0:
            levels.pop(order["price_key"], None)

    def _mbo_add_order(self, book, source):
        # ADD_OR_UPDATE can change side or price, so remove the old level first.
        self._mbo_remove_order(book, source.order_id)
        price_key = self._mbo_price_key(source.price)
        levels = self._mbo_levels(book, source.bid_offer)
        if levels is None or price_key is None:
            return

        volume = int(source.volume)
        book["orders"][source.order_id] = {
            "bid_offer": source.bid_offer,
            "price": source.price,
            "price_key": price_key,
            "volume": volume,
        }
        level = levels.get(price_key)
        if level is None:
            levels[price_key] = {
                "price": source.price,
                "volume": volume,
                "order_count": 1,
            }
        else:
            level["volume"] += volume
            level["order_count"] += 1

    @staticmethod
    def _mbo_best_level(levels, reverse=False):
        if not levels:
            return None
        price_key = max(levels) if reverse else min(levels)
        return levels[price_key]

    def _publish_market_by_order(self, market_id):
        book = self.market_by_order_books.get(market_id)
        if book is None:
            return

        details = self.market_details.get(market_id)
        if details and details.contract_id and details.expiry_date:
            self.update_market_header(details.contract_id, details.expiry_date)

        trade = book.get("last_trade")
        has_trade = trade is not None and trade.HasField("last_trade_price")
        if self.on_market_update:
            best_bid = self._mbo_best_level(book["bids"], reverse=True)
            best_offer = self._mbo_best_level(book["offers"])
            self.on_market_update(
                {
                    "market_id": market_id,
                    "contract_id": details.contract_id if details else "",
                    "exchange_id": details.exchange_id if details else "",
                    "expiry_date": details.expiry_date if details else 0,
                    "best_bid": self._mbo_level_text(best_bid),
                    "best_offer": self._mbo_level_text(best_offer),
                    "last_trade": (
                        f"{trade.last_trade_volume}@{trade.last_trade_price.value}"
                        if has_trade
                        else "-"
                    ),
                    "last_trade_price": trade.last_trade_price.value if has_trade else None,
                    "last_trade_volume": trade.last_trade_volume if has_trade else 0,
                    "total_traded_volume": trade.total_traded_volume if has_trade else 0,
                }
            )

    @staticmethod
    def _mbo_level_text(level):
        if level is None:
            return "-"
        return f"{level['volume']}@{level['price'].value}"

    @staticmethod
    def _depth_line_text(lines):
        if not lines:
            return "-"
        return f"{lines[0].volume}@{lines[0].price.value}"

    def handle_account_snapshot(self, message):
        for item in message.messages:
            payload = item.WhichOneof("payload")
            if payload == "account_details":
                self.handle_account_details(item.account_details)
            elif payload == "account_update":
                self.handle_account_update(item.account_update)
            elif payload == "account_position":
                self.handle_account_position(item.account_position)
            elif payload == "market_details":
                self.handle_market_detail(item.market_details)
            elif payload == "order_status":
                self.handle_order_update(item.order_status)

    def handle_account_details(self, message):
        if message.account_id:
            existing = self.accounts.get(message.account_id)
            if existing is not None:
                if message.account_name:
                    existing.account_name = message.account_name
                if message.display_name:
                    existing.display_name = message.display_name
            self._notify({"type": "accounts", "accounts": list(self.accounts.values())})

    def handle_account_position(self, message):
        key = f"{message.account_id}_{message.market_id}"
        existing = self.positions.get(key, {})
        self.positions[key] = {
            "account_id": message.account_id,
            "exchange_id": message.exchange_id,
            "contract_id": message.contract_id,
            "market_id": message.market_id,
            "buys": message.buys,
            "sells": message.sells,
            "working_buys": message.working_buys,
            "working_sells": message.working_sells,
            "net": message.buys - message.sells,
            "average_open_price": self._optional_price(message, "average_open_price"),
            "upl": existing.get("upl", message.overnight_upl),
            "rpl": existing.get("rpl", message.rpl),
            "total_pnl": existing.get("total_pnl", message.overnight_upl + message.rpl),
        }
        self._notify_positions()

    def handle_account_update(self, message):
        if message.account_id:
            self.account_updates[message.account_id] = message
            self.account_profits.setdefault(message.account_id, {}).update(
                {
                    "account_id": message.account_id,
                    "balance": message.balance,
                    "rpl": message.rpl,
                }
            )
        self._notify({"type": "account_update", "account_id": message.account_id})

    def handle_account_profit(self, message):
        profit = self.account_profits.setdefault(message.account_id, {})
        profit.update(
            {
                "account_id": message.account_id,
                "rpl": message.rpl if message.HasField("rpl") else profit.get("rpl", 0.0),
                "upl": message.upl_trade if message.HasField("upl_trade") else message.upl,
                "available_cash": message.available_cash if message.HasField("available_cash") else profit.get("available_cash", 0.0),
            }
        )
        self._notify({"type": "account_profit", "account_id": message.account_id})

    def handle_account_position_profit(self, message):
        key = f"{message.account_id}_{message.market_id}"
        position = self.positions.setdefault(
            key,
            {
                "account_id": message.account_id,
                "exchange_id": message.exchange_id,
                "contract_id": message.contract_id,
                "market_id": message.market_id,
                "buys": 0,
                "sells": 0,
                "working_buys": 0,
                "working_sells": 0,
            },
        )
        position["upl"] = message.upl_trade if message.HasField("upl_trade") else 0.0
        position["rpl"] = message.rpl if message.HasField("rpl") else 0.0
        position["total_pnl"] = position["upl"] + position["rpl"]
        if message.HasField("net"):
            position["net"] = message.net
        self._notify_positions()

    # ------------------------------------------------------------------
    # Order routing and updates
    # ------------------------------------------------------------------

    def handle_subscribe_response(self, message):
        if not message.success:
            print(f"Account subscribe failed: {', '.join(message.errors)}")

    def handle_order_update(self, message):
        self.orders[message.unique_id] = message
        self.trigger_orders_update()

    def handle_order_trade(self, message):
        order = self.orders.get(message.order_id)
        side = getattr(order, "buy_sell", None)
        fill = {
            "type": "fill",
            "market_id": message.market_id,
            "unique_id": message.order_id,
            "price": message.price.value if message.HasField("price") else None,
            "volume": message.volume.value,
            "buy_sell": side,
            "time": message.time.seconds if message.HasField("time") else None,
        }
        self._notify(fill)
        if self.on_trade:
            self.on_trade(fill)

    def trigger_orders_update(self):
        self._notify(
            {
                "type": "orders",
                "orders": [
                    order
                    for order in self.orders.values()
                    if not self.selected_account or order.account_id == self.selected_account
                ],
            }
        )

    async def submit_order(
        self,
        side,
        volume,
        price,
        price_type="limit",
        take_profit_dollars=None,
        stop_loss_dollars=None,
        trailing_stop=False,
        bracket_mode="dollars",
    ):
        if not self.selected_account or not self.current_market_id:
            raise RuntimeError("No account or market selected")
        submission = self.build_order_submit(
            self.selected_account,
            self.current_market_id,
            side,
            volume,
            price,
            price_type,
            take_profit_dollars,
            stop_loss_dollars,
            trailing_stop,
            bracket_mode,
        )
        await self.send_message({"order_submit": submission})

    async def submit_oco_order(self, legs):
        """Submit two or more independent orders linked with true OCO semantics."""
        if not self.selected_account or not self.current_market_id:
            raise RuntimeError("No account or market selected")
        submission = self.build_oco_submit(
            legs, self.selected_account, self.current_market_id
        )
        await self.send_message({"order_submit": submission})

    def build_order_submit(
        self,
        account_id,
        market_id,
        side,
        volume,
        price,
        price_type="limit",
        take_profit_dollars=None,
        stop_loss_dollars=None,
        trailing_stop=False,
        bracket_mode="dollars",
    ):
        details = self.market_details.get(market_id)
        if not account_id or not market_id or details is None:
            raise RuntimeError("No account, market, or market details selected")

        volume_value = float(volume)
        if not math.isfinite(volume_value) or not volume_value > 0:
            raise ValueError("Order volume must be positive")
        buy_sell = self._buy_sell(side)
        price_type_value = self._price_type(price_type)
        if price_type_value != PriceType.PRICE_TYPE_MARKET:
            if price is None or not math.isfinite(float(price)):
                raise ValueError("Limit/stop orders require a finite price")
        has_brackets = take_profit_dollars is not None or stop_loss_dollars is not None
        if bracket_mode == "price" and has_brackets:
            link = OrderLink.ORDER_LINK_AUTO_OCO_P
        elif has_brackets:
            link = OrderLink.ORDER_LINK_AUTO_OCO
        else:
            link = OrderLink.ORDER_LINK_NONE

        main = orderrouting_pb2.OrderSubmit.Order(
            buy_sell=buy_sell,
            price_type=price_type_value,
            time_type=TimeType.TIME_TYPE_NORMAL,
            volume=Decimal(value=self._number_text(volume_value)),
        )
        if price_type_value == PriceType.PRICE_TYPE_LIMIT:
            main.limit_price.CopyFrom(Price(value=self._number_text(price)))
        elif price_type_value == PriceType.PRICE_TYPE_STOP_MARKET:
            main.stop_price.CopyFrom(Price(value=self._number_text(price)))
        orders = [main]
        protection_side = self._opposite_side(buy_sell)
        decimals = details.real_decimals if self.priceFormat else details.decimals
        point_value = float(details.point_value.value or 0)
        if point_value <= 0:
            raise ValueError("Market details have no point value")

        if take_profit_dollars is not None:
            if not math.isfinite(float(take_profit_dollars)):
                raise ValueError("Take-profit value must be finite")
            if bracket_mode == "price":
                tp_price = float(take_profit_dollars)
            else:
                offset = abs(float(take_profit_dollars) / volume_value) / point_value / (10 ** decimals)
                tp_price = offset if buy_sell == BuySell.BUY_SELL_BUY else -offset
            take_profit = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=protection_side,
                price_type=PriceType.PRICE_TYPE_LIMIT,
                time_type=TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                volume=Decimal(value="0"),
                activation_type=ActivationType.ACTIVATION_TYPE_HOLD,
            )
            take_profit.limit_price.CopyFrom(Price(value=self._number_text(tp_price)))
            orders.append(take_profit)

        if stop_loss_dollars is not None:
            if not math.isfinite(float(stop_loss_dollars)):
                raise ValueError("Stop-loss value must be finite")
            if bracket_mode == "price":
                sl_price = float(stop_loss_dollars)
            else:
                offset = abs(float(stop_loss_dollars) / volume_value) / point_value / (10 ** decimals)
                sl_price = -offset if buy_sell == BuySell.BUY_SELL_BUY else offset
            stop_loss = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=protection_side,
                price_type=PriceType.PRICE_TYPE_STOP_MARKET,
                time_type=TimeType.TIME_TYPE_GOOD_TILL_CANCELLED,
                volume=Decimal(value="0"),
                activation_type=ActivationType.ACTIVATION_TYPE_HOLD,
            )
            stop_loss.stop_price.CopyFrom(Price(value=self._number_text(sl_price)))
            if trailing_stop:
                if price is None or not math.isfinite(float(price)):
                    raise ValueError("Trailing stops require an entry price")
                stop_loss.trail_distance.CopyFrom(
                    Price(value=self._number_text(abs(float(price) - sl_price)))
                )
            orders.append(stop_loss)

        return orderrouting_pb2.OrderSubmit(
            account_id=account_id,
            market_id=market_id,
            order_link=link,
            manual_order_indicator=True,
            orders=orders,
        )

    def build_oco_submit(self, legs, account_id=None, market_id=None):
        """Build a true OCO submission from independent live order legs."""
        account_id = account_id or self.selected_account
        market_id = market_id or self.current_market_id
        if not account_id or not market_id:
            raise RuntimeError("No account or market selected")
        if not isinstance(legs, (list, tuple)) or len(legs) < 2:
            raise ValueError("OCO requires at least two legs")

        orders = []
        for index, leg in enumerate(legs, start=1):
            price_type = self._price_type(leg.get("price_type", "limit"))
            volume = float(leg.get("volume"))
            if not math.isfinite(volume) or volume <= 0:
                raise ValueError(f"OCO leg {index}: volume must be positive")

            price = leg.get("price")
            if price_type != PriceType.PRICE_TYPE_MARKET:
                if price is None or not math.isfinite(float(price)):
                    raise ValueError(f"OCO leg {index}: price is required")

            order = orderrouting_pb2.OrderSubmit.Order(
                buy_sell=self._buy_sell(leg.get("side")),
                price_type=price_type,
                time_type=TimeType.TIME_TYPE_NORMAL,
                volume=Decimal(value=self._number_text(volume)),
            )
            if price_type == PriceType.PRICE_TYPE_LIMIT:
                order.limit_price.CopyFrom(Price(value=self._number_text(price)))
            elif price_type == PriceType.PRICE_TYPE_STOP_MARKET:
                order.stop_price.CopyFrom(Price(value=self._number_text(price)))
            orders.append(order)

        return orderrouting_pb2.OrderSubmit(
            account_id=account_id,
            market_id=market_id,
            order_link=OrderLink.ORDER_LINK_OCO,
            manual_order_indicator=True,
            orders=orders,
        )

    async def submit_batch(self, rows, batch_id=None):
        if not rows:
            raise ValueError("No orders provided")
        await self.ensure_accounts_subscribed(
            [row.get("account_id", self.selected_account) for row in rows]
        )
        submissions = [
            self.build_oco_submit(
                row.get("legs", []),
                row.get("account_id", self.selected_account),
                row.get("market_id", self.current_market_id),
            )
            if row.get("is_oco")
            else self.build_order_submit(
                row.get("account_id", self.selected_account),
                row.get("market_id", self.current_market_id),
                row["side"],
                row["volume"],
                row.get("price"),
                row.get("price_type", "limit"),
                row.get("take_profit_dollars"),
                row.get("stop_loss_dollars"),
                row.get("trailing_stop", False),
                row.get("bracket_mode", "dollars"),
            )
            for row in rows
        ]
        batch_id = batch_id or f"b-{int(time.time() * 1000)}"
        self.pending_batches[batch_id] = rows
        await self.send_message(
            {
                "order_batch": orderrouting_pb2.OrderBatch(
                    batch_id=batch_id,
                    submissions=submissions,
                )
            }
        )
        return batch_id

    def handle_order_batch_acknowledge(self, message):
        rows = self.pending_batches.pop(message.batch_id, None)
        event = {
            "type": "batch",
            "status": "acknowledged",
            "batch_id": message.batch_id,
            "batch": rows,
            "message": message,
        }
        if self.on_batch_update:
            self.on_batch_update(event)
        self._notify(event)

    def handle_order_batch_reject(self, message):
        rows = self.pending_batches.pop(message.batch_id, None)
        event = {
            "type": "batch",
            "status": "rejected",
            "batch_id": message.batch_id,
            "batch": rows,
            "message": message,
        }
        if self.on_batch_update:
            self.on_batch_update(event)
        self._notify(event)

    async def pull_order(self, order_id):
        if not self.selected_account:
            raise RuntimeError("No account selected")
        order = self.orders.get(order_id)
        market_id = order.market_id if order is not None and order.market_id else self.current_market_id
        await self.send_message(
            {
                "order_pull": orderrouting_pb2.OrderPull(
                    account_id=self.selected_account,
                    market_id=market_id,
                    manual_order_indicator=True,
                    pulls=[orderrouting_pb2.OrderPull.Pull(unique_id=order_id)],
                )
            }
        )

    async def revise_order(self, order_id, volume, price, price_type="limit"):
        if not self.selected_account:
            raise RuntimeError("No account selected")
        order = self.orders.get(order_id)
        market_id = order.market_id if order is not None and order.market_id else self.current_market_id
        revision = orderrouting_pb2.OrderRevise.Revise(
            unique_id=order_id,
            volume=Decimal(value=self._number_text(volume)),
        )
        price_message = Price(value=self._number_text(price))
        if price_type.lower() == "stop":
            revision.stop_price.CopyFrom(price_message)
        else:
            revision.limit_price.CopyFrom(price_message)
        await self.send_message(
            {
                "order_revise": orderrouting_pb2.OrderRevise(
                    account_id=self.selected_account,
                    market_id=market_id,
                    manual_order_indicator=True,
                    revisions=[revision],
                )
            }
        )

    # ------------------------------------------------------------------
    # Small helpers and callback compatibility
    # ------------------------------------------------------------------

    @staticmethod
    def _number_text(value):
        text = str(value)
        return text.rstrip("0").rstrip(".") if "." in text else text

    @staticmethod
    def _buy_sell(side):
        if isinstance(side, str):
            value = side.lower()
            if value == "buy":
                return BuySell.BUY_SELL_BUY
            if value == "sell":
                return BuySell.BUY_SELL_SELL
            raise ValueError(f"Invalid buy/sell side: {side}")
        numeric = int(side)
        if numeric == 1:
            return BuySell.BUY_SELL_BUY
        if numeric in (-1, 2):
            return BuySell.BUY_SELL_SELL
        raise ValueError(f"Invalid buy/sell side: {side}")

    @staticmethod
    def _opposite_side(side):
        return BuySell.BUY_SELL_SELL if side == BuySell.BUY_SELL_BUY else BuySell.BUY_SELL_BUY

    @staticmethod
    def _price_type(price_type):
        value = str(price_type).lower()
        if value == "market":
            return PriceType.PRICE_TYPE_MARKET
        if value in ("stop", "stop_market"):
            return PriceType.PRICE_TYPE_STOP_MARKET
        return PriceType.PRICE_TYPE_LIMIT

    @staticmethod
    def _optional_price(message, field):
        return getattr(message, field).value if message.HasField(field) else None

    def _notify(self, data):
        if self.on_account_update:
            self.on_account_update(data)

    def _notify_positions(self):
        self._notify(
            {
                "type": "positions",
                "positions": [
                    position
                    for position in self.positions.values()
                    if not self.selected_account or position["account_id"] == self.selected_account
                ],
            }
        )

    def _notify_trade(self, market_id, price, volume, total_volume):
        if self.on_trade:
            self.on_trade(
                {
                    "market_id": market_id,
                    "price": float(price),
                    "volume": volume,
                    "total_traded_volume": total_volume,
                }
            )

    def _emit_trade_tick(self, market_id, price, volume, total_volume):
        """Emit each print once when it arrives via depth and/or MarketTrade."""
        if not self.on_trade:
            return
        try:
            raw_price = float(price)
            trade_volume = float(volume)
            total = int(total_volume) if total_volume is not None else None
        except (TypeError, ValueError):
            return
        if not math.isfinite(raw_price) or not math.isfinite(trade_volume) or trade_volume == 0:
            return

        if total is not None:
            previous = self._last_ttv_by_market.get(market_id)
            if previous is not None and total <= previous:
                return
            self._last_ttv_by_market[market_id] = total
        else:
            key = (raw_price, trade_volume)
            if self._last_trade_key_by_market.get(market_id) == key:
                return
            self._last_trade_key_by_market[market_id] = key

        self._notify_trade(market_id, raw_price, trade_volume, total)

    def update_market_header(self, contract_id, expiry_date):
        expiry = str(expiry_date)[:6]
        month_codes = {
            "01": "F", "02": "G", "03": "H", "04": "J", "05": "K", "06": "M",
            "07": "N", "08": "Q", "09": "U", "10": "V", "11": "X", "12": "Z",
        }
        text = contract_id or ""
        if len(expiry) == 6:
            text += month_codes.get(expiry[4:6], expiry[4:6]) + expiry[2:4]
        if self.market_header_update:
            self.market_header_update(text)
