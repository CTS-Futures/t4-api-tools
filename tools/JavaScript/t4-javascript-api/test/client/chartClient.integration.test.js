/**
 * Live integration tests for the T4 Chart API.
 *
 * These tests hit the real sim endpoint at
 *   https://api-sim.t4login.com/chart
 * through `ChartClient` and verify that:
 *
 *   1. JSON responses parse into the expected top-level shape.
 *   2. Binary (application/octet-stream) responses are decoded by the
 *      ChartDataStreamReaderAggr / ChartDataStreamReader pipeline into
 *      typed records (bars, market definitions, ticks).
 *
 * The entire suite is **skipped** when the `T4_API_TOKEN` environment
 * variable is unset, so the default `npm test` (unit tier) stays offline.
 *
 * To run:
 *   $env:T4_API_TOKEN = "<bearer-token>"
 *   npm run test:integration
 *
 * Mirrors `tempFile/tests/client/test_chart_client_integration.py`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ChartClient } from '../../src/index.js';
import { CollectingHandler } from '../helpers/collectingHandler.js';

// ---------------------------------------------------------------------------
// Token discovery — skip the whole module when absent
// ---------------------------------------------------------------------------

const TOKEN = process.env.T4_API_TOKEN ?? '';
const skip = TOKEN.length === 0
  ? 'T4_API_TOKEN not set — skipping live integration tests'
  : false;

// ---------------------------------------------------------------------------
// Shared request parameters
// ---------------------------------------------------------------------------
// YM (E-mini Dow) on the CME sim feed. MARKET_ID pins a specific front-month
// contract; refresh this when the contract rolls (roughly every quarter).
// TRADE_DATE_* are computed dynamically to stay within the sim's retention
// window: we request the most recently completed Mon–Fri trading week so the
// tests remain valid without manual maintenance.

const EXCHANGE_ID = 'CME_E';
const CONTRACT_ID = 'YM';
const MARKET_ID = 'XCME_E YM (M26)'; // Refresh when YM rolls to next contract month

/**
 * Return `[startISO, endISO]` for the most recently completed Mon–Fri week.
 *
 * "Completed" means the week ended at least one full day ago so the sim feed
 * has had time to persist all ticks. If today is Monday we step back two
 * weeks to avoid partial data from the current week.
 *
 * @returns {[string, string]}
 */
function lastCompletedWeek() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // JS getUTCDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  // Convert to Python-style weekday: 0 = Monday ... 6 = Sunday.
  const weekday = (today.getUTCDay() + 6) % 7;

  // Monday of the current week
  const currentMonday = new Date(today);
  currentMonday.setUTCDate(today.getUTCDate() - weekday);

  // Last completed Friday = current Monday - 3
  const lastFriday = new Date(currentMonday);
  lastFriday.setUTCDate(currentMonday.getUTCDate() - 3);

  // Last Monday = last Friday - 4
  const lastMonday = new Date(lastFriday);
  lastMonday.setUTCDate(lastFriday.getUTCDate() - 4);

  const iso = (d) => d.toISOString().slice(0, 10);
  return [iso(lastMonday), iso(lastFriday)];
}

const [TRADE_DATE_START, TRADE_DATE_END] = lastCompletedWeek();

// ---------------------------------------------------------------------------
// /chart/barchart
// ---------------------------------------------------------------------------

describe('Live: /chart/barchart', { skip }, () => {
  it('JSON response has bars and marketDefinitions lists', async () => {
    const client = new ChartClient({ token: TOKEN });
    const result = await client.getBarchartJson({
      exchangeId: EXCHANGE_ID,
      contractId: CONTRACT_ID,
      chartType: 'Bar',
      barInterval: 'Day',
      barPeriod: 1,
      marketId: MARKET_ID,
      tradeDateStart: TRADE_DATE_START,
      tradeDateEnd: TRADE_DATE_END,
    });

    assert.ok('bars' in result, 'missing "bars" key');
    assert.ok('marketDefinitions' in result, 'missing "marketDefinitions" key');
    assert.ok(Array.isArray(result.bars), '"bars" should be an array');
  });

  it('binary response decodes into Bar + MarketDefinition records', async () => {
    const handler = new CollectingHandler();
    const client = new ChartClient({ token: TOKEN });
    await client.getBarchartBinary({
      exchangeId: EXCHANGE_ID,
      contractId: CONTRACT_ID,
      chartType: 'Bar',
      barInterval: 'Day',
      barPeriod: 1,
      marketId: MARKET_ID,
      tradeDateStart: TRADE_DATE_START,
      tradeDateEnd: TRADE_DATE_END,
      handler,
    });

    assert.ok(
      handler.marketDefinitions.length > 0,
      'expected at least one MarketDefinition callback',
    );
    assert.ok(handler.bars.length > 0, 'expected at least one Bar callback');

    const bar = handler.bars[0];
    assert.notEqual(bar.MarketID, '', 'first bar should have a non-empty MarketID');
    assert.ok(bar.Volume > 0, `first bar should have Volume > 0 (got ${bar.Volume})`);
  });
});

// ---------------------------------------------------------------------------
// /chart/tradehistory
// ---------------------------------------------------------------------------

describe('Live: /chart/tradehistory', { skip }, () => {
  it('JSON response contains a non-empty trades list', async () => {
    const client = new ChartClient({ token: TOKEN });
    const result = await client.getTradehistoryJson({
      exchangeId: EXCHANGE_ID,
      contractId: CONTRACT_ID,
      marketId: MARKET_ID,
      tradeDateStart: TRADE_DATE_START,
      tradeDateEnd: TRADE_DATE_END,
    });

    assert.ok('trades' in result, 'missing "trades" key');
    assert.ok(Array.isArray(result.trades), '"trades" should be an array');
    assert.ok(
      result.trades.length > 0,
      'expected at least one trade in the response',
    );
  });

  it('binary response yields a reader that decodes a record with non-empty MarketID', async () => {
    const client = new ChartClient({ token: TOKEN });
    const reader = await client.getTradehistoryBinary({
      exchangeId: EXCHANGE_ID,
      contractId: CONTRACT_ID,
      marketId: MARKET_ID,
      tradeDateStart: TRADE_DATE_START,
      tradeDateEnd: TRADE_DATE_END,
    });

    let foundMarket = false;
    while (reader.read()) {
      if (reader.state.MarketID !== '') {
        foundMarket = true;
        break;
      }
    }
    assert.ok(
      foundMarket,
      'expected at least one decoded record with a non-empty MarketID',
    );
  });
});
