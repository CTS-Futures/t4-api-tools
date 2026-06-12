/**
 * Browser loader for the T4 chart-data decoder.
 *
 * JSDemo uses classic <script> tags with global registration (no bundler).
 * The decoder under ./ is authored as native ES modules, so this file is the
 * single `<script type="module">` entry point. It imports the decoder's public
 * surface and publishes it on `window.T4ChartDecoder` so the classic scripts
 * (T4APIClient.js, ChartService.js) can use it without an import statement.
 *
 * A `t4-decoder-ready` event is dispatched on `window` once the global is set,
 * for any code that wants to wait deterministically.
 */

try {
    const mod = await import('./index.js');
    const { extractT4BinPayload } = await import('./client/ChartClient.js');

    const api = {
        ByteReader: mod.ByteReader,
        NDateTime: mod.NDateTime,
        Bar: mod.Bar,
        MarketDefinition: mod.MarketDefinition,
        ChartDataStreamReader: mod.ChartDataStreamReader,
        ChartDataStreamReaderAggr: mod.ChartDataStreamReaderAggr,
        ChartDataChange: mod.ChartDataChange,
        ChartDataType: mod.ChartDataType,
        Price: mod.Price,
        Decimal: mod.Decimal,
        extractT4BinPayload,
    };

    window.T4ChartDecoder = api;
    window.dispatchEvent(new CustomEvent('t4-decoder-ready', { detail: api }));
} catch (err) {
    // Make the failure loud — without this, ChartService silently falls back
    // to the JSON+calibration path and the binary decoder appears "missing".
    console.error('[T4ChartDecoder] failed to load decoder module:', err);
    window.T4ChartDecoderError = err;
    window.dispatchEvent(new CustomEvent('t4-decoder-error', { detail: err }));
}
