/**
 * Port of `com.t4login.definitions.chartdata.ChartDataStreamReaderAggr`.
 *
 * Reads aggregated chart data (T4BinAggr format — `/chart/barchart`
 * with `Accept: application/octet-stream`) and dispatches each decoded
 * record to the provided handler.
 *
 * Handler interface (any subset is allowed; missing callbacks are skipped):
 *   - onMarketDefinition(marketDefinition)
 *   - onBar(bar)
 *   - onModeChange(marketId, tradeDate, time, mode)
 *   - onSettlement(marketId, tradeDate, time, settlementPrice, held)
 *   - onOpenInterest(marketId, tradeDate, time, openInterest)
 */

import { ByteReader } from '../../connection/ByteReader.js';
import { CountingInputStream } from '../../connection/CountingInputStream.js';
import { NDateTime } from '../../datetime/NDateTime.js';
import { MarketMode } from '../MarketMode.js';
import { Price } from '../priceconversion/Price.js';
import {
  read7BitDatetime,
  readBoolean,
  readInteger,
  readString,
} from '../../message/reader.js';
import {
  decode7BitInt,
  decode7BitLong,
  decodeDecimal,
  decodePrice,
  decodePriceN,
} from '../../util/encoding.js';
import {
  Bar,
  CTAG_BAR,
  CTAG_BAR_DELTA,
  CTAG_MARKET_DEFINITION,
  CTAG_MARKET_MODE,
  CTAG_MARKET_SWITCH,
  CTAG_OPEN_INTEREST,
  CTAG_SETTLEMENT_PRICE,
  CTAG_SOF,
  CTAG_TRADEDATE_SWITCH,
  MarketDefinition,
} from './ChartFormatAggr.js';

export class ChartDataStreamReaderAggr {
  static TAG = 'ChartDataStreamReaderAggr';

  // Java pattern: static-only utility.
  constructor() {
    throw new TypeError('ChartDataStreamReaderAggr is a utility class');
  }

  /**
   * @param {Uint8Array | ArrayBuffer} data
   * @param {object} handler
   */
  static read(data, handler) {
    ChartDataStreamReaderAggr.readStream(new ByteReader(data), handler);
  }

  /**
   * @param {ByteReader | null} reader
   * @param {object | null} handler
   */
  static readStream(reader, handler) {
    if (reader == null || handler == null) return;

    const cin = new CountingInputStream(reader);

    let market = null;
    let tradeDate = new NDateTime(0n);
    let marketId = '';

    while (cin.available() > 0) {
      const length = decode7BitInt(cin);
      cin.resetCount();

      if (length > 0) {
        const tag = decode7BitInt(cin);

        switch (tag) {
          case CTAG_SOF: {
            // Read format version (not currently used)
            readInteger(cin);
            tradeDate = new NDateTime(0n);
            marketId = '';
            break;
          }

          case CTAG_MARKET_DEFINITION: {
            const mktId = readString(cin);
            const numerator = decode7BitInt(cin);
            const denominator = decode7BitInt(cin);
            const priceCode = readString(cin);
            const tickValue = decodeDecimal(cin);
            const vpt = readString(cin);
            const minCabPrice = decodePriceN(cin);

            market = new MarketDefinition({
              MarketID: mktId,
              Numerator: numerator,
              Denominator: denominator,
              PriceCode: priceCode,
              TickValue: tickValue,
              VPT_str: vpt,
              MinCabPrice: minCabPrice,
            });
            handler.onMarketDefinition?.(market);
            break;
          }

          case CTAG_TRADEDATE_SWITCH:
            tradeDate = read7BitDatetime(cin);
            break;

          case CTAG_MARKET_SWITCH:
            marketId = readString(cin);
            break;

          case CTAG_BAR_DELTA: {
            const time = read7BitDatetime(cin);
            const closeTime = new NDateTime(time.ticks + decode7BitLong(cin));

            const openInc = decode7BitInt(cin);
            const highInc = decode7BitInt(cin);
            const lowInc = decode7BitInt(cin);
            const closeInc = decode7BitInt(cin);

            const volume = decode7BitInt(cin);
            const volumeAtBid = decode7BitInt(cin);
            const volumeAtOffer = decode7BitInt(cin);
            const trades = decode7BitInt(cin);
            const tradesAtBid = decode7BitInt(cin);
            const tradesAtOffer = decode7BitInt(cin);

            const bar = new Bar({
              TradeDate: tradeDate,
              Time: time,
              CloseTime: closeTime,
              MarketID: marketId,
              OpenPrice: Price.fromIncrements(market, openInc + lowInc),
              HighPrice: Price.fromIncrements(market, highInc + lowInc),
              LowPrice: Price.fromIncrements(market, lowInc),
              ClosePrice: Price.fromIncrements(market, closeInc + lowInc),
              Volume: volume,
              VolumeAtBid: volumeAtBid,
              VolumeAtOffer: volumeAtOffer,
              Trades: trades,
              TradesAtBid: tradesAtBid,
              TradesAtOffer: tradesAtOffer,
            });
            handler.onBar?.(bar);
            break;
          }

          case CTAG_BAR: {
            const time = read7BitDatetime(cin);
            const closeTime = new NDateTime(time.ticks + decode7BitLong(cin));

            const openPrice = decodePrice(cin);
            const highPrice = decodePrice(cin);
            const lowPrice = decodePrice(cin);
            const closePrice = decodePrice(cin);

            const volume = decode7BitInt(cin);
            const volumeAtBid = decode7BitInt(cin);
            const volumeAtOffer = decode7BitInt(cin);
            const trades = decode7BitInt(cin);
            const tradesAtBid = decode7BitInt(cin);
            const tradesAtOffer = decode7BitInt(cin);

            const bar = new Bar({
              TradeDate: tradeDate,
              Time: time,
              CloseTime: closeTime,
              MarketID: marketId,
              OpenPrice: openPrice,
              HighPrice: highPrice,
              LowPrice: lowPrice,
              ClosePrice: closePrice,
              Volume: volume,
              VolumeAtBid: volumeAtBid,
              VolumeAtOffer: volumeAtOffer,
              Trades: trades,
              TradesAtBid: tradesAtBid,
              TradesAtOffer: tradesAtOffer,
            });
            handler.onBar?.(bar);
            break;
          }

          case CTAG_MARKET_MODE: {
            const time = read7BitDatetime(cin);
            const mode = MarketMode.get(decode7BitInt(cin));
            handler.onModeChange?.(marketId, tradeDate, time, mode);
            break;
          }

          case CTAG_SETTLEMENT_PRICE: {
            const time = read7BitDatetime(cin);
            const settlementPrice = decodePrice(cin);
            const held = readBoolean(cin);
            handler.onSettlement?.(marketId, tradeDate, time, settlementPrice, held);
            break;
          }

          case CTAG_OPEN_INTEREST: {
            const time = read7BitDatetime(cin);
            const openInterest = decode7BitInt(cin);
            handler.onOpenInterest?.(marketId, tradeDate, time, openInterest);
            break;
          }

          default:
            // Unknown tag: trailing bytes are skipped below.
            break;
        }
      }

      const nRead = cin.getCount();
      if (nRead < length) {
        cin.skip(length - nRead);
      }
    }
  }
}
