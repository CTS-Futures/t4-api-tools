/**
 * Public surface of `@t4/chart-decoder`.
 *
 * Import order matters: Price.js registers a factory with util/encoding.js
 * on load, which `decodePrice` / `decodePriceN` rely on. Pulling Price in
 * before the readers ensures the registration runs.
 */

// Core decimal + datetime
export { Decimal, HALF_EVEN, ROUND_CEIL, ROUND_FLOOR } from './decimal.js';
export {
  NDateTime,
  MinValue as NDateTimeMin,
  MaxValue as NDateTimeMax,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MINUTE,
  TICKS_PER_MILLISECOND,
  TICKS_PER_SECOND,
} from './datetime/NDateTime.js';

// Streams
export { ByteReader } from './connection/ByteReader.js';
export { CountingInputStream } from './connection/CountingInputStream.js';

// Encoding primitives
export {
  decode7BitInt,
  decode7BitLong,
  decodeDecimal,
  decodePrice,
  decodePriceN,
  encode7BitInt,
  encode7BitLong,
  encodeDecimal,
} from './util/encoding.js';

// Wire-format helpers
export * as MessageReader from './message/reader.js';

// Domain enums
export { BidOffer } from './definitions/BidOffer.js';
export { MarketMode } from './definitions/MarketMode.js';
export { ChartDataChange } from './definitions/chartdata/ChartDataChange.js';
export {
  ChartDataType,
  Day, Hour, Minute, Second, Tick, TickChange, TPO,
} from './definitions/chartdata/ChartDataType.js';

// Price / VPT (import Price before the readers to register decode factory)
export {
  Price,
  Scale as PriceScale,
  Zero as PriceZero,
  MaxValue as PriceMax,
  MinValue as PriceMin,
  RoundingDirection,
} from './definitions/priceconversion/Price.js';
export { VPT } from './definitions/priceconversion/VPT.js';

// Format constants
export * as ChartFormat from './definitions/chartdata/ChartFormat.js';
export * as ChartFormatAggr from './definitions/chartdata/ChartFormatAggr.js';
export { Bar, MarketDefinition } from './definitions/chartdata/ChartFormatAggr.js';

// State + readers
export { ChartDataState } from './definitions/chartdata/ChartDataState.js';
export { ChartDataStreamReader } from './definitions/chartdata/ChartDataStreamReader.js';
export { ChartDataStreamReaderAggr } from './definitions/chartdata/ChartDataStreamReaderAggr.js';

// HTTP client
export { ChartClient, extractT4BinPayload } from './client/ChartClient.js';
