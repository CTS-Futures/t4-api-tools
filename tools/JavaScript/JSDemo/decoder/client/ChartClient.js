/**
 * Port of `t4login.client.chart_client.ChartClient`.
 *
 * HTTP client for the T4 Chart API. Uses the global `fetch` (Node 18+ /
 * any modern browser). For JSON endpoints, returns parsed objects directly;
 * for binary endpoints, the response is decoded with the chart-data stream
 * readers.
 */

import { ByteReader } from '../connection/ByteReader.js';
import { NDateTime } from '../datetime/NDateTime.js';
import { ChartDataStreamReader } from '../definitions/chartdata/ChartDataStreamReader.js';
import { ChartDataStreamReaderAggr } from '../definitions/chartdata/ChartDataStreamReaderAggr.js';
import { Tick as _TickDataType } from '../definitions/chartdata/ChartDataType.js';

const DEFAULT_BASE_URL = 'https://api-sim.t4login.com/chart';

// T4Bin / T4BinAggr SOF record signatures.
// Aggregated (T4BinAggr): length=5, tag=CTAG_SOF=1, version=1 (LE int32)
const _T4BINAGGR_SOF = Uint8Array.of(0x05, 0x01, 0x01, 0x00, 0x00, 0x00);
// Non-aggregated (T4Bin):  length=13, tag=CTAG_SOF=1, version=1
const _T4BIN_SOF      = Uint8Array.of(0x0d, 0x01, 0x01, 0x00, 0x00, 0x00);

/**
 * Locate the embedded T4Bin payload by scanning for either SOF signature.
 * Throws if no SOF is found in a non-empty response (corrupt / unexpected
 * format), mirroring the Python helper.
 *
 * @param {Uint8Array} content
 * @returns {Uint8Array}
 */
export function extractT4BinPayload(content) {
  if (content.length === 0) return content;
  const aggrIdx = _indexOf(content, _T4BINAGGR_SOF);
  const binIdx = _indexOf(content, _T4BIN_SOF);
  const candidates = [aggrIdx, binIdx].filter((i) => i >= 0);
  if (candidates.length === 0) {
    throw new Error(
      `No T4Bin SOF signature found in ${content.length}-byte response payload. ` +
      'The server may have returned an error body or an unrecognised format.',
    );
  }
  return content.subarray(Math.min(...candidates));
}

export class ChartClient {
  /**
   * @param {object} opts
   * @param {string} opts.token   Bearer token.
   * @param {string} [opts.baseUrl]
   * @param {typeof fetch} [opts.fetch]   Custom fetch (defaults to globalThis.fetch).
   */
  constructor({ token, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = {}) {
    if (!token) throw new Error('ChartClient: token is required');
    this._token = token;
    this._baseUrl = baseUrl.replace(/\/+$/, '');
    this._fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this._fetch !== 'function') {
      throw new Error('ChartClient: no fetch implementation available (pass `fetch` option)');
    }
  }

  // ------------------------------------------------------------------
  // /chart/barchart
  // ------------------------------------------------------------------

  async getBarchartJson(params) {
    const resp = await this._get('/barchart', this._barchartParams(params), 'application/json');
    return resp.json();
  }

  /**
   * Fetch barchart binary and dispatch decoded records to `handler`.
   * @param {object} opts  Same fields as getBarchartJson plus:
   *   - handler: chart-data handler (onBar, onMarketDefinition, ...)
   */
  async getBarchartBinary({ handler, ...rest }) {
    if (!handler) throw new Error('getBarchartBinary: handler is required');
    const resp = await this._get(
      '/barchart',
      this._barchartParams(rest),
      'application/octet-stream',
    );
    const buf = new Uint8Array(await resp.arrayBuffer());
    const payload = extractT4BinPayload(buf);
    ChartDataStreamReaderAggr.read(payload, handler);
  }

  // ------------------------------------------------------------------
  // /chart/tradehistory
  // ------------------------------------------------------------------

  async getTradehistoryJson(params) {
    const resp = await this._get(
      '/tradehistory',
      this._tradehistoryParams(params),
      'application/json',
    );
    return resp.json();
  }

  /**
   * Fetch trade history binary and return a configured ChartDataStreamReader.
   * Caller iterates `while (reader.read()) { ... }` to decode records.
   *
   * @param {object} opts
   * @returns {Promise<ChartDataStreamReader>}
   */
  async getTradehistoryBinary({ dataType = _TickDataType, ...rest }) {
    const resp = await this._get(
      '/tradehistory',
      this._tradehistoryParams(rest),
      'application/octet-stream',
    );
    const buf = new Uint8Array(await resp.arrayBuffer());
    const payload = extractT4BinPayload(buf);
    return new ChartDataStreamReader({
      data: new ByteReader(payload),
      tradeDate: new NDateTime(0n),
      marketId: rest.marketId ?? '',
      dataType,
    });
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  async _get(path, params, accept) {
    const url = new URL(this._baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const resp = await this._fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: accept,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${body}`);
    }
    return resp;
  }

  _barchartParams({
    exchangeId,
    contractId,
    chartType = 'Bar',
    barInterval = 'Minute',
    barPeriod = 1,
    tradeDateStart,
    tradeDateEnd,
    marketId = null,
    continuationType = null,
    resetInterval = null,
  }) {
    return {
      exchangeId,
      contractId,
      chartType,
      barInterval,
      barPeriod: String(barPeriod),
      tradeDateStart,
      tradeDateEnd,
      marketID: marketId,
      continuationType,
      resetInterval,
    };
  }

  _tradehistoryParams({
    exchangeId,
    contractId,
    marketId = null,
    tradeDateStart = null,
    tradeDateEnd = null,
    start = null,
    end = null,
    since = null,
  }) {
    return {
      exchangeId,
      contractId,
      marketID: marketId,
      tradeDateStart,
      tradeDateEnd,
      start,
      end,
      since,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _indexOf(haystack, needle) {
  if (needle.length === 0) return 0;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
