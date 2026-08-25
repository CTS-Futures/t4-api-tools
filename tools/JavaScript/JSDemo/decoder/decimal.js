/**
 * Configured `decimal.js` instance for the chart decoder.
 *
 * Precision 40 is high enough for the 96-bit unscaled range (~29 digits)
 * plus the scale-18 quantize used by Price. Rounding mode is set to
 * ROUND_HALF_EVEN to match Java BigDecimal.HALF_EVEN.
 */
import DecimalCtor from './vendor/decimal.js';

const Decimal = DecimalCtor.clone({
  precision: 40,
  rounding: 6, // ROUND_HALF_EVEN
});

export { Decimal };
export const HALF_EVEN = 6;
export const ROUND_FLOOR = 3;
export const ROUND_CEIL = 2;
