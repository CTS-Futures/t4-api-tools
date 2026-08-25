/**
 * Market By Order book.
 *
 * Maintains the per-order book from MarketByOrderSnapshot / MarketByOrderUpdate
 * messages, aggregated into price levels so best bid / best offer can be read off
 * cheaply. Ported from
 * T4WebApiService/T4WebSocketAPIDemo/Services/MarketData/MarketByOrder.cs, with two
 * simplifications for the demo: the book is mutated in place rather than rebuilt
 * immutably, and sequence gaps are not tracked.
 *
 * Orders are keyed by orderId as a string because the wire type is uint64, which
 * protobuf.js surfaces as a Long object rather than a number.
 */
class MarketByOrderBook {
    constructor(marketId) {
        this.marketId = marketId || '';
        this.mode = 0;
        this.lastUpdateTime = null;

        // orderId (string) -> { orderId, bidOffer, price, priceValue, volume }
        this.orders = new Map();

        // priceValue (number) -> { price, volume, orderCount }
        this.bids = new Map();
        this.offers = new Map();

        // Last trade seen for this market, from MarketByOrderTrade.
        this.lastTradePrice = null;
        this.lastTradeVolume = 0;
    }

    get orderCount() {
        return this.orders.size;
    }

    clear() {
        this.orders.clear();
        this.bids.clear();
        this.offers.clear();
    }

    // Replaces the whole book with the contents of a snapshot.
    processSnapshot(snapshot) {
        this.clear();

        this.marketId = snapshot.marketId;
        this.mode = snapshot.mode;
        this.lastUpdateTime = snapshot.time;

        (snapshot.orders || []).forEach(order => this.addOrder(order));
    }

    // Applies an incremental update. Update types are ADD_OR_UPDATE (0),
    // DELETE (1) and CLEAR (2).
    processUpdate(update) {
        this.marketId = update.marketId;
        this.mode = update.mode;
        this.lastUpdateTime = update.time;

        const UpdateType = T4Proto.t4proto.v1.market.MarketByOrderUpdate.UpdateType;

        (update.updates || []).forEach(entry => {
            switch (entry.updateType) {
                case UpdateType.UPDATE_TYPE_ADD_OR_UPDATE:
                    // Remove first so a price or side change vacates the old level.
                    this.removeOrder(entry.orderId);
                    this.addOrder(entry);
                    break;

                case UpdateType.UPDATE_TYPE_DELETE:
                    this.removeOrder(entry.orderId);
                    break;

                case UpdateType.UPDATE_TYPE_CLEAR:
                    this.clear();
                    break;
            }
        });
    }

    processTrade(trade) {
        this.marketId = trade.marketId;
        this.lastUpdateTime = trade.time;
        this.lastTradePrice = trade.tradePrice;
        this.lastTradeVolume = trade.tradeVolume;
    }

    // Adds an order from either a snapshot Order or an update Update — both carry
    // orderId, bidOffer, price and volume.
    addOrder(source) {
        const levels = this.getLevels(source.bidOffer);
        if (!levels) {
            return;
        }

        const order = {
            orderId: String(source.orderId),
            bidOffer: source.bidOffer,
            price: source.price,
            priceValue: MarketByOrderBook.toPriceValue(source.price),
            volume: source.volume || 0
        };

        if (order.priceValue === null) {
            return;
        }

        this.orders.set(order.orderId, order);

        const level = levels.get(order.priceValue);
        if (level) {
            level.volume += order.volume;
            level.orderCount += 1;
        } else {
            levels.set(order.priceValue, {
                price: order.price,
                volume: order.volume,
                orderCount: 1
            });
        }
    }

    // Removes an order using the side and price it is currently booked at, which
    // may differ from what a later update carries.
    removeOrder(orderId) {
        const key = String(orderId);
        const order = this.orders.get(key);
        if (!order) {
            return;
        }

        this.orders.delete(key);

        const levels = this.getLevels(order.bidOffer);
        if (!levels) {
            return;
        }

        const level = levels.get(order.priceValue);
        if (!level) {
            return;
        }

        level.volume -= order.volume;
        level.orderCount -= 1;

        if (level.orderCount <= 0) {
            levels.delete(order.priceValue);
        }
    }

    getLevels(bidOffer) {
        const BidOffer = T4Proto.t4proto.v1.common.BidOffer;

        if (bidOffer === BidOffer.BID_OFFER_BID) {
            return this.bids;
        }
        if (bidOffer === BidOffer.BID_OFFER_OFFER) {
            return this.offers;
        }
        return null;
    }

    // Highest bid level, or null when there are no bids.
    get bestBid() {
        return this.bestLevel(this.bids, (candidate, best) => candidate > best);
    }

    // Lowest offer level, or null when there are no offers.
    get bestOffer() {
        return this.bestLevel(this.offers, (candidate, best) => candidate < best);
    }

    // Price levels are few enough that scanning beats maintaining a sorted structure.
    bestLevel(levels, isBetter) {
        let bestPriceValue = null;
        let bestLevel = null;

        levels.forEach((level, priceValue) => {
            if (bestPriceValue === null || isBetter(priceValue, bestPriceValue)) {
                bestPriceValue = priceValue;
                bestLevel = level;
            }
        });

        return bestLevel;
    }

    // Price.value is a string in whichever PriceFormat was requested at login.
    // All three formats (Decimal, Real, ClearingDecimal) are plain numeric strings,
    // so parseFloat is safe for ordering.
    static toPriceValue(price) {
        if (!price || price.value === undefined || price.value === null) {
            return null;
        }

        const value = parseFloat(price.value);
        return Number.isNaN(value) ? null : value;
    }

    // Formats a level as "volume@price", matching how market depth is displayed.
    static formatLevel(level) {
        return level ? `${level.volume}@${level.price.value}` : '-';
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MarketByOrderBook;
}
