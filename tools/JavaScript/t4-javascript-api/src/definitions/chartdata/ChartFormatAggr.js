/**
 * Port of `com.t4login.definitions.chartdata.ChartFormatAggr`.
 *
 * - `Bar` (plain data object): single aggregated OHLCV bar.
 * - `MarketDefinition`: implements IMarketConversion with lazy
 *   min-price-increment and VPT derivation.
 * - CTAG_* constants for the aggregated (T4BinAggr) binary format.
 */

import { Decimal, HALF_EVEN } from '../../decimal.js';
import { Price, Scale } from '../priceconversion/Price.js';
import { VPT } from '../priceconversion/VPT.js';

// --- T4BinAggr tags ---------------------------------------------------------
export const CVAL_T4BINAGGR_VERSION = 1;

export const CTAG_SOF = 1;
export const CTAG_MARKET_DEFINITION = 2;
export const CTAG_MARKET_SWITCH = 3;
export const CTAG_TRADEDATE_SWITCH = 4;
export const CTAG_BAR_DELTA = 10;
export const CTAG_BAR = 11;
export const CTAG_MARKET_MODE = 20;
export const CTAG_OPEN_INTEREST = 21;
export const CTAG_SETTLEMENT_PRICE = 22;

// --- Bar --------------------------------------------------------------------

/**
 * Aggregated OHLCV bar.
 *
 * Field names preserve PascalCase from Java/Python for 1:1 parity.
 */
export class Bar {
  constructor({
    TradeDate,
    Time,
    CloseTime,
    MarketID,
    OpenPrice,
    HighPrice,
    LowPrice,
    ClosePrice,
    Volume,
    VolumeAtBid,
    VolumeAtOffer,
    Trades,
    TradesAtBid,
    TradesAtOffer,
  }) {
    this.TradeDate = TradeDate;
    this.Time = Time;
    this.CloseTime = CloseTime;
    this.MarketID = MarketID;
    this.OpenPrice = OpenPrice;
    this.HighPrice = HighPrice;
    this.LowPrice = LowPrice;
    this.ClosePrice = ClosePrice;
    this.Volume = Volume;
    this.VolumeAtBid = VolumeAtBid;
    this.VolumeAtOffer = VolumeAtOffer;
    this.Trades = Trades;
    this.TradesAtBid = TradesAtBid;
    this.TradesAtOffer = TradesAtOffer;
  }
}

// --- MarketDefinition -------------------------------------------------------

const _QUANTUM = new Decimal(10).pow(-Scale);

/**
 * Market parameters for price conversion (mirrors Java inner class).
 * Implements the IMarketConversion contract via explicit getters.
 */
export class MarketDefinition {
  constructor({
    MarketID,
    Numerator,
    Denominator,
    PriceCode,
    TickValue,
    VPT_str = '',
    MinCabPrice = null,
  }) {
    this.MarketID = MarketID;
    this.Numerator = Numerator;
    this.Denominator = Denominator;
    this.PriceCode = PriceCode;
    this.TickValue = TickValue instanceof Decimal ? TickValue : new Decimal(TickValue);
    this.VPT_str = VPT_str;
    this.MinCabPrice = MinCabPrice;

    const incr = new Decimal(this.Numerator)
      .div(new Decimal(this.Denominator))
      .toDecimalPlaces(Scale, HALF_EVEN);
    this._minPriceIncrement = new Price(incr);

    if ((this.VPT_str && this.VPT_str.length > 0) || this.MinCabPrice != null) {
      this._vpt = new VPT(this.VPT_str, this.MarketID, this._minPriceIncrement, this.MinCabPrice);
    } else {
      this._vpt = null;
    }
  }

  // --- IMarketConversion -------------------------------------------------
  getMarketId() { return this.MarketID; }
  getDenominator() { return this.Denominator; }
  getPriceCode() { return this.PriceCode; }
  getMinPriceIncrement() { return this._minPriceIncrement; }
  getVpt() { return this._vpt; }
  getMinCabPrice() { return this.MinCabPrice; }
  getRealDecimals() { return 0; }
  getClearingDecimals() { return 0; }
  getPointValue() { return new Decimal(0); }
  getYieldYears() { return 0; }
  getYieldParValue() { return 0; }
  getYieldRate() { return 0; }
  getYieldValueDenominator() { return 0; }
  getYieldRedemption() { return 0; }
  getYieldPaymentsPerYear() { return 0; }
  getYieldBasis() { return 0; }
}
