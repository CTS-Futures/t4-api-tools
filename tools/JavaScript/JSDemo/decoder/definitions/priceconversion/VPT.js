/**
 * Port of `com.t4login.definitions.priceconversion.VPT`.
 *
 * Variable Price Tick — non-uniform tick sizes parsed from a spec string
 * like "25;P>100=50;P<-100=10". Used by Price.fromIncrements / Price.toIncrements
 * whenever a market defines a VPT.
 *
 * Implementation mirrors the Python port exactly: a binary tree of `_VPTLimit`
 * nodes, each covering a price range with its own min-price-increment.
 */

import { Decimal } from '../../decimal.js';
import { MaxValue, MinValue, Price } from './Price.js';

const LimitDir = Object.freeze({ GreaterThan: 'GreaterThan', LessThan: 'LessThan' });

class VPTLimit {
  /**
   * @param {Price} minPriceIncrement
   * @param {'GreaterThan' | 'LessThan' | null} direction
   */
  constructor(minPriceIncrement, direction = null) {
    this.minPriceIncrement = minPriceIncrement;
    this.left = null;
    this.right = null;

    if (direction == null) {
      this.leftLimit = MinValue;
      this.rightLimit = MaxValue;
      this.leftNums = MinValue.value;
      this.rightNums = MaxValue.value;
    } else if (direction === LimitDir.GreaterThan) {
      this.leftLimit = null;
      this.rightLimit = MaxValue;
      this.leftNums = new Decimal(1);
      this.rightNums = MaxValue.value;
    } else {
      this.leftLimit = MinValue;
      this.rightLimit = null;
      this.leftNums = MinValue.value;
      this.rightNums = new Decimal(1);
    }
  }

  addLimit(direction, limit, num) {
    if (direction === LimitDir.GreaterThan) {
      if (this.rightLimit && this.rightLimit.equals(MaxValue)) {
        this.rightLimit = limit;
        this.rightNums = this.rightLimit.value.div(this.minPriceIncrement.value);
        this.right = new VPTLimit(num, direction);
      } else if (this.rightLimit && limit.compareTo(this.rightLimit) > 0) {
        this.right.addLimit(direction, limit.subtract(this.rightLimit), num);
      } else {
        const temp = this.right;
        this.right = new VPTLimit(num, direction);
        this.right.rightLimit = this.rightLimit.subtract(limit);
        this.right.rightNums = this.right.rightLimit.value.div(this.right.minPriceIncrement.value);
        this.rightLimit = limit;
        this.rightNums = this.rightLimit.value.div(this.minPriceIncrement.value);
        this.right.right = temp;
      }
    } else {
      if (this.leftLimit && this.leftLimit.equals(MinValue)) {
        this.leftLimit = limit;
        this.leftNums = this.leftLimit.value.div(this.minPriceIncrement.value);
        this.left = new VPTLimit(num, direction);
      } else if (this.leftLimit && limit.compareTo(this.leftLimit) < 0) {
        this.left.addLimit(direction, limit.subtract(this.leftLimit), num);
      } else {
        const temp = this.left;
        this.left = new VPTLimit(num, direction);
        this.left.leftLimit = this.leftLimit.subtract(limit);
        this.left.leftNums = this.leftLimit.value.div(this.left.minPriceIncrement.value);
        this.leftLimit = limit;
        this.leftNums = this.leftLimit.value.div(this.minPriceIncrement.value);
        this.left.left = temp;
      }
    }
  }

  /**
   * @param {Price} price
   * @returns {Decimal}
   */
  getIncrements(price) {
    if (this.rightLimit && price.compareTo(this.rightLimit) > 0) {
      return this.rightNums.add(this.right.getIncrements(price.subtract(this.rightLimit)));
    } else if (this.leftLimit && price.compareTo(this.leftLimit) < 0) {
      return this.leftNums.add(this.left.getIncrements(price.subtract(this.leftLimit)));
    }
    return price.value.div(this.minPriceIncrement.value);
  }

  /**
   * @param {Decimal} increments
   * @returns {Price}
   */
  getPrice(increments) {
    if (increments.cmp(this.rightNums) > 0) {
      return this.rightLimit.add(this.right.getPrice(increments.sub(this.rightNums)));
    } else if (increments.cmp(this.leftNums) < 0) {
      return this.leftLimit.add(this.left.getPrice(increments.sub(this.leftNums)));
    }
    return new Price(increments.mul(this.minPriceIncrement.value));
  }

  isWholeIncrement(price) {
    if (this.right && this.rightLimit && price.compareTo(this.rightLimit) > 0) {
      return this.right.isWholeIncrement(price.subtract(this.rightLimit));
    } else if (this.left && this.leftLimit && price.compareTo(this.leftLimit) < 0) {
      return this.left.isWholeIncrement(price.subtract(this.leftLimit));
    }
    return price.value.mod(this.minPriceIncrement.value).isZero();
  }
}

export class VPT {
  /**
   * @param {string} vptSpec
   * @param {string} marketId
   * @param {Price | null} baseIncrement
   * @param {Price | null} minCabPrice
   */
  constructor(vptSpec, marketId = '', baseIncrement = null, minCabPrice = null) {
    this.spec = vptSpec ?? '';
    this.marketId = marketId;
    this.baseIncrement = baseIncrement ?? new Price(1);
    this.minCabPrice = minCabPrice;
    this._isValid = false;

    try {
      let parts = this.spec.split(';');
      if (parts.length === 1 && parts[0] === '') parts = [];

      let increment = this.baseIncrement;
      if (parts.length > 0) {
        increment = new Price(new Decimal(parts[0]));
      }

      this._vpt = new VPTLimit(increment);

      if (minCabPrice != null && minCabPrice.compareTo(increment) < 0) {
        this._vpt.addLimit(LimitDir.GreaterThan, new Price(0), minCabPrice);
        this._vpt.addLimit(LimitDir.GreaterThan, minCabPrice, increment.subtract(minCabPrice));
        this._vpt.addLimit(LimitDir.GreaterThan, increment, increment);
      }

      for (let i = 1; i < parts.length; i++) {
        const limParts = parts[i].split('=');
        if (limParts.length === 2) {
          const limitPrice = new Price(new Decimal(limParts[0].slice(2)));
          const limitIncrement = new Price(new Decimal(limParts[1]));
          const prefix = limParts[0].slice(0, 2).toUpperCase();
          if (prefix === 'P>') {
            this._vpt.addLimit(LimitDir.GreaterThan, limitPrice, limitIncrement);
          } else if (prefix === 'P<') {
            this._vpt.addLimit(LimitDir.LessThan, limitPrice, limitIncrement);
          } else {
            this._isValid = false;
            return;
          }
        }
      }
      this._isValid = true;
    } catch {
      this._isValid = false;
      this._vpt = new VPTLimit(new Price(1));
    }
  }

  getIsValid() { return this._isValid; }

  isWholeIncrement(price) { return this._vpt.isWholeIncrement(price); }

  priceToIncrements(price) { return this._vpt.getIncrements(price); }

  /**
   * @param {Decimal | number} increments
   * @returns {Price}
   */
  incrementsToPrice(increments) {
    const inc = increments instanceof Decimal ? increments : new Decimal(increments);
    return this._vpt.getPrice(inc);
  }

  addIncrements(price, increments) {
    return this.incrementsToPrice(this.priceToIncrements(price).add(increments));
  }
}
