/**
 * Port of `com.t4login.definitions.chartdata.ChartDataChange`.
 * Renamed `None` → `NONE` for parity with the Python port.
 */
const _values = {
  NONE: 0,
  Trade: 1,
  Quote: 2,
  MarketMode: 3,
  Settlement: 4,
  TradeBar: 5,
  TradeDate: 6,
  TPO: 7,
  TickChange: 8,
  RFQ: 9,
  HeldSettlement: 10,
  ClearedVolume: 11,
  OpenInterest: 12,
  VWAP: 13,
  MarketSwitch: 14,
  MarketDefinition: 15,
};

const _validSet = new Set(Object.values(_values));

export const ChartDataChange = Object.freeze({
  ..._values,
  /**
   * @param {number} value
   * @returns {number | null}  null when value is not a known enum (matches Java).
   */
  get(value) {
    return _validSet.has(value) ? value : null;
  },
});
