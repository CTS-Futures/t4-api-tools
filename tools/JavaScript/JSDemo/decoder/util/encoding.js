/**
 * Port of `com.t4login.util.EncodingUtil` (a.k.a. `t4login.util.encoding`).
 *
 * Variable-length 7-bit encoding/decoding for 32-bit ints, 64-bit longs
 * (as BigInt), and the 96-bit unscaled-decimal format.
 *
 * Sign semantics mirror the Java/C# implementation byte-for-byte:
 *   - positive ints encode in 1..5 bytes
 *   - negative ints always encode in 5 bytes
 *   - positive longs encode in 1..9 bytes
 *   - negative longs always encode in 10 bytes
 */

import { Decimal } from '../decimal.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INT32_MAX = 0x7fff_ffff;
const UINT32_MASK = 0xffff_ffff; // safe as Number (< 2^53)

const UINT64_MASK = 0xffff_ffff_ffff_ffffn;
const INT64_MAX = 0x7fff_ffff_ffff_ffffn;
const BIG_2_64 = 1n << 64n;
const BIG_2_63 = 1n << 63n;

// Sentinel: -2^31 has no positive counterpart in two's-complement 32-bit,
// so the decimal codec encodes it as a 2-bit "0x03" header marker
// instead of writing its magnitude.
const INT32_MIN_VALUE = -0x8000_0000;

// ---------------------------------------------------------------------------
// 7-bit int (signed 32-bit)
// ---------------------------------------------------------------------------

/**
 * Encode a signed 32-bit integer.
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encode7BitInt(value) {
  // Mask to 32-bit unsigned.
  let v = (value >>> 0); // Uint32

  if (v <= INT32_MAX) {
    const buf = [];
    while (v >= 0x80) {
      buf.push((v & 0xff) | 0x80);
      v = v >>> 7;
    }
    buf.push(v & 0xff);
    return Uint8Array.from(buf);
  } else {
    // Negative path: 5 fixed bytes with arithmetic shift behaviour.
    // Convert unsigned to signed 32 to simulate Java's signed `>>`.
    let s = v - 0x1_0000_0000; // signed 32
    const buf = new Uint8Array(5);
    buf[0] = (s & 0xff) | 0x80;
    s = s >> 7; // JS `>>` is arithmetic on 32-bit signed
    buf[1] = (s & 0xff) | 0x80;
    s = s >> 7;
    buf[2] = (s & 0xff) | 0x80;
    s = s >> 7;
    buf[3] = (s & 0xff) | 0x80;
    s = s >> 7;
    buf[4] = s & 0x0f;
    return buf;
  }
}

/**
 * Decode a 7-bit-encoded signed 32-bit integer from a stream.
 * @param {{readByte(): number}} stream  CountingInputStream or ByteReader
 * @returns {number}
 */
export function decode7BitInt(stream) {
  let count = 0;
  let shift = 0;
  while (true) {
    const b = stream.readByte();
    count |= (b & 0x7f) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  // Sign-extend from 32-bit. JS bitwise ops already operate on 32-bit
  // signed, so a final `| 0` is sufficient.
  return count | 0;
}

// ---------------------------------------------------------------------------
// 7-bit long (signed 64-bit, BigInt)
// ---------------------------------------------------------------------------

/**
 * Encode a signed 64-bit integer (BigInt).
 * @param {bigint} value
 * @returns {Uint8Array}
 */
export function encode7BitLong(value) {
  let v = BigInt.asUintN(64, value);

  if (v <= INT64_MAX) {
    const buf = [];
    while (v >= 0x80n) {
      buf.push(Number(v & 0xffn) | 0x80);
      v = v >> 7n;
    }
    buf.push(Number(v & 0xffn));
    return Uint8Array.from(buf);
  } else {
    // Negative: 10 fixed bytes.
    let s = v - BIG_2_64; // signed 64
    const buf = new Uint8Array(10);
    for (let i = 0; i < 9; i++) {
      buf[i] = Number(s & 0xffn) | 0x80;
      s = s >> 7n; // BigInt `>>` is arithmetic
    }
    buf[9] = Number(s & 0x0fn);
    return buf;
  }
}

/**
 * Decode a 7-bit-encoded signed 64-bit integer to a BigInt.
 * @param {{readByte(): number}} stream
 * @returns {bigint}
 */
export function decode7BitLong(stream) {
  let count = 0n;
  let shift = 0n;
  while (true) {
    const b = stream.readByte();
    count |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) break;
  }
  // Mask to 64 bits, then sign-extend.
  count = count & UINT64_MASK;
  if (count >= BIG_2_63) count -= BIG_2_64;
  return count;
}

// ---------------------------------------------------------------------------
// Decimal encoding (96-bit unscaled + sign/scale chunk)
// ---------------------------------------------------------------------------

const HALF_EVEN = 6; // decimal.js: ROUND_HALF_EVEN

/**
 * Encode a Decimal (decimal.js instance, number, or string) using the
 * T4 binary format: 1 header byte (2 bits/chunk) + up to 4 7-bit-encoded
 * magnitudes.
 * @param {Decimal | number | string} value
 * @returns {Uint8Array}
 */
export function encodeDecimal(value) {
  const d = value instanceof Decimal ? value : new Decimal(value);

  // Decompose into (sign, unscaled, scale) so that
  //   value = sign * unscaled * 10^(-scale).
  // Use toFixed() (no arg) instead of toString() so very large/small values
  // are rendered in plain decimal form rather than scientific notation —
  // BigInt() cannot parse the latter.
  const negative = d.isNegative();
  const abs = d.abs();
  const str = abs.toFixed();
  let scale = 0;
  let unscaledStr;
  const dotIdx = str.indexOf('.');
  if (dotIdx >= 0) {
    scale = str.length - dotIdx - 1;
    unscaledStr = str.slice(0, dotIdx) + str.slice(dotIdx + 1);
  } else {
    unscaledStr = str;
  }
  // Strip leading zeros (but keep at least one digit).
  unscaledStr = unscaledStr.replace(/^0+(?=\d)/, '');

  let unscaled = BigInt(unscaledStr || '0');

  // Split into three 32-bit chunks plus the sign/scale chunk.
  const lo = unscaled & 0xffff_ffffn;
  const mid = (unscaled >> 32n) & 0xffff_ffffn;
  const hi = (unscaled >> 64n) & 0xffff_ffffn;

  // priceBits[3] = scale << 16 | (0x8000_0000 if negative)
  let bits3 = BigInt(scale) << 16n;
  if (negative) bits3 |= 0x8000_0000n;

  // Treat each chunk as signed 32 for header classification.
  const bits = [lo, mid, hi, bits3].map((v) => {
    const u = Number(v); // safe: each chunk < 2^32
    return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
  });

  // Header: 2 bits per chunk, MSB->LSB = chunk 0..3.
  let hdr = 0;
  const shifts = [6, 4, 2, 0];
  for (let i = 0; i < 4; i++) {
    const sv = bits[i];
    let tag;
    if (sv === INT32_MIN_VALUE) tag = 0x03;
    else if (sv < 0) tag = 0x02;
    else if (sv > 0) tag = 0x01;
    else tag = 0x00;
    hdr |= tag << shifts[i];
  }

  const parts = [Uint8Array.of(hdr)];
  for (let i = 0; i < 4; i++) {
    const sv = bits[i];
    if (sv !== 0 && sv !== INT32_MIN_VALUE) {
      parts.push(encode7BitInt(Math.abs(sv)));
    }
  }
  return _concat(parts);
}

/**
 * Decode a T4-binary-encoded Decimal from a stream.
 * @param {{readByte(): number}} stream
 * @returns {Decimal}
 */
export function decodeDecimal(stream) {
  const hdr = stream.readByte();
  const bits = [0, 0, 0, 0]; // signed 32

  const decodeChunk = (tag2) => {
    if (tag2 === 0x03) return INT32_MIN_VALUE;
    if (tag2 === 0x02) return -decode7BitInt(stream);
    if (tag2 === 0x01) return decode7BitInt(stream);
    return 0;
  };

  bits[0] = decodeChunk((hdr & 0xc0) >> 6);
  bits[1] = decodeChunk((hdr & 0x30) >> 4);
  bits[2] = decodeChunk((hdr & 0x0c) >> 2);
  bits[3] = decodeChunk(hdr & 0x03);

  // Reconstruct 96-bit unsigned magnitude.
  const u32 = (n) => BigInt(n >>> 0);
  const unscaled = (u32(bits[2]) << 64n) | (u32(bits[1]) << 32n) | u32(bits[0]);

  // Scale lives in bits 16..23 of chunk 3.
  const scale = (bits[3] & 0x00ff_0000) >>> 16;

  // Build the Decimal: unscaled / 10^scale, negated if chunk-3 sign bit set.
  let result;
  if (scale === 0) {
    result = new Decimal(unscaled.toString());
  } else {
    result = new Decimal(unscaled.toString()).div(new Decimal(10).pow(scale));
  }

  // Signed interpretation: bit 31 of chunk 3 => negative.
  if (bits[3] < 0) result = result.neg();

  return result;
}

// ---------------------------------------------------------------------------
// Price helpers (forward-declared, defined fully in Price.js to avoid
// a circular import here we keep them as factories accepting a Price ctor).
// ---------------------------------------------------------------------------

/**
 * Decode a Price (wraps decodeDecimal). Imported lazily to avoid a
 * cycle with price.js.
 * @param {{readByte(): number}} stream
 */
export function decodePrice(stream) {
  // Lazy import to break the cycle.
  return _lazyPrice().fromDecimal(decodeDecimal(stream));
}

/**
 * Decode a nullable Price: 1 header byte; if bit 0 is clear returns null,
 * else decodes a decimal quantized to scale 18 (half-even).
 * @param {{readByte(): number}} stream
 * @returns {object | null}
 */
export function decodePriceN(stream) {
  const hdr = stream.readByte();
  if ((hdr & 0x01) === 0x01) {
    return _lazyPrice().fromDecimal(decodeDecimal(stream));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

let _priceModule = null;
function _lazyPrice() {
  if (_priceModule == null) {
    // Synchronous-only callers; defer import via dynamic require pattern.
    // Top-level await isn't usable here, so we set it from Price.js itself
    // via `registerPriceFactory`.
    if (_priceFactory == null) {
      throw new Error('Price factory not registered yet (import Price.js first)');
    }
    _priceModule = { fromDecimal: _priceFactory };
  }
  return _priceModule;
}

let _priceFactory = null;
/**
 * Internal: registered by Price.js on module load to avoid a cycle.
 * @param {(d: Decimal) => object} factory
 */
export function registerPriceFactory(factory) {
  _priceFactory = factory;
  _priceModule = null;
}

function _concat(arrays) {
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
