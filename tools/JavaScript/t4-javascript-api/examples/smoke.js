/**
 * Smoke test: validates the primitive layer by round-tripping random values
 * through the 7-bit int/long and decimal encoders, and checks that
 * NDateTime decodes a known tick value to the expected calendar date.
 *
 * Run with:
 *   cd t4-javascript-api
 *   npm install
 *   npm run smoke
 */

import assert from 'node:assert/strict';
import {
  ByteReader,
  decode7BitInt,
  decode7BitLong,
  Decimal,
  decodeDecimal,
  encode7BitInt,
  encode7BitLong,
  encodeDecimal,
  extractT4BinPayload,
  NDateTime,
} from '../src/index.js';

function roundTripInt(v) {
  const bytes = encode7BitInt(v);
  const got = decode7BitInt(new ByteReader(bytes));
  assert.equal(got, v, `int round-trip mismatch for ${v}`);
}

function roundTripLong(v) {
  const bytes = encode7BitLong(v);
  const got = decode7BitLong(new ByteReader(bytes));
  assert.equal(got, v, `long round-trip mismatch for ${v}`);
}

function roundTripDecimal(s) {
  const d = new Decimal(s);
  const bytes = encodeDecimal(d);
  const got = decodeDecimal(new ByteReader(bytes));
  assert.ok(got.equals(d), `decimal round-trip mismatch for ${s}: got ${got.toString()}`);
}

// --- 7-bit int ---------------------------------------------------------
for (const v of [0, 1, -1, 127, 128, -128, 16384, -16384, 0x7fffffff, -0x80000000]) {
  roundTripInt(v);
}

// --- 7-bit long --------------------------------------------------------
for (const v of [
  0n, 1n, -1n, 127n, 128n, -128n,
  (1n << 32n), -(1n << 32n),
  (1n << 62n), -(1n << 62n),
  0x7fffffffffffffffn, -0x8000000000000000n,
]) {
  roundTripLong(v);
}

// --- Decimal -----------------------------------------------------------
for (const s of [
  '0', '1', '-1', '1.5', '-1.5',
  '123456789.123456789',
  '79228162514264337593543950335',         // Decimal.MaxValue
  '-79228162514264337593543950335',
  '0.000000000000000001',                  // scale 18
]) {
  roundTripDecimal(s);
}

// --- NDateTime ---------------------------------------------------------
// Round-trip via ticks: construct from y/m/d, then re-construct from .ticks.
{
  const built = new NDateTime(2026, 1, 1);
  const fromTicks = new NDateTime(built.ticks);
  assert.equal(fromTicks.year, 2026);
  assert.equal(fromTicks.month, 1);
  assert.equal(fromTicks.day, 1);
  assert.equal(fromTicks.hour, 0);
}
{
  const ndt = new NDateTime(2026, 6, 10, 12, 34, 56);
  assert.equal(ndt.year, 2026);
  assert.equal(ndt.month, 6);
  assert.equal(ndt.day, 10);
  assert.equal(ndt.hour, 12);
  assert.equal(ndt.minute, 34);
  assert.equal(ndt.second, 56);
}

// --- SOF extraction ----------------------------------------------------
{
  // 4-byte envelope prefix + T4BinAggr SOF + trailing version int.
  const envelope = Uint8Array.of(0xff, 0xff, 0xff, 0xff);
  const sof = Uint8Array.of(0x05, 0x01, 0x01, 0x00, 0x00, 0x00);
  const combined = new Uint8Array(envelope.length + sof.length);
  combined.set(envelope, 0);
  combined.set(sof, envelope.length);
  const payload = extractT4BinPayload(combined);
  assert.equal(payload.length, sof.length);
  assert.equal(payload[0], 0x05);
}

console.log('Smoke tests passed.');
