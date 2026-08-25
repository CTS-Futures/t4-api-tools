/**
 * Port of `com.t4login.definitions.BidOffer` (IntEnum shim).
 *
 * Indicates which side of the market a trade was executed against.
 */
export const BidOffer = Object.freeze({
  Undefined: 0,
  Bid: 1,
  Offer: -1,

  /**
   * Lookup by int; unknown values map to Undefined (matches Java shim).
   * @param {number} value
   */
  get(value) {
    if (value === 0 || value === 1 || value === -1) return value;
    return 0;
  },
});
