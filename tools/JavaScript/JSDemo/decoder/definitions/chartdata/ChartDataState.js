/**
 * Port of `com.t4login.definitions.chartdata.ChartDataState`.
 *
 * Mutable state object populated by the non-aggregated reader. Field names
 * preserve PascalCase from the Java/Python sources for 1:1 parity.
 *
 * Also implements the IMarketConversion contract (camelCase methods) so it
 * can be passed to `Price.fromTicks` / `Price.fromIncrements`.
 */

import { Decimal, HALF_EVEN } from '../../decimal.js';
import { MinValue as _NDT_MinValue } from '../../datetime/NDateTime.js';
import { BidOffer } from '../BidOffer.js';
import { MarketMode } from '../MarketMode.js';
import { Price, Scale, Zero as _PriceZero } from '../priceconversion/Price.js';
import { ChartDataChange } from './ChartDataChange.js';

export class ChartDataState {
  constructor() {
    // --- Change type ---
    this.Change = ChartDataChange.NONE;

    // --- Trade date ---
    this.TradeDate = _NDT_MinValue;
    this.TradeDateTicks = 0n;

    // --- Market definition ---
    this.MarketDefined = false;
    this.MarketID = '';
    this.Numerator = 0;
    this.Denominator = 0;
    this.PriceCode = '';
    this.TickValue = 0.0;
    this.VPT = '';
    this.MinCabPrice = null;

    this.MinPriceIncrement = null;
    this.PointValue = null;

    // --- Last trade ---
    this.LastTTV = 0;
    this.LastTimeTicks = 0n;
    this.LastTradePrice = _PriceZero;
    this.LastPriceIncrements = new Decimal(0);

    this.TradeVolume = 0;
    this.AtBidOrOffer = BidOffer.Undefined;
    this.OrderVolumes = [];
    this.DueToSpread = false;
    this.OrderVolumeIndex = 0;

    // --- Bar details ---
    this.BarStartTime = 0n;
    this.BarCloseTime = 0n;
    this.BarOpenPrice = _PriceZero;
    this.BarHighPrice = _PriceZero;
    this.BarLowPrice = _PriceZero;
    this.BarClosePrice = _PriceZero;
    this.BarVolume = 0;
    this.BarBidVolume = 0;
    this.BarOfferVolume = 0;
    this.BarTrades = 0;
    this.BarTradesAtBid = 0;
    this.BarTradesAtOffer = 0;

    // --- TPO ---
    this.TPOStartTime = 0n;
    this.TPOBasePrice = _PriceZero;
    this.TPOPrice = null;
    this.TPOVolume = 0;
    this.TPOVolumeAtBid = 0;
    this.TPOVolumeAtOffer = 0;
    this.TPOIsOpening = false;
    this.TPOIsClosing = false;

    // --- Quote ---
    this.BidPrice = _PriceZero;
    this.BidRealVolume = 0;
    this.BidImpliedVolume = 0;
    this.OfferPrice = _PriceZero;
    this.OfferRealVolume = 0;
    this.OfferImpliedVolume = 0;

    // --- Market mode ---
    this.Mode = MarketMode.Undefined;

    // --- Settlement / OI / VWAP ---
    this.SettlementPrice = null;
    this.SettlementHeldPrice = null;
    this.ClearedVolume = 0;
    this.OpenInterest = 0;
    this.VWAP_Price = null;

    // --- RFQ ---
    this.RFQBuySell = BidOffer.Undefined;
    this.RFQVolume = 0;

    // --- Incremental state ---
    this.LastBarLowPriceIncrements = new Decimal(0);
    this.LastTPOBasePriceIncrements = new Decimal(0);
    this.LastBidPriceIncrements = new Decimal(0);
  }

  // --- IMarketConversion ------------------------------------------------

  getMarketId() { return this.MarketID; }
  getDenominator() { return this.Denominator; }
  getPriceCode() { return this.PriceCode; }

  getMinPriceIncrement() {
    if (this.MinPriceIncrement == null || this.MinPriceIncrement.equals(_PriceZero)) {
      const incr = new Decimal(this.Numerator)
        .div(new Decimal(this.Denominator))
        .toDecimalPlaces(Scale, HALF_EVEN);
      this.MinPriceIncrement = new Price(incr);
    }
    return this.MinPriceIncrement;
  }

  getVpt() { return null; }
  getMinCabPrice() { return null; }
  getRealDecimals() { return 0; }
  getClearingDecimals() { return 0; }

  getPointValue() {
    if (this.PointValue == null || this.PointValue.isZero()) {
      const num = new Decimal(this.Numerator);
      const tv = new Decimal(this.TickValue);
      const den = new Decimal(this.Denominator);
      this.PointValue = tv.div(num).toDecimalPlaces(Scale, HALF_EVEN).mul(den);
    }
    return this.PointValue;
  }

  getYieldYears() { return null; }
  getYieldParValue() { return null; }
  getYieldRate() { return null; }
  getYieldValueDenominator() { return null; }
  getYieldRedemption() { return null; }
  getYieldPaymentsPerYear() { return null; }
  getYieldBasis() { return null; }
}
