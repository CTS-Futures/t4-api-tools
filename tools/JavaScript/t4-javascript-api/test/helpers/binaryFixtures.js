/**
 * In-test synthesis of T4Bin / T4BinAggr binary records.
 *
 * Every record is framed `<length:7bit-int> <tag:7bit-int> <payload>` and
 * we re-use the production encoders so any future tweak to the wire format
 * automatically flows into the fixtures.
 *
 * Helpers cover only what the unit tests need:
 *   - aggregated SOF / market-definition / CTAG_BAR records
 *   - non-aggregated SOF / market-definition / CTAG_TRADE_PRICE_DEC records
 */

import {
  encode7BitInt,
  encode7BitLong,
  encodeDecimal,
  Decimal,
} from '../../src/index.js';

import {
  CTAG_BAR,
  CTAG_MARKET_DEFINITION as AGGR_CTAG_MARKET_DEFINITION,
  CTAG_MARKET_SWITCH as AGGR_CTAG_MARKET_SWITCH,
  CTAG_SOF as AGGR_CTAG_SOF,
  CTAG_TRADEDATE_SWITCH,
  CVAL_T4BINAGGR_VERSION,
} from '../../src/definitions/chartdata/ChartFormatAggr.js';

import {
  CTAG_MARKET_DEFINITION as BIN_CTAG_MARKET_DEFINITION,
  CTAG_SOF as BIN_CTAG_SOF,
  CTAG_TRADE_PRICE_DEC,
  CVAL_T4BIN_VERSION,
} from '../../src/definitions/chartdata/ChartFormat.js';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** 4-byte little-endian signed int32. */
function leInt32(v) {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, v, true);
  return buf;
}

/** 8-byte little-endian signed int64 (BigInt). */
function leInt64(v) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(v), true);
  return buf;
}

/** 8-byte little-endian double. */
function leDouble(v) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, v, true);
  return buf;
}

/** UTF-8, length-prefixed by a 7-bit-encoded int. */
function lpString(s) {
  const bytes = new TextEncoder().encode(s);
  return concat(encode7BitInt(bytes.length), bytes);
}

/** UTF-8, length-prefixed by a single byte (read_short_string). */
function shortString(s) {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 255) throw new Error('shortString: too long');
  return concat(Uint8Array.of(bytes.length), bytes);
}

/** Frame a record: `<length:7bit> <body>`. */
function frame(body) {
  return concat(encode7BitInt(body.length), body);
}

// ---------------------------------------------------------------------------
// Aggregated (T4BinAggr) records
// ---------------------------------------------------------------------------

/** Aggregated SOF: `<tag=1> <version:int32 LE>` (body length = 5). */
export function aggrSof() {
  return frame(concat(encode7BitInt(AGGR_CTAG_SOF), leInt32(CVAL_T4BINAGGR_VERSION)));
}

/**
 * Aggregated CTAG_TRADEDATE_SWITCH: `<tag> <ticks:7bit-long>`
 *
 * @param {bigint | number} ticks
 */
export function aggrTradeDateSwitch(ticks) {
  return frame(concat(encode7BitInt(CTAG_TRADEDATE_SWITCH), encode7BitLong(BigInt(ticks))));
}

/**
 * Aggregated CTAG_MARKET_SWITCH: `<tag> <marketId:lp-string>`
 *
 * Flips the active market in the aggregated reader so subsequent records are
 * attributed to it.
 */
export function aggrMarketSwitch(marketId) {
  return frame(concat(encode7BitInt(AGGR_CTAG_MARKET_SWITCH), lpString(marketId)));
}

/**
 * Aggregated CTAG_MARKET_DEFINITION.
 *
 *   <tag> <marketId:lp-string> <numerator:7bit> <denominator:7bit>
 *   <priceCode:lp-string> <tickValue:decimal>
 *   <vpt:lp-string> <minCabPrice:price-n>
 */
export function aggrMarketDefinition({
  marketId,
  numerator,
  denominator,
  priceCode = '',
  tickValue,
  vpt = '',
  minCabPrice = null, // null → 1-byte 0x00 header; otherwise `0x01 + decimal`
} = {}) {
  const tickValueBytes = encodeDecimal(
    tickValue instanceof Decimal ? tickValue : new Decimal(tickValue),
  );
  let minCabBytes;
  if (minCabPrice == null) {
    minCabBytes = Uint8Array.of(0x00);
  } else {
    minCabBytes = concat(
      Uint8Array.of(0x01),
      encodeDecimal(minCabPrice instanceof Decimal ? minCabPrice : new Decimal(minCabPrice)),
    );
  }
  return frame(concat(
    encode7BitInt(AGGR_CTAG_MARKET_DEFINITION),
    lpString(marketId),
    encode7BitInt(numerator),
    encode7BitInt(denominator),
    lpString(priceCode),
    tickValueBytes,
    lpString(vpt),
    minCabBytes,
  ));
}

/**
 * Aggregated CTAG_BAR (absolute decimal prices).
 *
 *   <tag> <time:7bit-long> <closeDelta:7bit-long>
 *   <open:decimal> <high:decimal> <low:decimal> <close:decimal>
 *   <volume:7bit> <vBid:7bit> <vOffer:7bit>
 *   <trades:7bit> <tradesAtBid:7bit> <tradesAtOffer:7bit>
 *
 * @param {object} opts
 * @param {bigint | number} opts.timeTicks
 * @param {bigint | number} opts.closeDeltaTicks
 * @param {Decimal | number | string} opts.openPrice
 * @param {Decimal | number | string} opts.highPrice
 * @param {Decimal | number | string} opts.lowPrice
 * @param {Decimal | number | string} opts.closePrice
 * @param {number} opts.volume
 * @param {number} opts.volumeAtBid
 * @param {number} opts.volumeAtOffer
 * @param {number} opts.trades
 * @param {number} opts.tradesAtBid
 * @param {number} opts.tradesAtOffer
 */
export function aggrBar({
  timeTicks,
  closeDeltaTicks,
  openPrice,
  highPrice,
  lowPrice,
  closePrice,
  volume,
  volumeAtBid,
  volumeAtOffer,
  trades,
  tradesAtBid,
  tradesAtOffer,
}) {
  const dec = (v) => encodeDecimal(v instanceof Decimal ? v : new Decimal(v));
  return frame(concat(
    encode7BitInt(CTAG_BAR),
    encode7BitLong(BigInt(timeTicks)),
    encode7BitLong(BigInt(closeDeltaTicks)),
    dec(openPrice),
    dec(highPrice),
    dec(lowPrice),
    dec(closePrice),
    encode7BitInt(volume),
    encode7BitInt(volumeAtBid),
    encode7BitInt(volumeAtOffer),
    encode7BitInt(trades),
    encode7BitInt(tradesAtBid),
    encode7BitInt(tradesAtOffer),
  ));
}

// ---------------------------------------------------------------------------
// Non-aggregated (T4Bin) records
// ---------------------------------------------------------------------------

/**
 * Non-aggregated SOF: `<tag=1> <version:int32 LE> <tradeDate:int64 LE>`
 *
 * Length-prefix is 13 so the reader takes the "length > 12" branch.
 *
 * @param {bigint | number} tradeDateTicks
 */
export function binSof(tradeDateTicks = 0n) {
  return frame(concat(
    encode7BitInt(BIN_CTAG_SOF),
    leInt32(CVAL_T4BIN_VERSION),
    leInt64(BigInt(tradeDateTicks)),
  ));
}

/**
 * Non-aggregated CTAG_MARKET_DEFINITION.
 *
 *   <tag> <marketId:lp-string>
 *   <numerator:7bit> <denominator:7bit>
 *   <priceCode:lp-string> <tickValue:double-LE>
 *   <vpt:lp-string> <minCabPrice:short-string>   (last two only if body remains)
 *
 * The reader checks `cin.get_count() < length` before reading the trailing
 * VPT/MinCabPrice pair, so callers can omit them by passing `omitVpt: true`.
 */
export function binMarketDefinition({
  marketId,
  numerator,
  denominator,
  priceCode = '',
  tickValue,
  vpt = '',
  minCabPriceStr = '',
  omitVpt = false,
} = {}) {
  const head = concat(
    encode7BitInt(BIN_CTAG_MARKET_DEFINITION),
    lpString(marketId),
    encode7BitInt(numerator),
    encode7BitInt(denominator),
    lpString(priceCode),
    leDouble(tickValue),
  );
  const tail = omitVpt
    ? new Uint8Array(0)
    : concat(lpString(vpt), shortString(minCabPriceStr));
  return frame(concat(head, tail));
}

/**
 * Non-aggregated CTAG_TRADE_PRICE_DEC: a tick with absolute increment price.
 *
 *   <tag> <deltaTicks:7bit-long> <volume:7bit>
 *   <priceIncrements:decimal> <ttvDelta:7bit> <attr:7bit>
 *
 * @param {object} opts
 * @param {bigint | number} opts.deltaTicks
 * @param {number} opts.volume
 * @param {Decimal | number | string} opts.priceIncrements
 * @param {number} [opts.ttvDelta=0]
 * @param {number} [opts.attr=0]    bit 1 = TRADE_AT_BID, bit 2 = TRADE_AT_OFFER
 */
export function binTradePriceDec({
  deltaTicks,
  volume,
  priceIncrements,
  ttvDelta = 0,
  attr = 0,
}) {
  return frame(concat(
    encode7BitInt(CTAG_TRADE_PRICE_DEC),
    encode7BitLong(BigInt(deltaTicks)),
    encode7BitInt(volume),
    encodeDecimal(priceIncrements instanceof Decimal ? priceIncrements : new Decimal(priceIncrements)),
    encode7BitInt(ttvDelta),
    encode7BitInt(attr),
  ));
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export { concat as concatBytes };
