/**
 * Port of `com.t4login.definitions.priceconversion.Price`.
 *
 * Decimal-precision wrapper quantized to scale 18 with HALF_EVEN rounding,
 * matching Java BigDecimal at the same scale. Uses the shared decimal.js
 * instance from `../../decimal.js`.
 *
 * Markets implementing `IMarketConversion` (ChartDataState, MarketDefinition)
 * expose `getDenominator()`, `getMinPriceIncrement()`, `getVpt()`, and
 * `getPointValue()`; this class accepts any such object as `mkt`.
 */

import { Decimal, HALF_EVEN, ROUND_CEIL, ROUND_FLOOR } from '../../decimal.js';
import { registerPriceFactory } from '../../util/encoding.js';

export const Scale = 18;

const QUANTUM = new Decimal(10).pow(-Scale);

function quantize(value) {
  return value.toDecimalPlaces(Scale, HALF_EVEN);
}

// Sentinels (do not quantize — would overflow the working precision).
const MAX_DECIMAL = new Decimal('79228162514264337593543950335');
const MIN_DECIMAL = new Decimal('-79228162514264337593543950335');

export const RoundingDirection = Object.freeze({ Up: 'Up', Down: 'Down' });

export class Price {
  /**
   * @param {number | string | Decimal} value
   */
  constructor(value) {
    let d;
    if (value instanceof Decimal) d = value;
    else if (typeof value === 'number' || typeof value === 'string') d = new Decimal(value);
    else if (typeof value === 'bigint') d = new Decimal(value.toString());
    else throw new TypeError('Price: unsupported value type');
    this._value = quantize(d);
  }

  /** Internal: create without quantizing (for sentinels). */
  static _unquantized(d) {
    const p = Object.create(Price.prototype);
    p._value = d;
    return p;
  }

  /** @returns {Decimal} */
  get value() { return this._value; }

  // --- Factories -------------------------------------------------------

  /**
   * @param {object} mkt  IMarketConversion
   * @param {bigint | number | Decimal} ticks
   */
  static fromTicks(mkt, ticks) {
    const t = ticks instanceof Decimal ? ticks : new Decimal(ticks.toString());
    const denom = new Decimal(mkt.getDenominator());
    return new Price(t.div(denom));
  }

  /**
   * @param {object} mkt
   * @param {number | Decimal | bigint} increments
   */
  static fromIncrements(mkt, increments) {
    const vpt = mkt.getVpt ? mkt.getVpt() : null;
    const inc = increments instanceof Decimal
      ? increments
      : new Decimal(typeof increments === 'bigint' ? increments.toString() : increments);
    if (vpt == null || !vpt.getIsValid()) {
      return new Price(inc.mul(mkt.getMinPriceIncrement().value));
    }
    return vpt.incrementsToPrice(inc);
  }

  // --- Arithmetic ------------------------------------------------------

  add(other) {
    const o = other instanceof Price ? other._value : other instanceof Decimal ? other : new Decimal(other);
    return new Price(this._value.add(o));
  }

  subtract(other) {
    const o = other instanceof Price ? other._value : other instanceof Decimal ? other : new Decimal(other);
    return new Price(this._value.sub(o));
  }

  multiply(other) {
    const o = other instanceof Price ? other._value : other instanceof Decimal ? other : new Decimal(other);
    return new Price(this._value.mul(o));
  }

  divide(other) {
    const o = other instanceof Price ? other._value : other instanceof Decimal ? other : new Decimal(other);
    return new Price(this._value.div(o));
  }

  abs() {
    if (this._value.isNegative()) return new Price(this._value.abs());
    return this;
  }

  negated() {
    return new Price(this._value.neg());
  }

  // --- Comparison ------------------------------------------------------

  equals(other) {
    return other instanceof Price && this._value.equals(other._value);
  }

  compareTo(other) {
    if (other == null) return 1;
    return this._value.cmp(other._value);
  }

  // --- Round / increments ---------------------------------------------

  toIncrements(mkt) {
    const vpt = mkt.getVpt ? mkt.getVpt() : null;
    if (vpt == null || !vpt.getIsValid()) {
      return this._value.div(mkt.getMinPriceIncrement().value);
    }
    return vpt.priceToIncrements(this);
  }

  // --- Strings ---------------------------------------------------------

  toString() {
    if (this._value.isZero()) return '0';
    return this._value.toString();
  }

  toJSON() { return this.toString(); }
}

export const Zero = new Price(0);
export const MaxValue = Price._unquantized(MAX_DECIMAL);
export const MinValue = Price._unquantized(MIN_DECIMAL);

// Hook for util/encoding.js so decodePrice can construct a Price without
// importing this module directly (avoids a circular import).
registerPriceFactory((d) => new Price(d));
