/**
 * Port of the Python `CollectingHandler` from
 * `tempFile/tests/client/conftest.py`.
 *
 * Records every callback into typed arrays so tests can assert on what
 * the chart-data readers dispatched.
 */
export class CollectingHandler {
  constructor() {
    this.bars = [];
    this.marketDefinitions = [];
    this.modeChanges = [];
    this.settlements = [];
    this.openInterests = [];
  }

  onMarketDefinition(marketDefinition) {
    this.marketDefinitions.push(marketDefinition);
  }
  onBar(bar) { this.bars.push(bar); }
  onModeChange(marketId, tradeDate, time, mode) {
    this.modeChanges.push({ marketId, tradeDate, time, mode });
  }
  onSettlement(marketId, tradeDate, time, settlementPrice, held) {
    this.settlements.push({ marketId, tradeDate, time, settlementPrice, held });
  }
  onOpenInterest(marketId, tradeDate, time, openInterest) {
    this.openInterests.push({ marketId, tradeDate, time, openInterest });
  }
}
