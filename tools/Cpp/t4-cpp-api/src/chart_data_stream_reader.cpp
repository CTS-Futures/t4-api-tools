#include "t4decoder/chart_data_stream_reader.hpp"

#include "t4decoder/encoding.hpp"
#include "t4decoder/message_reader.hpp"

namespace t4 {

ChartDataStreamReader::ChartDataStreamReader(std::vector<std::uint8_t> data,
                                             NDateTime tradeDate,
                                             std::string marketId,
                                             ChartDataType dataType)
    : data_(std::move(data)),
      byteReader_(data_),
      cin_(byteReader_),
      in_(&cin_),
      dataType_(dataType) {
  getMarketState(marketId);
  state_->TradeDate = tradeDate;
  state_->TradeDateTicks = tradeDate.ticks();
  state_->MarketID = marketId;
}

// Helper: ticks delta -> price using the current market.
static inline Price ticksToPrice(ChartDataState& s, long long ticksDelta) {
  return Price::fromTicks(s, ticksDelta * static_cast<long long>(s.Numerator));
}

bool ChartDataStreamReader::readT4Bin() {
  if (eof_ || in_ == nullptr) return false;
  if (in_->available() == 0) return false;

  std::int32_t length = decode7BitInt(*in_);
  in_->resetCount();

  if (length > 0) {
    std::int32_t tag = decode7BitInt(*in_);
    ChartDataState* s = state_.get();
    CountingInputStream& in = *in_;

    switch (tag) {
      case CTAG_CONSOLIDATED:
        isConsolidated_ = true;
        break;

      case CTAG_SOF: {
        if (length > 12) {
          binVersion_ = readInteger(in);
          s->TradeDate = readDatetime(in);
          s->TradeDateTicks = s->TradeDate.ticks();
        } else {
          binVersion_ = 0;
          s->TradeDate = readDatetime(in);
          s->TradeDateTicks = s->TradeDate.ticks();
        }
        auto ns = std::make_shared<ChartDataState>();
        ns->MarketID = s->MarketID;
        ns->TradeDate = s->TradeDate;
        ns->TradeDateTicks = s->TradeDateTicks;
        marketStates_.clear();
        state_ = ns;
        marketStates_[ns->MarketID] = ns;
        state_->Change = ChartDataChange::TradeDate;
        break;
      }

      case CTAG_MARKET_KEY: {
        int mktKey = decode7BitInt(in);
        std::string mktId = readString(in);
        marketKeys_[mktKey] = mktId;
        getMarketState(mktId);
        state_->Change = ChartDataChange::NONE;
        break;
      }

      case CTAG_MARKET_SWITCH: {
        int mktKey = decode7BitInt(in);
        auto it = marketKeys_.find(mktKey);
        std::string mktId = it != marketKeys_.end() ? it->second : std::string();
        getMarketState(mktId);
        state_->Change = ChartDataChange::MarketSwitch;
        break;
      }

      case CTAG_MARKET_DEFINITION: {
        std::string mktId = readString(in);
        getMarketState(mktId);
        ChartDataState* st = state_.get();
        st->MarketDefined = true;
        st->Numerator = decode7BitInt(in);
        st->Denominator = decode7BitInt(in);
        st->PriceCode = readString(in);
        st->TickValue = readDouble(in);
        if (in.getCount() < static_cast<std::size_t>(length)) {
          st->VPTSpec = readString(in);
          st->MinCabPrice = readPrice(in);
        }
        st->resetConversionCache();
        st->Change = ChartDataChange::MarketDefinition;
        break;
      }

      // ---------------- Tick / trade ----------------
      case CTAG_TICKDATAPOINT_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = s->LastTradePrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          s->OrderVolumes.clear();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TICKDATAPOINT_NEG_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = s->LastTradePrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          s->OrderVolumes.clear();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TRADE_PRICE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastPriceIncrements = s->LastPriceIncrements.add(decodeDecimal(in));
          s->LastTradePrice = Price::fromIncrements(*s, s->LastPriceIncrements);
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          s->OrderVolumes.clear();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TRADE_PRICE_DEC:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = Price::fromIncrements(*s, decodeDecimal(in));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          s->OrderVolumes.clear();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TICKDATAPOINT_ALT_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = s->LastTradePrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          readOrderVolumes();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TICKDATAPOINT_ALT_NEG_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = s->LastTradePrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          readOrderVolumes();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TRADE_PRICE_ALT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastPriceIncrements = s->LastPriceIncrements.add(decodeDecimal(in));
          s->LastTradePrice = Price::fromIncrements(*s, s->LastPriceIncrements);
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          readOrderVolumes();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      case CTAG_TRADE_PRICE_DEC_ALT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->TradeVolume = decode7BitInt(in);
          s->LastTradePrice = Price::fromIncrements(*s, decodeDecimal(in));
          s->LastTTV += decode7BitInt(in);
          readTradeAttrs();
          readOrderVolumes();
          s->Change = ChartDataChange::Trade;
        } else eof_ = true;
        break;

      // ---------------- Tick-change ----------------
      case CTAG_TICKCHANGEDATAPOINT_7BIT:
        s->BarStartTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarCloseTime = s->BarStartTime + decode7BitLong(in);
        s->BarClosePrice = s->BarClosePrice.add(ticksToPrice(*s, decode7BitInt(in)));
        readBarVolumes();
        s->Change = ChartDataChange::TickChange;
        break;

      case CTAG_TICKCHANGEDATAPOINT_NEG_7BIT:
        s->BarStartTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarCloseTime = s->BarStartTime + decode7BitLong(in);
        s->BarClosePrice = s->BarClosePrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
        readBarVolumes();
        s->Change = ChartDataChange::TickChange;
        break;

      case CTAG_PRICE_CHANGE:
        s->BarStartTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarCloseTime = s->BarStartTime + decode7BitLong(in);
        s->BarClosePrice = s->BarClosePrice.addDecimal(decodeDecimal(in));
        readBarVolumes();
        s->Change = ChartDataChange::TickChange;
        break;

      case CTAG_PRICE_CHANGE_DEC:
        s->BarStartTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarCloseTime = s->BarStartTime + decode7BitLong(in);
        s->BarClosePrice = Price(decodeDecimal(in));
        readBarVolumes();
        s->Change = ChartDataChange::TickChange;
        break;

      // ---------------- Bar (7-bit, delta from low) ----------------
      case CTAG_BARDATAPOINT_7BIT_DELTA_LOW: {
        s->BarCloseTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarStartTime = getBarStartTime(s->BarCloseTime, s->TradeDateTicks, dataType_);
        Price barOpen = ticksToPrice(*s, decode7BitInt(in));
        Price barHigh = ticksToPrice(*s, decode7BitInt(in));
        s->BarLowPrice = s->BarLowPrice.add(ticksToPrice(*s, decode7BitInt(in)));
        Price barClose = ticksToPrice(*s, decode7BitInt(in));
        s->BarVolume = decode7BitInt(in);
        s->BarOpenPrice = barOpen.add(s->BarLowPrice);
        s->BarHighPrice = barHigh.add(s->BarLowPrice);
        s->BarClosePrice = barClose.add(s->BarLowPrice);
        s->BarBidVolume = decode7BitInt(in);
        s->BarOfferVolume = decode7BitInt(in);
        s->BarTrades = decode7BitInt(in);
        s->BarTradesAtBid = decode7BitInt(in);
        s->BarTradesAtOffer = decode7BitInt(in);
        s->Change = ChartDataChange::TradeBar;
        break;
      }

      case CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW: {
        s->BarCloseTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarStartTime = getBarStartTime(s->BarCloseTime, s->TradeDateTicks, dataType_);
        Price barOpen = ticksToPrice(*s, decode7BitInt(in));
        Price barHigh = ticksToPrice(*s, decode7BitInt(in));
        s->BarLowPrice = s->BarLowPrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
        Price barClose = ticksToPrice(*s, decode7BitInt(in));
        s->BarVolume = decode7BitInt(in);
        s->BarOpenPrice = barOpen.add(s->BarLowPrice);
        s->BarHighPrice = barHigh.add(s->BarLowPrice);
        s->BarClosePrice = barClose.add(s->BarLowPrice);
        s->BarBidVolume = decode7BitInt(in);
        s->BarOfferVolume = decode7BitInt(in);
        s->BarTrades = decode7BitInt(in);
        s->BarTradesAtBid = decode7BitInt(in);
        s->BarTradesAtOffer = decode7BitInt(in);
        s->Change = ChartDataChange::TradeBar;
        break;
      }

      case CTAG_BAR_PRICE: {
        s->BarCloseTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarStartTime = getBarStartTime(s->BarCloseTime, s->TradeDateTicks, dataType_);
        Decimal openInc = decodeDecimal(in);
        Decimal highInc = decodeDecimal(in);
        Decimal lowInc = s->LastBarLowPriceIncrements.add(decodeDecimal(in));
        s->LastBarLowPriceIncrements = lowInc;
        Decimal closeInc = decodeDecimal(in);
        s->BarOpenPrice = Price::fromIncrements(*s, openInc.add(lowInc));
        s->BarHighPrice = Price::fromIncrements(*s, highInc.add(lowInc));
        s->BarLowPrice = Price::fromIncrements(*s, lowInc);
        s->BarClosePrice = Price::fromIncrements(*s, closeInc.add(lowInc));
        readBarVolumes();
        s->Change = ChartDataChange::TradeBar;
        break;
      }

      case CTAG_BAR_PRICE_DEC: {
        s->BarCloseTime = getIncrementalTime(s->BarCloseTime, decode7BitLong(in));
        s->BarStartTime = getBarStartTime(s->BarCloseTime, s->TradeDateTicks, dataType_);
        Decimal openInc = decodeDecimal(in);
        Decimal highInc = decodeDecimal(in);
        Decimal lowInc = decodeDecimal(in);
        Decimal closeInc = decodeDecimal(in);
        s->BarOpenPrice = Price::fromIncrements(*s, openInc);
        s->BarHighPrice = Price::fromIncrements(*s, highInc);
        s->BarLowPrice = Price::fromIncrements(*s, lowInc);
        s->BarClosePrice = Price::fromIncrements(*s, closeInc);
        readBarVolumes();
        s->Change = ChartDataChange::TradeBar;
        break;
      }

      // ---------------- TPO ----------------
      case CTAG_TPO_START:
        s->TPOStartTime = getIncrementalTime(s->TPOStartTime, decode7BitLong(in));
        s->TPOBasePrice = s->TPOBasePrice.add(ticksToPrice(*s, decode7BitInt(in)));
        s->Change = ChartDataChange::NONE;
        break;

      case CTAG_TPO_START_NEGBASE:
        s->TPOStartTime = getIncrementalTime(s->TPOStartTime, decode7BitLong(in));
        s->TPOBasePrice = s->TPOBasePrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
        s->Change = ChartDataChange::NONE;
        break;

      case CTAG_TPO_START_PRICE:
        s->TPOStartTime = getIncrementalTime(s->TPOStartTime, decode7BitLong(in));
        s->LastTPOBasePriceIncrements = s->LastTPOBasePriceIncrements.add(decodeDecimal(in));
        s->TPOBasePrice = Price::fromIncrements(*s, s->LastTPOBasePriceIncrements);
        s->Change = ChartDataChange::NONE;
        break;

      case CTAG_TPO_START_PRICE_DEC:
        s->TPOStartTime = getIncrementalTime(s->TPOStartTime, decode7BitLong(in));
        s->TPOBasePrice = Price::fromIncrements(*s, decodeDecimal(in));
        s->Change = ChartDataChange::NONE;
        break;

      case CTAG_TPO_DATAPOINT:       readTpo(false, false); break;
      case CTAG_TPO_PRICE:           readTpoPrice(false, false); break;
      case CTAG_TPO_DATAPOINT_OPEN:  readTpo(true, false); break;
      case CTAG_TPO_OPEN_PRICE:      readTpoPrice(true, false); break;
      case CTAG_TPO_DATAPOINT_CLOSE: readTpo(false, true); break;
      case CTAG_TPO_CLOSE_PRICE:     readTpoPrice(false, true); break;
      case CTAG_TPO_DATAPOINT_OPENCLOSE: readTpo(true, true); break;
      case CTAG_TPO_OPENCLOSE_PRICE:     readTpoPrice(true, true); break;

      // ---------------- Quotes ----------------
      case CTAG_QUOTE_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->BidPrice = s->BidPrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->BidRealVolume = decode7BitInt(in);
          s->BidImpliedVolume = decode7BitInt(in);
          s->OfferPrice = s->BidPrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->OfferRealVolume = decode7BitInt(in);
          s->OfferImpliedVolume = decode7BitInt(in);
          s->Change = ChartDataChange::Quote;
        } else eof_ = true;
        break;

      case CTAG_QUOTE_NEG_7BIT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->BidPrice = s->BidPrice.subtract(ticksToPrice(*s, decode7BitInt(in)));
          s->BidRealVolume = decode7BitInt(in);
          s->BidImpliedVolume = decode7BitInt(in);
          s->OfferPrice = s->BidPrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->OfferRealVolume = decode7BitInt(in);
          s->OfferImpliedVolume = decode7BitInt(in);
          s->Change = ChartDataChange::Quote;
        } else eof_ = true;
        break;

      case CTAG_QUOTE_PRICE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->LastBidPriceIncrements = s->LastBidPriceIncrements.add(decodeDecimal(in));
          s->BidPrice = Price::fromIncrements(*s, s->LastBidPriceIncrements);
          s->BidRealVolume = decode7BitInt(in);
          s->BidImpliedVolume = decode7BitInt(in);
          s->OfferPrice = s->BidPrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->OfferRealVolume = decode7BitInt(in);
          s->OfferImpliedVolume = decode7BitInt(in);
          s->Change = ChartDataChange::Quote;
        } else eof_ = true;
        break;

      case CTAG_QUOTE_PRICE_DEC:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->BidPrice = Price::fromIncrements(*s, decodeDecimal(in));
          s->BidRealVolume = decode7BitInt(in);
          s->BidImpliedVolume = decode7BitInt(in);
          s->OfferPrice = s->BidPrice.add(ticksToPrice(*s, decode7BitInt(in)));
          s->OfferRealVolume = decode7BitInt(in);
          s->OfferImpliedVolume = decode7BitInt(in);
          s->Change = ChartDataChange::Quote;
        } else eof_ = true;
        break;

      case CTAG_QUOTE_VOLUME_DELTA:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->BidRealVolume = decode7BitInt(in);
          s->OfferRealVolume = decode7BitInt(in);
          s->Change = ChartDataChange::Quote;
        } else eof_ = true;
        break;

      // ---------------- Mode / settlement / OI / VWAP / RFQ ----------------
      case CTAG_MARKET_MODE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->Mode = marketModeFromInt(decode7BitInt(in));
          s->Change = ChartDataChange::MarketMode;
        } else eof_ = true;
        break;

      case CTAG_MARKET_SETTLEMENT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->SettlementPrice = ticksToPrice(*s, decode7BitInt(in));
          s->Change = ChartDataChange::Settlement;
        } else eof_ = true;
        break;

      case CTAG_SETTLEMENT_PRICE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->SettlementPrice = Price::fromIncrements(*s, decodeDecimal(in));
          s->Change = ChartDataChange::Settlement;
        } else eof_ = true;
        break;

      case CTAG_MARKET_HELD_SETTLEMENT:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->SettlementHeldPrice = ticksToPrice(*s, decode7BitInt(in));
          s->Change = ChartDataChange::HeldSettlement;
        } else eof_ = true;
        break;

      case CTAG_HELD_SETTLEMENT_PRICE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->SettlementHeldPrice = Price::fromIncrements(*s, decodeDecimal(in));
          s->Change = ChartDataChange::HeldSettlement;
        } else eof_ = true;
        break;

      case CTAG_MARKET_CLEARED_VOLUME:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->ClearedVolume = decode7BitInt(in);
          s->Change = ChartDataChange::ClearedVolume;
        } else eof_ = true;
        break;

      case CTAG_MARKET_OPEN_INTEREST:
        if (incrementTimeTicks(decode7BitLong(in))) {
          s->OpenInterest = decode7BitInt(in);
          s->Change = ChartDataChange::OpenInterest;
        } else eof_ = true;
        break;

      case CTAG_MARKET_VWAP:
        if (incrementTimeTicks(decode7BitLong(in))) {
          long long priceTicks = decode7BitInt(in);
          if (s->MarketDefined) {
            s->VWAP_Price = Price::fromTicks(*s, priceTicks);
            s->Change = ChartDataChange::VWAP;
          }
        } else eof_ = true;
        break;

      case CTAG_VWAP_PRICE:
        if (incrementTimeTicks(decode7BitLong(in))) {
          Decimal inc = decodeDecimal(in);
          if (s->MarketDefined) {
            s->VWAP_Price = Price::fromIncrements(*s, inc);
            s->Change = ChartDataChange::VWAP;
          }
        } else eof_ = true;
        break;

      case CTAG_MARKET_RFQ:
        if (incrementTimeTicks(decode7BitLong(in))) {
          int attr = decode7BitInt(in);
          if (attr & TRADE_AT_BID) s->RFQBuySell = BidOffer::Bid;
          else if (attr & TRADE_AT_OFFER) s->RFQBuySell = BidOffer::Offer;
          else s->RFQBuySell = BidOffer::Undefined;
          s->RFQVolume = decode7BitInt(in);
          s->Change = ChartDataChange::RFQ;
        } else eof_ = true;
        break;

      default:
        state_->Change = ChartDataChange::NONE;
        break;
    }
  }

  std::size_t nRead = in_->getCount();
  if (length > 0 && nRead < static_cast<std::size_t>(length)) {
    in_->skip(static_cast<std::size_t>(length) - nRead);
  }
  return !eof_;
}

void ChartDataStreamReader::readTradeAttrs() {
  int attr = decode7BitInt(*in_);
  state_->DueToSpread = (attr & TRADE_DUE_TO_SPREAD) != 0;
  if (attr & TRADE_AT_BID) state_->AtBidOrOffer = BidOffer::Bid;
  else if (attr & TRADE_AT_OFFER) state_->AtBidOrOffer = BidOffer::Offer;
  else state_->AtBidOrOffer = BidOffer::Undefined;
}

void ChartDataStreamReader::readOrderVolumes() {
  int n = decode7BitInt(*in_);
  std::vector<int> out;
  out.reserve(n > 0 ? static_cast<std::size_t>(n) : 0);
  for (int i = 0; i < n; ++i) {
    int v = decode7BitInt(*in_);
    out.push_back(v < 0 ? -v : v);  // historical abs() fix from the Java source
  }
  state_->OrderVolumes = std::move(out);
}

void ChartDataStreamReader::readBarVolumes() {
  ChartDataState* s = state_.get();
  s->BarVolume = decode7BitInt(*in_);
  s->BarBidVolume = decode7BitInt(*in_);
  s->BarOfferVolume = decode7BitInt(*in_);
  s->BarTrades = decode7BitInt(*in_);
  s->BarTradesAtBid = decode7BitInt(*in_);
  s->BarTradesAtOffer = decode7BitInt(*in_);
}

void ChartDataStreamReader::readTpo(bool isOpening, bool isClosing) {
  ChartDataState* s = state_.get();
  s->TPOPrice = s->TPOBasePrice.add(ticksToPrice(*s, decode7BitInt(*in_)));
  s->TPOVolume = decode7BitInt(*in_);
  s->TPOVolumeAtBid = decode7BitInt(*in_);
  s->TPOVolumeAtOffer = decode7BitInt(*in_);
  s->TPOIsOpening = isOpening;
  s->TPOIsClosing = isClosing;
  s->Change = ChartDataChange::TPO;
}

void ChartDataStreamReader::readTpoPrice(bool isOpening, bool isClosing) {
  ChartDataState* s = state_.get();
  s->TPOPrice = Price::fromIncrements(
      *s, s->LastTPOBasePriceIncrements.add(decodeDecimal(*in_)));
  s->TPOVolume = decode7BitInt(*in_);
  s->TPOVolumeAtBid = decode7BitInt(*in_);
  s->TPOVolumeAtOffer = decode7BitInt(*in_);
  s->TPOIsOpening = isOpening;
  s->TPOIsClosing = isClosing;
  s->Change = ChartDataChange::TPO;
}

ChartDataState* ChartDataStreamReader::getMarketState(const std::string& marketId) {
  if (state_ && state_->MarketID == marketId) return state_.get();

  auto it = marketStates_.find(marketId);
  std::shared_ptr<ChartDataState> state;
  if (it != marketStates_.end()) {
    state = it->second;
  } else {
    auto eit = marketStates_.find("");
    std::shared_ptr<ChartDataState> empty =
        eit != marketStates_.end() ? eit->second : nullptr;
    if (empty && !isConsolidated_) {
      marketStates_[marketId] = empty;
      state = empty;
    } else if (!empty) {
      state = std::make_shared<ChartDataState>();
      state->MarketID = marketId;
      marketStates_[marketId] = state;
    } else {
      empty->MarketID = marketId;
      marketStates_[marketId] = empty;
      state = empty;
    }
  }
  state_ = state;
  return state_.get();
}

bool ChartDataStreamReader::incrementTimeTicks(long long ticks) {
  state_->LastTimeTicks = getIncrementalTime(state_->LastTimeTicks, ticks);
  return true;
}

}  // namespace t4
