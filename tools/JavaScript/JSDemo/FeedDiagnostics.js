/* Observe decoded market messages before display deduplication. Never filter the feed. */
(function (root) {
    'use strict';
    const TYPES = ['marketTrade', 'marketDepth', 'marketSnapshot', 'marketHighLow',
        'marketPriceLimits', 'marketSettlement', 'marketSubscribeReject'];
    const ENTITLEMENTS = { 0: 'NONE', 1: 'TOB', 2: 'DEPTH', 4: 'E_MINI', 8: 'DELAYED', 10: 'NOT_SET' };

    class FeedCapture {
        constructor() { this.reset(); }
        reset() {
            this.startedAt = Date.now();
            this.counts = new Map();
            this.latest = new Map();
            this.mismatches = 0;
            this.evidence = [];
        }
        static timestampMs(time) {
            if (!time || time.seconds == null) return null;
            const ms = Number(time.seconds) * 1000 + Number(time.nanos || 0) / 1e6;
            return Number.isFinite(ms) ? ms : null;
        }
        observe(envelope, marketId, expectedDelayed, receivedAt = Date.now(), prefix = '') {
            for (const type of TYPES) {
                const message = envelope[type];
                if (!message || (message.marketId || marketId) !== marketId) continue;
                const source = prefix + type;
                // An omitted proto3 bool has the wire value false.
                const delayed = message.delayed === true;
                const trade = type === 'marketDepth' ? message.tradeData : message;
                const sourceAt = FeedCapture.timestampMs(trade?.time || message.time);
                const mismatch = expectedDelayed != null && delayed !== expectedDelayed;
                const sample = {
                    source, marketId, delayed, receivedAt, sourceAt,
                    ageSeconds: sourceAt == null ? null : (receivedAt - sourceAt) / 1000,
                    price: trade?.lastTradePrice?.value == null ? null : String(trade.lastTradePrice.value),
                    volume: trade?.lastTradeVolume ?? null,
                    totalTradedVolume: trade?.totalTradedVolume ?? null,
                    mismatch
                };
                const counts = this.counts.get(source) || { delayed: 0, realtime: 0 };
                counts[delayed ? 'delayed' : 'realtime']++;
                this.counts.set(source, counts);
                this.latest.set(source + ':' + delayed, sample);
                if (mismatch) {
                    this.mismatches++;
                    this.evidence.push(sample);
                    if (this.evidence.length > 30) this.evidence.shift();
                }
                if (type === 'marketSnapshot') {
                    for (const child of message.messages || []) {
                        this.observe(child, marketId, expectedDelayed, receivedAt, 'snapshot.');
                    }
                }
            }
        }
        report() {
            return {
                startedAt: this.startedAt, mismatches: this.mismatches,
                counts: Object.fromEntries(this.counts),
                latest: Array.from(this.latest.values()), evidence: this.evidence.slice()
            };
        }
    }

    class FeedDiagnostics {
        constructor(client, host) {
            this.client = client;
            this.capture = new FeedCapture();
            this.panel = document.createElement('section');
            this.panel.className = 'section full-width feed-diagnostics';
            this.panel.id = 'feedDiagnostics';
            this.panel.innerHTML = `
                <h2>Feed diagnostics <span data-feed="port"></span></h2>
                <p data-feed="context"></p>
                <p data-feed="status" role="status"></p>
                <p class="feed-note">Raw messages before chart/tape deduplication. Ages use the source timestamp; depth uses its last trade time when available. Negative ages indicate clock skew. High/low and settlement can naturally be old. Snapshot children are listed separately.</p>
                <div class="feed-actions"><button type="button" data-feed="reset">Reset capture</button>
                <button type="button" data-feed="export">Export evidence</button>
                <span data-feed="duration"></span></div>
                <div class="feed-scroll"><table><thead><tr><th>Raw message</th><th>delayed=true</th><th>delayed=false</th></tr></thead><tbody data-feed="counts"></tbody></table></div>
                <div class="feed-scroll"><table><thead><tr><th>Latest per message / feed</th><th>Flag</th><th>Price</th><th>Age at receipt</th><th>Source (Chicago)</th><th>Received (Chicago)</th><th>Total volume</th></tr></thead><tbody data-feed="samples"></tbody></table></div>
                <details><summary>How to verify the fix</summary><p>Keep both users on the same contract and service environment. Enable Trades on both. The delayed session must receive only delayed=true market messages, with active trades about 600 seconds old. The live session should receive delayed=false with recent trade times. Repeat after reconnecting and after resubscribing. A zero mismatch count without flowing data is inconclusive. This panel captures only this browser session, not other service instances.</p></details>`;
            host.closest('.section').insertAdjacentElement('afterend', this.panel);
            this.el = name => this.panel.querySelector(`[data-feed="${name}"]`);
            this.el('port').textContent = location.host;
            this.el('reset').addEventListener('click', () => { this.capture.reset(); this.render(); });
            this.el('export').addEventListener('click', () => this.export());

            const priorReceived = client.onMessageReceived;
            client.onMessageReceived = message => {
                const context = this.context();
                if (context.marketId) this.capture.observe(message, context.marketId, context.expectedDelayed);
                priorReceived?.(message);
            };
            const priorSent = client.onMessageSent;
            client.onMessageSent = message => {
                if (message.loginRequest || message.marketSubscribe) this.capture.reset();
                priorSent?.(message);
            };
            this.timer = setInterval(() => this.render(), 500);
            this.render();
        }
        context() {
            const c = this.client;
            const exchangeId = c.currentSubscription?.exchangeId || c.config.mdExchangeId;
            const entitlement = c.loginResponse?.exchanges?.find(e => e.exchangeId === exchangeId)?.marketDataType;
            // Match the service's exact Delayed entitlement check, not a bit test (NOT_SET is 10).
            const expectedDelayed = entitlement === 8 ? true : [1, 2, 4].includes(entitlement) ? false : null;
            return {
                endpoint: c.config.wsUrl, exchangeId, entitlement, expectedDelayed,
                marketId: c.currentSubscription?.marketId || c.currentMarketId,
                ticker: c.ticker, connected: c.isConnected
            };
        }
        report() { return { context: this.context(), ...this.capture.report() }; }
        render() {
            const c = this.context();
            const report = this.capture.report();
            this.el('context').textContent = `${c.marketId || 'No market subscribed'} | ${c.endpoint} | ${c.exchangeId}: ${ENTITLEMENTS[c.entitlement] || 'entitlement unknown'} (${c.entitlement ?? '?'}) | Trades ${c.ticker ? 'ON' : 'OFF'}`;
            const status = this.el('status');
            const trades = this.capture.counts.get('marketTrade');
            const tradeCount = (trades?.delayed || 0) + (trades?.realtime || 0);
            status.className = report.mismatches ? 'feed-fail' : 'feed-pending';
            status.textContent = report.mismatches
                ? `MISMATCH DETECTED: ${report.mismatches.toLocaleString()} raw messages disagree with the entitlement.`
                : !c.connected ? 'Disconnected. Capture is retained; reconnect to test.'
                : c.expectedDelayed == null ? 'Inconclusive: waiting for a known market data entitlement.'
                : !c.ticker ? 'Inconclusive: enable Trades to test the reported ticker leak.'
                : !tradeCount ? 'Inconclusive: waiting for standalone marketTrade messages.'
                : 'No mismatch observed in this capture. Keep the live reference subscribed while testing.';
            this.el('duration').textContent = `Since ${this.time(report.startedAt)} · ${Math.floor((Date.now() - report.startedAt) / 1000)}s · resets on subscribe/login`;
            const priority = source => source.startsWith('snapshot.') ? TYPES.length + TYPES.indexOf(source.slice(9)) : TYPES.indexOf(source);
            const countsByType = Array.from(this.capture.counts).sort(([a], [b]) => priority(a) - priority(b));
            this.rows(this.el('counts'), countsByType.map(([source, counts]) => ({
                cells: [source, counts.delayed.toLocaleString(), counts.realtime.toLocaleString()],
                fail: c.expectedDelayed == null ? false : c.expectedDelayed ? counts.realtime > 0 : counts.delayed > 0
            })));
            const samples = report.latest.sort((a, b) => priority(a.source) - priority(b.source) || Number(b.delayed) - Number(a.delayed));
            this.rows(this.el('samples'), samples.map(s => ({
                fail: s.mismatch,
                cells: [s.source, `delayed=${s.delayed}`, s.price ?? '—',
                    s.ageSeconds == null ? '—' : `${s.ageSeconds.toFixed(3)}s`, this.time(s.sourceAt),
                    this.time(s.receivedAt), s.totalTradedVolume ?? '—']
            })));
        }
        time(ms) {
            return ms == null ? '—' : new Date(ms).toLocaleTimeString('en-US', {
                timeZone: 'America/Chicago', hour12: false, hour: '2-digit',
                minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
            });
        }
        rows(body, rows) {
            const fragment = document.createDocumentFragment();
            for (const row of rows) {
                const tr = document.createElement('tr');
                if (row.fail) tr.className = 'feed-fail-row';
                for (const value of row.cells) {
                    const td = document.createElement('td');
                    td.textContent = String(value);
                    tr.append(td);
                }
                fragment.append(tr);
            }
            body.replaceChildren(fragment);
        }
        export() {
            // Only whitelisted market evidence is exported; no auth/account payloads.
            const url = URL.createObjectURL(new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `feed-evidence-${location.port}-${Date.now()}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { FeedCapture, FeedDiagnostics };
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            const host = document.getElementById('marketDataHeader');
            if (root.client && host) root.feedDiagnostics = new FeedDiagnostics(root.client, host);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
