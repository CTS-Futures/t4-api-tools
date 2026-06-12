/**
 * Port of `com.t4login.definitions.chartdata.ChartFormat`.
 *
 * Trade-flag bits, CTAG_* record tag constants, and `getBarStartTime` which
 * truncates a tick value (or NDateTime) to the start of a bar boundary for
 * a given aggregation type.
 */

import { NDateTime } from '../../datetime/NDateTime.js';
import { Day, Hour, Minute, Second, TPO } from './ChartDataType.js';

// --- Trade attribute bits ----------------------------------------------------
export const NONE = 0;
export const TRADE_DUE_TO_SPREAD = 1;
export const TRADE_AT_BID = 2;
export const TRADE_AT_OFFER = 4;

export const NO_CACHE = 1;

// --- Binary format version ---------------------------------------------------
export const CVAL_T4BIN_VERSION = 1;

// --- Stream framing tags -----------------------------------------------------
export const CTAG_SOF = 1;
export const CTAG_MARKET_DEFINITION = 2;
export const CTAG_CONSOLIDATED = 7;
export const CTAG_MARKET_SWITCH = 8;
export const CTAG_MARKET_KEY = 9;

// --- Tick / trade tags -------------------------------------------------------
export const CTAG_TICKDATAPOINT_7BIT = 11;
export const CTAG_TICKDATAPOINT_NEG_7BIT = 12;
export const CTAG_TICKDATAPOINT_ALT_7BIT = 17;
export const CTAG_TICKDATAPOINT_ALT_NEG_7BIT = 18;
export const CTAG_TICKCHANGEDATAPOINT_7BIT = 14;
export const CTAG_TICKCHANGEDATAPOINT_NEG_7BIT = 15;

// --- Bar tags ----------------------------------------------------------------
export const CTAG_BARDATAPOINT_7BIT_DELTA_LOW = 21;
export const CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW = 22;

// --- TPO tags ----------------------------------------------------------------
export const CTAG_TPO_START = 30;
export const CTAG_TPO_START_NEGBASE = 31;
export const CTAG_TPO_DATAPOINT = 32;
export const CTAG_TPO_DATAPOINT_OPEN = 33;
export const CTAG_TPO_DATAPOINT_CLOSE = 34;
export const CTAG_TPO_DATAPOINT_OPENCLOSE = 35;

// --- Quote (BBO) tags --------------------------------------------------------
export const CTAG_QUOTE_7BIT = 50;
export const CTAG_QUOTE_NEG_7BIT = 51;
export const CTAG_QUOTE_VOLUME_DELTA = 52;
export const CTAG_QUOTE_PRICE = 53;
export const CTAG_QUOTE_PRICE_DEC = 54;

// --- Absolute trade-price tags (increment-based) -----------------------------
export const CTAG_TRADE_PRICE = 60;
export const CTAG_TRADE_PRICE_DEC = 61;
export const CTAG_TRADE_PRICE_ALT = 62;
export const CTAG_TRADE_PRICE_DEC_ALT = 63;

// --- Bar-price tags (increment-based) ----------------------------------------
export const CTAG_BAR_PRICE = 65;
export const CTAG_BAR_PRICE_DEC = 66;

// --- Market state / session events -------------------------------------------
export const CTAG_MARKET_MODE = 100;
export const CTAG_MARKET_SETTLEMENT = 101;
export const CTAG_MARKET_HELD_SETTLEMENT = 102;
export const CTAG_MARKET_CLEARED_VOLUME = 103;
export const CTAG_MARKET_OPEN_INTEREST = 104;
export const CTAG_MARKET_VWAP = 105;
export const CTAG_MARKET_RFQ = 106;

// --- Increment-based settlement / VWAP ---------------------------------------
export const CTAG_SETTLEMENT_PRICE = 107;
export const CTAG_HELD_SETTLEMENT_PRICE = 108;
export const CTAG_VWAP_PRICE = 109;

// --- Price-change tags (TickChange aggregation) ------------------------------
export const CTAG_PRICE_CHANGE = 140;
export const CTAG_PRICE_CHANGE_DEC = 141;

// --- TPO price tags (increment-based) ----------------------------------------
export const CTAG_TPO_START_PRICE = 190;
export const CTAG_TPO_START_PRICE_DEC = 191;
export const CTAG_TPO_PRICE = 192;
export const CTAG_TPO_OPEN_PRICE = 193;
export const CTAG_TPO_CLOSE_PRICE = 194;
export const CTAG_TPO_OPENCLOSE_PRICE = 195;

// --- Bar start-time truncation ----------------------------------------------

/**
 * Truncate a time value to the start of a bar boundary for the given
 * aggregation type. Accepts `time` as NDateTime or bigint ticks; returns the
 * same kind that was passed in.
 *
 * @param {NDateTime | bigint} time
 * @param {NDateTime | bigint} tradeDate
 * @param {import('./ChartDataType.js').ChartDataType} dataType
 */
export function getBarStartTime(time, tradeDate, dataType) {
  if (typeof time === 'bigint') {
    const tdTicks = typeof tradeDate === 'bigint' ? tradeDate : tradeDate.ticks;
    return _ticks(time, tdTicks, dataType);
  }
  const td = tradeDate instanceof NDateTime ? tradeDate : new NDateTime(tradeDate);
  return _ndt(time, td, dataType);
}

function _ndt(time, tradeDate, dataType) {
  if (dataType.equals(Second)) {
    return new NDateTime(time.year, time.month, time.day, time.hour, time.minute, time.second, 0);
  }
  if (dataType.equals(Minute) || dataType.equals(TPO)) {
    return new NDateTime(time.year, time.month, time.day, time.hour, time.minute, 0, 0);
  }
  if (dataType.equals(Hour)) {
    return new NDateTime(time.year, time.month, time.day, time.hour, 0, 0, 0);
  }
  if (dataType.equals(Day)) return tradeDate;
  return time;
}

function _ticks(timeTicks, tradeDateTicks, dataType) {
  if (dataType.equals(Second)) {
    const t = new NDateTime(timeTicks);
    return new NDateTime(t.year, t.month, t.day, t.hour, t.minute, t.second, 0).ticks;
  }
  if (dataType.equals(Minute) || dataType.equals(TPO)) {
    const t = new NDateTime(timeTicks);
    return new NDateTime(t.year, t.month, t.day, t.hour, t.minute, 0, 0).ticks;
  }
  if (dataType.equals(Hour)) {
    const t = new NDateTime(timeTicks);
    return new NDateTime(t.year, t.month, t.day, t.hour, 0, 0, 0).ticks;
  }
  if (dataType.equals(Day)) return tradeDateTicks;
  return timeTicks;
}
