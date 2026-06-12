/**
 * Port of the static `Message.read*` helpers from
 * `com.t4login.messages.Message` (mirrors .NET BinaryWriter conventions).
 *
 * All readers accept any stream that exposes `readByte()` / `readExact(n)`
 * (ByteReader or CountingInputStream).
 */

import { Decimal, HALF_EVEN } from '../decimal.js';
import { NDateTime } from '../datetime/NDateTime.js';
import { Price, Scale } from '../definitions/priceconversion/Price.js';
import { decode7BitInt, decode7BitLong, decodePriceN } from '../util/encoding.js';

// ---------------------------------------------------------------------------
// Fixed-width primitives (little-endian)
// ---------------------------------------------------------------------------

export function readInteger(stream) {
  const bytes = stream.readExact(4);
  return _view(bytes).getInt32(0, true);
}

export function readLong(stream) {
  const bytes = stream.readExact(8);
  return _view(bytes).getBigInt64(0, true);
}

export function readDouble(stream) {
  const bytes = stream.readExact(8);
  return _view(bytes).getFloat64(0, true);
}

export function readBoolean(stream) {
  return stream.readByte() !== 0;
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const _decoder = new TextDecoder('utf-8');

export function readString(stream) {
  const length = decode7BitInt(stream);
  if (length === 0) return '';
  const bytes = stream.readExact(length);
  return _decoder.decode(bytes);
}

export function readShortString(stream) {
  const length = stream.readByte();
  if (length === 0) return '';
  const bytes = stream.readExact(length);
  return _decoder.decode(bytes);
}

// ---------------------------------------------------------------------------
// DateTime
// ---------------------------------------------------------------------------

export function readDatetime(stream) {
  return new NDateTime(readLong(stream));
}

export function read7BitDatetime(stream) {
  return new NDateTime(decode7BitLong(stream));
}

/**
 * Read a 7-bit-encoded datetime as a delta from `ref`.
 * @param {{readByte(): number, readExact(n: number): Uint8Array}} stream
 * @param {NDateTime} ref
 */
export function read7BitDatetimeDelta(stream, ref) {
  return new NDateTime(decode7BitLong(stream) + ref.ticks);
}

// ---------------------------------------------------------------------------
// 7-bit ints (delegates)
// ---------------------------------------------------------------------------

export function read7BitInteger(stream) { return decode7BitInt(stream); }
export function read7BitLongValue(stream) { return decode7BitLong(stream); }

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * Read a short-string-encoded price; returns null when the string is empty.
 * @returns {Price | null}
 */
export function readPrice(stream) {
  const s = readShortString(stream);
  if (!s) return null;
  const d = new Decimal(s).toDecimalPlaces(Scale, HALF_EVEN);
  return new Price(d);
}

/** Read a 7-bit nullable Price (header + decimal). */
export function read7BitPriceN(stream) {
  return decodePriceN(stream);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
