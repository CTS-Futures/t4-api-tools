/**
 * Port of `com.t4login.definitions.MarketMode` (IntEnum shim).
 *
 * Exchange session lifecycle states.
 */
const _values = {
  Undefined: 0,
  PreOpen: 1,
  Open: 2,
  RestrictedOpen: 3,
  PreClosed: 4,
  Closed: 5,
  Suspended: 6,
  Halted: 7,
  Failed: 8,
  PreCross: 9,
  Cross: 10,
  Expired: 11,
  Rejected: 12,
  Unavailable: 13,
  NoPermission: 14,
  TrialExpired: 15,
};

const _validSet = new Set(Object.values(_values));

export const MarketMode = Object.freeze({
  ..._values,
  /**
   * Lookup by int; unknown values map to Undefined.
   * @param {number} value
   */
  get(value) {
    return _validSet.has(value) ? value : 0;
  },
});
