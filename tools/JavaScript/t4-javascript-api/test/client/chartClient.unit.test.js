/**
 * Unit tests for ChartClient — offline, deterministic.
 *
 * Strategy:
 *   - Monkey-patch globalThis.fetch in `beforeEach`, restore in `afterEach`.
 *   - URL/header/param assertions read the last recorded call.
 *   - Binary decode tests synthesize records using the production encoders
 *     (see `test/helpers/binaryFixtures.js`) so the same byte layout the
 *     readers will consume is exercised end-to-end.
 *
 * Mirrors `tempFile/tests/client/test_chart_client.py` test by test.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ChartClient,
  ChartDataChange,
  extractT4BinPayload,
  NDateTime,
} from '../../src/index.js';

import { fakeResponse, installFakeFetch } from '../helpers/fakeResponse.js';
import { CollectingHandler } from '../helpers/collectingHandler.js';
import {
  aggrBar,
  aggrMarketDefinition,
  aggrMarketSwitch,
  aggrSof,
  aggrTradeDateSwitch,
  binMarketDefinition,
  binSof,
  binTradePriceDec,
  concatBytes,
} from '../helpers/binaryFixtures.js';

// ---------------------------------------------------------------------------
// Sample JSON payloads (port of SAMPLE_JSON_* in the Python suite)
// ---------------------------------------------------------------------------

const SAMPLE_JSON_BARCHART = {
  tradeDateStart: '2024-01-08T00:00:00',
  tradeDateEnd:   '2024-01-08T00:00:00',
  activeMarket:   'XCME_Eq ES (H24)',
  bars: [{
    tradeDate: '2024-01-08T00:00:00',
    time:      '2024-01-08T00:00:00',
    marketID:  'XCME_Eq ES (H24)',
    openPrice: '473575',
    highPrice: '480325',
    lowPrice:  '471525',
    closePrice:'479800',
    volume:    1339989,
    volumeAtBid: 665050,
    volumeAtOffer: 674939,
    trades: 320624,
    tradesAtBid: 152333,
    tradesAtOffer: 168291,
  }],
  marketDefinitions: [{
    marketID: 'XCME_Eq ES (H24)',
    minPriceIncrement: '25',
    priceCode: '',
    tickValue: 12.5,
    vpt: '',
  }],
  modeChanges: [],
  openInterests: [],
  settlements: [],
};

const SAMPLE_JSON_TRADEHISTORY = {
  exchangeID: 'CME_E',
  contractID: 'YM',
  marketID:   'XCME_E YM (H24)',
  tradeDateStart: '2024-01-08T00:00:00',
  tradeDateEnd:   '2024-01-08T00:00:00',
  trades: [{
    marketID: 'XCME_E YM (H24)',
    tradeDate: '2024-01-08T00:00:00',
    time: '2024-01-07T17:00:00',
    tradePrice: '37674',
    aggressorSide: 1,
  }],
  marketDefinitions: [],
  modeChanges: [],
  openInterests: [],
  settlements: [],
  vwaPs: [],
};

// ---------------------------------------------------------------------------
// Per-test fetch lifecycle
// ---------------------------------------------------------------------------

let fetchStub;

function installJson(body) {
  fetchStub = installFakeFetch(fakeResponse({ json: body }));
}

function installBinary(bytes) {
  fetchStub = installFakeFetch(fakeResponse({ binary: bytes }));
}

function installStatus(status) {
  fetchStub = installFakeFetch(fakeResponse({ status, text: 'err' }));
}

// ---------------------------------------------------------------------------
// /chart/barchart (JSON)
// ---------------------------------------------------------------------------

describe('ChartClient.getBarchartJson', () => {
  afterEach(() => fetchStub?.restore());

  it('returns parsed JSON', async () => {
    installJson(SAMPLE_JSON_BARCHART);

    const client = new ChartClient({ token: 'test-token' });
    const result = await client.getBarchartJson({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    assert.equal(result.activeMarket, 'XCME_Eq ES (H24)');
    assert.equal(result.bars.length, 1);
    assert.equal(result.bars[0].volume, 1339989);
  });

  it('sends Bearer auth and JSON Accept headers', async () => {
    installJson(SAMPLE_JSON_BARCHART);

    const client = new ChartClient({ token: 'my-secret-token' });
    await client.getBarchartJson({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    const headers = fetchStub.lastHeaders();
    assert.equal(headers.Authorization, 'Bearer my-secret-token');
    assert.equal(headers.Accept, 'application/json');
  });

  it('includes optional params when provided', async () => {
    installJson(SAMPLE_JSON_BARCHART);

    const client = new ChartClient({ token: 't' });
    await client.getBarchartJson({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
      marketId: 'XCME_Eq ES (H24)',
      continuationType: 'Volume',
      resetInterval: 'TradingDay',
    });

    const url = fetchStub.lastUrl();
    assert.ok(url.includes('marketID='), `marketID missing in ${url}`);
    assert.ok(url.includes('continuationType=Volume'));
    assert.ok(url.includes('resetInterval=TradingDay'));
  });

  it('omits optional params when null', async () => {
    installJson(SAMPLE_JSON_BARCHART);

    const client = new ChartClient({ token: 't' });
    await client.getBarchartJson({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    const url = fetchStub.lastUrl();
    assert.ok(!url.includes('marketID='), `marketID unexpectedly present in ${url}`);
    assert.ok(!url.includes('continuationType='));
  });
});

// ---------------------------------------------------------------------------
// /chart/barchart (binary)
// ---------------------------------------------------------------------------

describe('ChartClient.getBarchartBinary', () => {
  afterEach(() => fetchStub?.restore());

  it('decodes a SOF-only response without producing bars', async () => {
    installBinary(aggrSof());

    const handler = new CollectingHandler();
    const client = new ChartClient({ token: 't' });
    await client.getBarchartBinary({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
      handler,
    });

    assert.deepEqual(handler.bars, []);
  });

  it('sends binary Accept header', async () => {
    installBinary(aggrSof());

    const handler = new CollectingHandler();
    const client = new ChartClient({ token: 't' });
    await client.getBarchartBinary({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
      handler,
    });

    assert.equal(fetchStub.lastHeaders().Accept, 'application/octet-stream');
  });

  it('decodes SOF + MarketDefinition + Bar into handler callbacks', async () => {
    const tradeDate = new NDateTime(2024, 1, 8).ticks;
    const timeTicks = new NDateTime(2024, 1, 8, 9, 30, 0).ticks;
    const closeDelta = 60n * 10_000_000n; // +60 seconds

    const payload = concatBytes(
      aggrSof(),
      aggrTradeDateSwitch(tradeDate),
      aggrMarketDefinition({
        marketId: 'XCME_Eq ES (H24)',
        numerator: 25,
        denominator: 1,
        priceCode: '',
        tickValue: 12.5,
        vpt: '',
        minCabPrice: null,
      }),
      aggrMarketSwitch('XCME_Eq ES (H24)'),
      aggrBar({
        timeTicks,
        closeDeltaTicks: closeDelta,
        openPrice: '4735.75',
        highPrice: '4803.25',
        lowPrice:  '4715.25',
        closePrice:'4798.00',
        volume: 1339989,
        volumeAtBid: 665050,
        volumeAtOffer: 674939,
        trades: 320624,
        tradesAtBid: 152333,
        tradesAtOffer: 168291,
      }),
    );
    installBinary(payload);

    const handler = new CollectingHandler();
    const client = new ChartClient({ token: 't' });
    await client.getBarchartBinary({
      exchangeId: 'CME',
      contractId: 'ES',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
      handler,
    });

    assert.equal(handler.marketDefinitions.length, 1);
    assert.equal(handler.marketDefinitions[0].MarketID, 'XCME_Eq ES (H24)');

    assert.equal(handler.bars.length, 1);
    const bar = handler.bars[0];
    assert.equal(bar.MarketID, 'XCME_Eq ES (H24)');
    assert.equal(bar.Volume, 1339989);
    assert.equal(bar.OpenPrice.value.toString(), '4735.75');
    assert.equal(bar.HighPrice.value.toString(), '4803.25');
    assert.equal(bar.LowPrice.value.toString(),  '4715.25');
    assert.equal(bar.ClosePrice.value.toString(),'4798');
  });
});

// ---------------------------------------------------------------------------
// /chart/tradehistory (JSON)
// ---------------------------------------------------------------------------

describe('ChartClient.getTradehistoryJson', () => {
  afterEach(() => fetchStub?.restore());

  it('returns parsed JSON', async () => {
    installJson(SAMPLE_JSON_TRADEHISTORY);

    const client = new ChartClient({ token: 't' });
    const result = await client.getTradehistoryJson({
      exchangeId: 'CME_E',
      contractId: 'YM',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    assert.equal(result.marketID, 'XCME_E YM (H24)');
    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].tradePrice, '37674');
  });

  it('sends Bearer auth and JSON Accept headers', async () => {
    installJson(SAMPLE_JSON_TRADEHISTORY);

    const client = new ChartClient({ token: 'bearer-abc' });
    await client.getTradehistoryJson({
      exchangeId: 'CME_E',
      contractId: 'YM',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    const headers = fetchStub.lastHeaders();
    assert.equal(headers.Authorization, 'Bearer bearer-abc');
    assert.equal(headers.Accept, 'application/json');
  });

  it('uses start/end window and omits tradeDateStart', async () => {
    installJson(SAMPLE_JSON_TRADEHISTORY);

    const client = new ChartClient({ token: 't' });
    await client.getTradehistoryJson({
      exchangeId: 'CME_E',
      contractId: 'YM',
      start: '2024-01-07T17:00:00',
      end:   '2024-01-08T16:00:00',
    });

    const url = fetchStub.lastUrl();
    assert.ok(url.includes('start='));
    assert.ok(url.includes('end='));
    assert.ok(!url.includes('tradeDateStart='), `tradeDateStart leaked into ${url}`);
  });
});

// ---------------------------------------------------------------------------
// /chart/tradehistory (binary)
// ---------------------------------------------------------------------------

describe('ChartClient.getTradehistoryBinary', () => {
  afterEach(() => fetchStub?.restore());

  it('returns a reader whose read() is false on empty body', async () => {
    installBinary(new Uint8Array(0));

    const client = new ChartClient({ token: 't' });
    const reader = await client.getTradehistoryBinary({
      exchangeId: 'CME_E',
      contractId: 'YM',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    assert.equal(reader.read(), false);
  });

  it('sends binary Accept header', async () => {
    // Non-empty: a bare SOF so the SOF-extraction step succeeds.
    installBinary(binSof(new NDateTime(2024, 1, 8).ticks));

    const client = new ChartClient({ token: 't' });
    await client.getTradehistoryBinary({
      exchangeId: 'CME_E',
      contractId: 'YM',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    assert.equal(fetchStub.lastHeaders().Accept, 'application/octet-stream');
  });

  it('decodes a SOF + market-definition + trade tick into reader state', async () => {
    const tradeDate = new NDateTime(2024, 1, 8).ticks;
    const payload = concatBytes(
      binSof(tradeDate),
      binMarketDefinition({
        marketId: 'XCME_E YM (H24)',
        numerator: 1,
        denominator: 1,
        tickValue: 5.0,
        omitVpt: true,
      }),
      binTradePriceDec({
        deltaTicks: 0n,
        volume: 7,
        priceIncrements: '37674',
        ttvDelta: 0,
        attr: 2, // TRADE_AT_BID
      }),
    );
    installBinary(payload);

    const client = new ChartClient({ token: 't' });
    const reader = await client.getTradehistoryBinary({
      exchangeId: 'CME_E',
      contractId: 'YM',
      marketId: 'XCME_E YM (H24)',
      tradeDateStart: '2024-01-08',
      tradeDateEnd:   '2024-01-08',
    });

    // SOF
    assert.equal(reader.read(), true);
    assert.equal(reader.state.Change, ChartDataChange.TradeDate);

    // MarketDefinition
    assert.equal(reader.read(), true);
    assert.equal(reader.state.Change, ChartDataChange.MarketDefinition);
    assert.equal(reader.state.MarketID, 'XCME_E YM (H24)');
    assert.equal(reader.state.Numerator, 1);
    assert.equal(reader.state.Denominator, 1);

    // Trade
    assert.equal(reader.read(), true);
    assert.equal(reader.state.Change, ChartDataChange.Trade);
    assert.equal(reader.state.TradeVolume, 7);
    assert.equal(reader.state.LastTradePrice.value.toString(), '37674');

    // EOF
    assert.equal(reader.read(), false);
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe('ChartClient error handling', () => {
  afterEach(() => fetchStub?.restore());

  it('rejects on HTTP 401', async () => {
    installStatus(401);
    const client = new ChartClient({ token: 'bad' });
    await assert.rejects(
      () => client.getBarchartJson({
        exchangeId: 'CME', contractId: 'ES',
        tradeDateStart: '2024-01-08', tradeDateEnd: '2024-01-08',
      }),
      /HTTP 401/,
    );
  });

  it('rejects on HTTP 400', async () => {
    installStatus(400);
    const client = new ChartClient({ token: 't' });
    await assert.rejects(
      () => client.getTradehistoryJson({
        exchangeId: 'CME_E', contractId: 'YM',
        tradeDateStart: '2024-01-08', tradeDateEnd: '2024-01-08',
      }),
      /HTTP 400/,
    );
  });

  it('throws on non-empty binary body with no SOF signature', async () => {
    installBinary(Uint8Array.of(0x00, 0x01, 0x02, 0x03));
    const client = new ChartClient({ token: 't' });
    await assert.rejects(
      () => client.getBarchartBinary({
        exchangeId: 'CME', contractId: 'ES',
        tradeDateStart: '2024-01-08', tradeDateEnd: '2024-01-08',
        handler: new CollectingHandler(),
      }),
      /No T4Bin SOF signature/,
    );
  });

  it('empty binary body is a valid no-data response', async () => {
    installBinary(new Uint8Array(0));
    const handler = new CollectingHandler();
    const client = new ChartClient({ token: 't' });
    await client.getBarchartBinary({
      exchangeId: 'CME', contractId: 'ES',
      tradeDateStart: '2024-01-08', tradeDateEnd: '2024-01-08',
      handler,
    });
    assert.deepEqual(handler.bars, []);
  });
});

// ---------------------------------------------------------------------------
// SOF extraction (direct unit tests)
// ---------------------------------------------------------------------------

describe('extractT4BinPayload', () => {
  it('strips an envelope and returns the aggregated SOF onward', () => {
    const envelope = Uint8Array.of(0xff, 0xff, 0xff, 0xff);
    const sof = Uint8Array.of(0x05, 0x01, 0x01, 0x00, 0x00, 0x00);
    const combined = concatBytes(envelope, sof, Uint8Array.of(0xaa));
    const payload = extractT4BinPayload(combined);
    assert.equal(payload[0], 0x05);
    assert.equal(payload.length, sof.length + 1);
  });

  it('strips an envelope and returns the non-aggregated SOF onward', () => {
    const envelope = Uint8Array.of(0xff, 0xff);
    const sof = Uint8Array.of(0x0d, 0x01, 0x01, 0x00, 0x00, 0x00);
    const combined = concatBytes(envelope, sof);
    const payload = extractT4BinPayload(combined);
    assert.equal(payload[0], 0x0d);
    assert.equal(payload.length, sof.length);
  });

  it('returns empty when input is empty', () => {
    const payload = extractT4BinPayload(new Uint8Array(0));
    assert.equal(payload.length, 0);
  });
});
