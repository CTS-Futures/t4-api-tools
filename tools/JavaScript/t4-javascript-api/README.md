# @t4/chart-decoder

JavaScript (ES modules) port of the `t4login` Python chart-data decoder.

Mirrors the layout of `tempFile/src/t4login`:

```
src/
  datetime/NDateTime.js
  connection/{ByteReader,CountingInputStream}.js
  util/encoding.js
  message/reader.js
  definitions/
    BidOffer.js
    MarketMode.js
    priceconversion/{Price,VPT}.js
    chartdata/
      ChartDataChange.js
      ChartDataType.js
      ChartFormat.js
      ChartFormatAggr.js
      ChartDataState.js
      ChartDataStreamReader.js       # T4Bin (tradehistory)
      ChartDataStreamReaderAggr.js   # T4BinAggr (barchart)
  client/ChartClient.js
  index.js
```

## Install

```powershell
cd t4-javascript-api
npm install
```

Requires Node 18+ (uses global `fetch`) or any modern browser bundler.

## Usage (aggregated barchart)

```js
import { ChartClient } from '@t4/chart-decoder';

const client = new ChartClient({ token: '...' });
await client.getBarchartBinary({
  exchangeId: 'CME_Eq',
  contractId: 'ESM6',
  tradeDateStart: '2026-05-01',
  tradeDateEnd:   '2026-05-02',
  handler: {
    onMarketDefinition(def) { /* ... */ },
    onBar(bar)              { /* ... */ },
    onModeChange(...)       { /* ... */ },
    onSettlement(...)       { /* ... */ },
    onOpenInterest(...)     { /* ... */ },
  },
});
```

## Usage (non-aggregated tradehistory)

```js
import { ChartClient, ChartDataChange } from '@t4/chart-decoder';

const reader = await client.getTradehistoryBinary({ /* ... */ });
while (reader.read()) {
  const s = reader.state;
  if (s.Change === ChartDataChange.Trade) {
    console.log(s.LastTradePrice.toString(), s.TradeVolume);
  }
}
```

## Numeric correctness

- 64-bit ticks / 7-bit-long values use **BigInt**.
- 96-bit unscaled decimals use **decimal.js** at scale 18, `ROUND_HALF_EVEN`.
- Field naming preserves Python/Java PascalCase on `ChartDataState`, `Bar`,
  `MarketDefinition` for 1:1 parity.
