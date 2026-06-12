/**
 * Port of `com.t4login.definitions.chartdata.ChartDataStreamReader`.
 *
 * Reads non-aggregated chart data (T4Bin format — `/chart/tradehistory` with
 * `Accept: application/octet-stream`). Each call to `read()` consumes one
 * record from the stream and mutates the public `state` object.
 *
 * Usage:
 *
 *   const reader = new ChartDataStreamReader({ data, tradeDate, marketId, dataType });
 *   while (reader.read()) {
 *     const s = reader.state;
 *     switch (s.Change) {
 *       case ChartDataChange.Trade:  ...
 *       case ChartDataChange.Quote:  ...
 *     }
 *   }
 */

import { Decimal } from '../../decimal.js';
import { ByteReader } from '../../connection/ByteReader.js';
import { CountingInputStream } from '../../connection/CountingInputStream.js';
import { NDateTime, MinValue as _NDT_MinValue } from '../../datetime/NDateTime.js';
import { BidOffer } from '../BidOffer.js';
import { MarketMode } from '../MarketMode.js';
import { Price } from '../priceconversion/Price.js';
import {
  readDatetime,
  readDouble,
  readInteger,
  readPrice,
  readString,
} from '../../message/reader.js';
import {
  decode7BitInt,
  decode7BitLong,
  decodeDecimal,
} from '../../util/encoding.js';
import { ChartDataChange } from './ChartDataChange.js';
import { ChartDataState } from './ChartDataState.js';
import { Tick as _TickType } from './ChartDataType.js';
import {
  CVAL_T4BIN_VERSION,
  CTAG_BAR_PRICE,
  CTAG_BAR_PRICE_DEC,
  CTAG_BARDATAPOINT_7BIT_DELTA_LOW,
  CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW,
  CTAG_CONSOLIDATED,
  CTAG_HELD_SETTLEMENT_PRICE,
  CTAG_MARKET_CLEARED_VOLUME,
  CTAG_MARKET_DEFINITION,
  CTAG_MARKET_HELD_SETTLEMENT,
  CTAG_MARKET_KEY,
  CTAG_MARKET_MODE,
  CTAG_MARKET_OPEN_INTEREST,
  CTAG_MARKET_RFQ,
  CTAG_MARKET_SETTLEMENT,
  CTAG_MARKET_SWITCH,
  CTAG_MARKET_VWAP,
  CTAG_PRICE_CHANGE,
  CTAG_PRICE_CHANGE_DEC,
  CTAG_QUOTE_7BIT,
  CTAG_QUOTE_NEG_7BIT,
  CTAG_QUOTE_PRICE,
  CTAG_QUOTE_PRICE_DEC,
  CTAG_QUOTE_VOLUME_DELTA,
  CTAG_SETTLEMENT_PRICE,
  CTAG_SOF,
  CTAG_TICKCHANGEDATAPOINT_7BIT,
  CTAG_TICKCHANGEDATAPOINT_NEG_7BIT,
  CTAG_TICKDATAPOINT_7BIT,
  CTAG_TICKDATAPOINT_ALT_7BIT,
  CTAG_TICKDATAPOINT_ALT_NEG_7BIT,
  CTAG_TICKDATAPOINT_NEG_7BIT,
  CTAG_TPO_CLOSE_PRICE,
  CTAG_TPO_DATAPOINT,
  CTAG_TPO_DATAPOINT_CLOSE,
  CTAG_TPO_DATAPOINT_OPEN,
  CTAG_TPO_DATAPOINT_OPENCLOSE,
  CTAG_TPO_OPEN_PRICE,
  CTAG_TPO_OPENCLOSE_PRICE,
  CTAG_TPO_PRICE,
  CTAG_TPO_START,
  CTAG_TPO_START_NEGBASE,
  CTAG_TPO_START_PRICE,
  CTAG_TPO_START_PRICE_DEC,
  CTAG_TRADE_PRICE,
  CTAG_TRADE_PRICE_ALT,
  CTAG_TRADE_PRICE_DEC,
  CTAG_TRADE_PRICE_DEC_ALT,
  CTAG_VWAP_PRICE,
  TRADE_AT_BID,
  TRADE_AT_OFFER,
  TRADE_DUE_TO_SPREAD,
  getBarStartTime,
} from './ChartFormat.js';

// Threshold from the Java/Python reader: any 7-bit "delta time" larger than
// this is interpreted as an absolute tick value rather than a delta.
// Numerically equivalent to a date around the year 1900.
const _ABSOLUTE_TIME_THRESHOLD = 599_266_080_000_000_000n;

export class ChartDataStreamReader {
  static TAG = 'ChartDataStreamReader';

  /**
   * @param {object} opts
   * @param {Uint8Array | ArrayBuffer | ByteReader | null} opts.data
   *   Raw bytes or a pre-built ByteReader (`null` makes the reader a no-op).
   * @param {NDateTime} opts.tradeDate
   * @param {string} opts.marketId
   * @param {import('./ChartDataType.js').ChartDataType} [opts.dataType]
   */
  constructor({ data, tradeDate, marketId, dataType = _TickType }) {
    if (data == null) {
      this._in = null;
    } else if (data instanceof CountingInputStream) {
      this._in = data;
    } else {
      const reader = data instanceof ByteReader ? data : new ByteReader(data);
      this._in = new CountingInputStream(reader);
    }

    this._dataType = dataType;
    /** @type {Map<string, ChartDataState>} */
    this._marketStates = new Map();
    /** @type {Map<number, string>} */
    this._marketKeys = new Map();
    this._isConsolidated = false;
    this._eof = false;
    this._binVersion = CVAL_T4BIN_VERSION;

    this._state = this._getMarketState(marketId);
    this._state.TradeDate = tradeDate;
    this._state.TradeDateTicks = tradeDate.ticks;
    this._state.MarketID = marketId;
  }

  /** @returns {ChartDataState} */
  get state() { return this._state; }

  close() { this._in = null; }

  /** @returns {boolean} */
  read() { return this._readT4Bin(); }

  // ------------------------------------------------------------------
  // Main dispatch
  // ------------------------------------------------------------------

  _readT4Bin() {
    if (this._eof || this._in == null) return false;
    if (this._in.available() === 0) return false;

    const length = decode7BitInt(this._in);
    this._in.resetCount();

    if (length > 0) {
      const tag = decode7BitInt(this._in);
      const s = this._state;
      const stream = this._in;

      switch (tag) {
        case CTAG_CONSOLIDATED:
          this._isConsolidated = true;
          break;

        case CTAG_SOF: {
          if (length > 12) {
            this._binVersion = readInteger(stream);
            s.TradeDate = readDatetime(stream);
            s.TradeDateTicks = s.TradeDate.ticks;
          } else {
            this._binVersion = 0;
            s.TradeDate = readDatetime(stream);
            s.TradeDateTicks = s.TradeDate.ticks;
          }

          this._marketStates.clear();
          const newState = new ChartDataState();
          newState.MarketID = s.MarketID;
          newState.TradeDate = s.TradeDate;
          newState.TradeDateTicks = s.TradeDateTicks;
          this._state = newState;
          this._marketStates.set(this._state.MarketID, this._state);
          this._state.Change = ChartDataChange.TradeDate;
          break;
        }

        case CTAG_MARKET_KEY: {
          const mktKey = decode7BitInt(stream);
          const mktId = readString(stream);
          this._marketKeys.set(mktKey, mktId);
          this._getMarketState(mktId);
          this._state.Change = ChartDataChange.NONE;
          break;
        }

        case CTAG_MARKET_SWITCH: {
          const mktKey = decode7BitInt(stream);
          const mktId = this._marketKeys.get(mktKey) ?? '';
          this._getMarketState(mktId);
          this._state.Change = ChartDataChange.MarketSwitch;
          break;
        }

        case CTAG_MARKET_DEFINITION: {
          const mktId = readString(stream);
          this._getMarketState(mktId);
          const st = this._state;
          st.MarketDefined = true;
          st.Numerator = decode7BitInt(stream);
          st.Denominator = decode7BitInt(stream);
          st.PriceCode = readString(stream);
          st.TickValue = readDouble(stream);

          if (stream.getCount() < length) {
            st.VPT = readString(stream);
            st.MinCabPrice = readPrice(stream);
          }

          st.MinPriceIncrement = null;
          st.PointValue = null;
          st.Change = ChartDataChange.MarketDefinition;
          break;
        }

        // ---------------- Tick / trade tags ----------------

        case CTAG_TICKDATAPOINT_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = s.LastTradePrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            s.OrderVolumes = [];
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TICKDATAPOINT_NEG_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = s.LastTradePrice.subtract(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            s.OrderVolumes = [];
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TRADE_PRICE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastPriceIncrements = s.LastPriceIncrements.add(decodeDecimal(stream));
            s.LastTradePrice = Price.fromIncrements(s, s.LastPriceIncrements);
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            s.OrderVolumes = [];
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TRADE_PRICE_DEC:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = Price.fromIncrements(s, decodeDecimal(stream));
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            s.OrderVolumes = [];
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TICKDATAPOINT_ALT_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = s.LastTradePrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            this._readOrderVolumes();
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TICKDATAPOINT_ALT_NEG_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = s.LastTradePrice.subtract(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            this._readOrderVolumes();
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TRADE_PRICE_ALT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastPriceIncrements = s.LastPriceIncrements.add(decodeDecimal(stream));
            s.LastTradePrice = Price.fromIncrements(s, s.LastPriceIncrements);
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            this._readOrderVolumes();
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        case CTAG_TRADE_PRICE_DEC_ALT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.TradeVolume = decode7BitInt(stream);
            s.LastTradePrice = Price.fromIncrements(s, decodeDecimal(stream));
            s.LastTTV += decode7BitInt(stream);
            this._readTradeAttrs();
            this._readOrderVolumes();
            s.Change = ChartDataChange.Trade;
          } else this._eof = true;
          break;

        // ---------------- Tick-change ----------------

        case CTAG_TICKCHANGEDATAPOINT_7BIT:
          s.BarStartTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarCloseTime = s.BarStartTime + decode7BitLong(stream);
          s.BarClosePrice = s.BarClosePrice.add(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          this._readBarVolumes();
          s.Change = ChartDataChange.TickChange;
          break;

        case CTAG_TICKCHANGEDATAPOINT_NEG_7BIT:
          s.BarStartTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarCloseTime = s.BarStartTime + decode7BitLong(stream);
          s.BarClosePrice = s.BarClosePrice.subtract(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          this._readBarVolumes();
          s.Change = ChartDataChange.TickChange;
          break;

        case CTAG_PRICE_CHANGE:
          s.BarStartTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarCloseTime = s.BarStartTime + decode7BitLong(stream);
          s.BarClosePrice = s.BarClosePrice.add(decodeDecimal(stream));
          this._readBarVolumes();
          s.Change = ChartDataChange.TickChange;
          break;

        case CTAG_PRICE_CHANGE_DEC:
          s.BarStartTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarCloseTime = s.BarStartTime + decode7BitLong(stream);
          s.BarClosePrice = new Price(decodeDecimal(stream));
          this._readBarVolumes();
          s.Change = ChartDataChange.TickChange;
          break;

        // ---------------- Bar (7-bit, delta from low) ----------------

        case CTAG_BARDATAPOINT_7BIT_DELTA_LOW: {
          s.BarCloseTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarStartTime = getBarStartTime(s.BarCloseTime, s.TradeDateTicks, this._dataType);
          const barOpen = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          const barHigh = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          s.BarLowPrice = s.BarLowPrice.add(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          const barClose = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          s.BarVolume = decode7BitInt(stream);
          s.BarOpenPrice = barOpen.add(s.BarLowPrice);
          s.BarHighPrice = barHigh.add(s.BarLowPrice);
          s.BarClosePrice = barClose.add(s.BarLowPrice);
          s.BarBidVolume = decode7BitInt(stream);
          s.BarOfferVolume = decode7BitInt(stream);
          s.BarTrades = decode7BitInt(stream);
          s.BarTradesAtBid = decode7BitInt(stream);
          s.BarTradesAtOffer = decode7BitInt(stream);
          s.Change = ChartDataChange.TradeBar;
          break;
        }

        case CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW: {
          s.BarCloseTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarStartTime = getBarStartTime(s.BarCloseTime, s.TradeDateTicks, this._dataType);
          const barOpen = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          const barHigh = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          s.BarLowPrice = s.BarLowPrice.subtract(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          const barClose = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
          s.BarVolume = decode7BitInt(stream);
          s.BarOpenPrice = barOpen.add(s.BarLowPrice);
          s.BarHighPrice = barHigh.add(s.BarLowPrice);
          s.BarClosePrice = barClose.add(s.BarLowPrice);
          s.BarBidVolume = decode7BitInt(stream);
          s.BarOfferVolume = decode7BitInt(stream);
          s.BarTrades = decode7BitInt(stream);
          s.BarTradesAtBid = decode7BitInt(stream);
          s.BarTradesAtOffer = decode7BitInt(stream);
          s.Change = ChartDataChange.TradeBar;
          break;
        }

        case CTAG_BAR_PRICE: {
          s.BarCloseTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarStartTime = getBarStartTime(s.BarCloseTime, s.TradeDateTicks, this._dataType);
          const openInc = decodeDecimal(stream);
          const highInc = decodeDecimal(stream);
          const lowInc = s.LastBarLowPriceIncrements.add(decodeDecimal(stream));
          s.LastBarLowPriceIncrements = lowInc;
          const closeInc = decodeDecimal(stream);
          s.BarOpenPrice = Price.fromIncrements(s, openInc.add(lowInc));
          s.BarHighPrice = Price.fromIncrements(s, highInc.add(lowInc));
          s.BarLowPrice = Price.fromIncrements(s, lowInc);
          s.BarClosePrice = Price.fromIncrements(s, closeInc.add(lowInc));
          this._readBarVolumes();
          s.Change = ChartDataChange.TradeBar;
          break;
        }

        case CTAG_BAR_PRICE_DEC: {
          s.BarCloseTime = ChartDataStreamReader._getIncrementalTime(
            s.BarCloseTime, decode7BitLong(stream),
          );
          s.BarStartTime = getBarStartTime(s.BarCloseTime, s.TradeDateTicks, this._dataType);
          const openInc = decodeDecimal(stream);
          const highInc = decodeDecimal(stream);
          const lowInc = decodeDecimal(stream);
          const closeInc = decodeDecimal(stream);
          s.BarOpenPrice = Price.fromIncrements(s, openInc);
          s.BarHighPrice = Price.fromIncrements(s, highInc);
          s.BarLowPrice = Price.fromIncrements(s, lowInc);
          s.BarClosePrice = Price.fromIncrements(s, closeInc);
          this._readBarVolumes();
          s.Change = ChartDataChange.TradeBar;
          break;
        }

        // ---------------- TPO ----------------

        case CTAG_TPO_START:
          s.TPOStartTime = ChartDataStreamReader._getIncrementalTime(
            s.TPOStartTime, decode7BitLong(stream),
          );
          s.TPOBasePrice = s.TPOBasePrice.add(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          s.Change = ChartDataChange.NONE;
          break;

        case CTAG_TPO_START_NEGBASE:
          s.TPOStartTime = ChartDataStreamReader._getIncrementalTime(
            s.TPOStartTime, decode7BitLong(stream),
          );
          s.TPOBasePrice = s.TPOBasePrice.subtract(
            Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
          );
          s.Change = ChartDataChange.NONE;
          break;

        case CTAG_TPO_START_PRICE:
          s.TPOStartTime = ChartDataStreamReader._getIncrementalTime(
            s.TPOStartTime, decode7BitLong(stream),
          );
          s.LastTPOBasePriceIncrements = s.LastTPOBasePriceIncrements.add(decodeDecimal(stream));
          s.TPOBasePrice = Price.fromIncrements(s, s.LastTPOBasePriceIncrements);
          s.Change = ChartDataChange.NONE;
          break;

        case CTAG_TPO_START_PRICE_DEC:
          s.TPOStartTime = ChartDataStreamReader._getIncrementalTime(
            s.TPOStartTime, decode7BitLong(stream),
          );
          s.TPOBasePrice = Price.fromIncrements(s, decodeDecimal(stream));
          s.Change = ChartDataChange.NONE;
          break;

        case CTAG_TPO_DATAPOINT:
          this._readTpo({ isOpening: false, isClosing: false });
          break;
        case CTAG_TPO_PRICE:
          this._readTpoPrice({ isOpening: false, isClosing: false });
          break;
        case CTAG_TPO_DATAPOINT_OPEN:
          this._readTpo({ isOpening: true, isClosing: false });
          break;
        case CTAG_TPO_OPEN_PRICE:
          this._readTpoPrice({ isOpening: true, isClosing: false });
          break;
        case CTAG_TPO_DATAPOINT_CLOSE:
          this._readTpo({ isOpening: false, isClosing: true });
          break;
        case CTAG_TPO_CLOSE_PRICE:
          this._readTpoPrice({ isOpening: false, isClosing: true });
          break;
        case CTAG_TPO_DATAPOINT_OPENCLOSE:
          this._readTpo({ isOpening: true, isClosing: true });
          break;
        case CTAG_TPO_OPENCLOSE_PRICE:
          this._readTpoPrice({ isOpening: true, isClosing: true });
          break;

        // ---------------- Quotes ----------------

        case CTAG_QUOTE_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.BidPrice = s.BidPrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.BidRealVolume = decode7BitInt(stream);
            s.BidImpliedVolume = decode7BitInt(stream);
            s.OfferPrice = s.BidPrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.OfferRealVolume = decode7BitInt(stream);
            s.OfferImpliedVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.Quote;
          } else this._eof = true;
          break;

        case CTAG_QUOTE_NEG_7BIT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.BidPrice = s.BidPrice.subtract(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.BidRealVolume = decode7BitInt(stream);
            s.BidImpliedVolume = decode7BitInt(stream);
            s.OfferPrice = s.BidPrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.OfferRealVolume = decode7BitInt(stream);
            s.OfferImpliedVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.Quote;
          } else this._eof = true;
          break;

        case CTAG_QUOTE_PRICE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.LastBidPriceIncrements = s.LastBidPriceIncrements.add(decodeDecimal(stream));
            s.BidPrice = Price.fromIncrements(s, s.LastBidPriceIncrements);
            s.BidRealVolume = decode7BitInt(stream);
            s.BidImpliedVolume = decode7BitInt(stream);
            s.OfferPrice = s.BidPrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.OfferRealVolume = decode7BitInt(stream);
            s.OfferImpliedVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.Quote;
          } else this._eof = true;
          break;

        case CTAG_QUOTE_PRICE_DEC:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.BidPrice = Price.fromIncrements(s, decodeDecimal(stream));
            s.BidRealVolume = decode7BitInt(stream);
            s.BidImpliedVolume = decode7BitInt(stream);
            s.OfferPrice = s.BidPrice.add(
              Price.fromTicks(s, decode7BitInt(stream) * s.Numerator),
            );
            s.OfferRealVolume = decode7BitInt(stream);
            s.OfferImpliedVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.Quote;
          } else this._eof = true;
          break;

        case CTAG_QUOTE_VOLUME_DELTA:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.BidRealVolume = decode7BitInt(stream);
            s.OfferRealVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.Quote;
          } else this._eof = true;
          break;

        // ---------------- Mode / settlement / OI / VWAP / RFQ ----

        case CTAG_MARKET_MODE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.Mode = MarketMode.get(decode7BitInt(stream));
            s.Change = ChartDataChange.MarketMode;
          } else this._eof = true;
          break;

        case CTAG_MARKET_SETTLEMENT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.SettlementPrice = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
            s.Change = ChartDataChange.Settlement;
          } else this._eof = true;
          break;

        case CTAG_SETTLEMENT_PRICE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.SettlementPrice = Price.fromIncrements(s, decodeDecimal(stream));
            s.Change = ChartDataChange.Settlement;
          } else this._eof = true;
          break;

        case CTAG_MARKET_HELD_SETTLEMENT:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.SettlementHeldPrice = Price.fromTicks(s, decode7BitInt(stream) * s.Numerator);
            s.Change = ChartDataChange.HeldSettlement;
          } else this._eof = true;
          break;

        case CTAG_HELD_SETTLEMENT_PRICE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.SettlementHeldPrice = Price.fromIncrements(s, decodeDecimal(stream));
            s.Change = ChartDataChange.HeldSettlement;
          } else this._eof = true;
          break;

        case CTAG_MARKET_CLEARED_VOLUME:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.ClearedVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.ClearedVolume;
          } else this._eof = true;
          break;

        case CTAG_MARKET_OPEN_INTEREST:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            s.OpenInterest = decode7BitInt(stream);
            s.Change = ChartDataChange.OpenInterest;
          } else this._eof = true;
          break;

        case CTAG_MARKET_VWAP:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            const priceTicks = decode7BitInt(stream);
            if (s.MarketDefined) {
              s.VWAP_Price = Price.fromTicks(s, priceTicks);
              s.Change = ChartDataChange.VWAP;
            }
          } else this._eof = true;
          break;

        case CTAG_VWAP_PRICE:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            const inc = decodeDecimal(stream);
            if (s.MarketDefined) {
              s.VWAP_Price = Price.fromIncrements(s, inc);
              s.Change = ChartDataChange.VWAP;
            }
          } else this._eof = true;
          break;

        case CTAG_MARKET_RFQ:
          if (this._incrementTimeTicks(decode7BitLong(stream))) {
            const attr = decode7BitInt(stream);
            if (attr & TRADE_AT_BID) s.RFQBuySell = BidOffer.Bid;
            else if (attr & TRADE_AT_OFFER) s.RFQBuySell = BidOffer.Offer;
            else s.RFQBuySell = BidOffer.Undefined;
            s.RFQVolume = decode7BitInt(stream);
            s.Change = ChartDataChange.RFQ;
          } else this._eof = true;
          break;

        default:
          this._state.Change = ChartDataChange.NONE;
          break;
      }
    }

    // Skip any trailing/unknown bytes within this length-prefixed record.
    const nRead = this._in.getCount();
    if (nRead < length) this._in.skip(length - nRead);

    return !this._eof;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  _readTradeAttrs() {
    const attr = decode7BitInt(this._in);
    this._state.DueToSpread = (attr & TRADE_DUE_TO_SPREAD) !== 0;
    if (attr & TRADE_AT_BID) this._state.AtBidOrOffer = BidOffer.Bid;
    else if (attr & TRADE_AT_OFFER) this._state.AtBidOrOffer = BidOffer.Offer;
    else this._state.AtBidOrOffer = BidOffer.Undefined;
  }

  _readOrderVolumes() {
    const n = decode7BitInt(this._in);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.abs(decode7BitInt(this._in));
    this._state.OrderVolumes = out;
  }

  _readBarVolumes() {
    const s = this._state;
    s.BarVolume = decode7BitInt(this._in);
    s.BarBidVolume = decode7BitInt(this._in);
    s.BarOfferVolume = decode7BitInt(this._in);
    s.BarTrades = decode7BitInt(this._in);
    s.BarTradesAtBid = decode7BitInt(this._in);
    s.BarTradesAtOffer = decode7BitInt(this._in);
  }

  _readTpo({ isOpening, isClosing }) {
    const s = this._state;
    s.TPOPrice = s.TPOBasePrice.add(
      Price.fromTicks(s, decode7BitInt(this._in) * s.Numerator),
    );
    s.TPOVolume = decode7BitInt(this._in);
    s.TPOVolumeAtBid = decode7BitInt(this._in);
    s.TPOVolumeAtOffer = decode7BitInt(this._in);
    s.TPOIsOpening = isOpening;
    s.TPOIsClosing = isClosing;
    s.Change = ChartDataChange.TPO;
  }

  _readTpoPrice({ isOpening, isClosing }) {
    const s = this._state;
    s.TPOPrice = Price.fromIncrements(
      s, s.LastTPOBasePriceIncrements.add(decodeDecimal(this._in)),
    );
    s.TPOVolume = decode7BitInt(this._in);
    s.TPOVolumeAtBid = decode7BitInt(this._in);
    s.TPOVolumeAtOffer = decode7BitInt(this._in);
    s.TPOIsOpening = isOpening;
    s.TPOIsClosing = isClosing;
    s.Change = ChartDataChange.TPO;
  }

  /**
   * @param {string} marketId
   * @returns {ChartDataState}
   */
  _getMarketState(marketId) {
    const current = this._state;
    if (current != null && current.MarketID === marketId) return current;

    let state = this._marketStates.get(marketId);
    if (state == null) {
      const empty = this._marketStates.get('');
      if (empty != null && !this._isConsolidated) {
        this._marketStates.set(marketId, empty);
        state = empty;
      } else if (empty == null) {
        state = new ChartDataState();
        state.MarketID = marketId;
        this._marketStates.set(marketId, state);
      } else {
        empty.MarketID = marketId;
        this._marketStates.set(marketId, empty);
        state = empty;
      }
    }
    this._state = state;
    return state;
  }

  /**
   * Returns the resolved tick value: if `ticks` looks like an absolute date
   * (greater than ~year 1900), use it directly; otherwise treat as delta.
   * @param {bigint} baseTicks
   * @param {bigint} ticks
   * @returns {bigint}
   */
  static _getIncrementalTime(baseTicks, ticks) {
    if (ticks > _ABSOLUTE_TIME_THRESHOLD) return ticks;
    return baseTicks + ticks;
  }

  /**
   * @param {bigint} ticks
   * @returns {boolean}
   */
  _incrementTimeTicks(ticks) {
    this._state.LastTimeTicks = ChartDataStreamReader._getIncrementalTime(
      this._state.LastTimeTicks, ticks,
    );
    return true;
  }
}
