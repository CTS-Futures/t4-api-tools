const test = require('node:test');
const assert = require('node:assert/strict');
const { FeedCapture, FeedDiagnostics } = require('./FeedDiagnostics.js');
const proto = require('./t4-proto-v2.js');
const marketId = 'XCME_Eq ES (Z26)';
const now = 1800000000000;
const trade = (delayed, age, totalTradedVolume = 10) => ({
    marketId, delayed, time: { seconds: (now - age * 1000) / 1000, nanos: 0 },
    lastTradePrice: { value: '7000.25' }, lastTradeVolume: 1, totalTradedVolume
});

test('detects the reported mixture before volume deduplication', () => {
    const capture = new FeedCapture();
    capture.observe({ marketTrade: trade(true, 600, 100) }, marketId, true, now);
    capture.observe({ marketTrade: trade(false, 0, 200) }, marketId, true, now);
    capture.observe({ marketTrade: trade(true, 600, 101) }, marketId, true, now);
    const report = capture.report();
    assert.deepEqual(report.counts.marketTrade, { delayed: 2, realtime: 1 });
    assert.equal(report.mismatches, 1);
    assert.equal(report.latest.find(s => s.delayed).ageSeconds, 600);
    assert.equal(report.evidence[0].ageSeconds, 0);
});

test('uses the protobuf default false when the flag is omitted on the wire', () => {
    const wire = proto.t4proto.v2.service.ServerMessage;
    const payload = trade(false, 0);
    delete payload.delayed;
    const decoded = wire.decode(wire.encode({ marketTrade: payload }).finish());
    assert.equal(decoded.marketTrade.delayed, false);
    assert.equal(Object.hasOwn(decoded.marketTrade, 'delayed'), false);
    const capture = new FeedCapture();
    capture.observe(decoded, marketId, true, now);
    assert.equal(capture.mismatches, 1);
});

test('checks both the snapshot container and its children, with inherited market ID', () => {
    const capture = new FeedCapture();
    const depth = { delayed: false, time: { seconds: now / 1000 },
        tradeData: { time: { seconds: now / 1000 - 20 }, lastTradePrice: { value: '7000' } } };
    capture.observe({ marketSnapshot: { marketId, delayed: false, messages: [{ marketDepth: depth }] } }, marketId, true, now);
    assert.equal(capture.mismatches, 2);
    assert.equal(capture.report().counts.marketSnapshot.realtime, 1);
    assert.equal(capture.report().counts['snapshot.marketDepth'].realtime, 1);
    assert.equal(capture.report().latest.find(s => s.source === 'snapshot.marketDepth').ageSeconds, 20);
});

test('ignores other markets and does not declare unknown entitlements a mismatch', () => {
    const capture = new FeedCapture();
    capture.observe({ marketTrade: { ...trade(false, 0), marketId: 'other' } }, marketId, true, now);
    assert.equal(capture.counts.size, 0);
    capture.observe({ marketTrade: trade(false, 0) }, marketId, null, now);
    assert.equal(capture.mismatches, 0);
});

test('checks the live reference in the opposite direction and preserves missing timestamps', () => {
    const capture = new FeedCapture();
    capture.observe({ marketTrade: { marketId, delayed: true } }, marketId, false, now);
    assert.equal(capture.mismatches, 1);
    assert.equal(capture.report().latest[0].sourceAt, null);
    assert.equal(FeedCapture.timestampMs({ seconds: { toString: () => '1800000000' }, nanos: 123000000 }), now + 123);
});

test('bounds evidence, excludes credentials, and resets capture state', () => {
    const capture = new FeedCapture();
    for (let i = 0; i < 50; i++) capture.observe({ marketTrade: { ...trade(false, 0), secret: 'must-not-export' }, loginResponse: { secret: 'must-not-export' } }, marketId, true, now);
    assert.equal(capture.mismatches, 50);
    assert.equal(capture.evidence.length, 30);
    assert.equal(capture.latest.size, 1);
    assert.ok(!JSON.stringify(capture.report()).includes('must-not-export'));
    capture.reset();
    assert.equal(capture.counts.size, 0);
    assert.equal(capture.mismatches, 0);
    assert.equal(capture.evidence.length, 0);
});

test('derives expectations from the login entitlement, not the local port', () => {
    const context = entitlement => FeedDiagnostics.prototype.context.call({ client: {
        config: { wsUrl: 'wss://example/v2', mdExchangeId: 'CME_Eq' },
        loginResponse: { exchanges: [{ exchangeId: 'CME_Eq', marketDataType: entitlement }] }
    } });
    assert.equal(context(8).expectedDelayed, true);
    assert.equal(context(2).expectedDelayed, false);
    assert.equal(context(10).expectedDelayed, null);
});
