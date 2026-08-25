package com.t4login.definitions.chartdata;

import com.t4login.datetime.NDateTime;
import com.t4login.definitions.BidOffer;
import com.t4login.definitions.MarketMode;
import com.t4login.definitions.priceconversion.IMarketConversion;
import com.t4login.definitions.priceconversion.Price;
import com.t4login.definitions.priceconversion.VPT;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Read state for chart data.
 */
@SuppressWarnings("WeakerAccess")
public class ChartDataState implements IMarketConversion {

    public static final ChartDataState empty = new ChartDataState();

    public ChartDataChange Change = ChartDataChange.None;

    public NDateTime TradeDate = NDateTime.MinValue;
    public long TradeDateTicks;

    public boolean MarketDefined = false;

    public String MarketID = "";
    public int Numerator = 0;
    public int Denominator = 0;
    public String PriceCode = "";
    public double TickValue = 0.0;
    public String VPT = "";
    public Price MinCabPrice = null;

    public Price MinPriceIncrement;
    public BigDecimal PointValue;

    public int LastTTV = 0;
    public long LastTimeTicks = 0;
    public Price LastTradePrice = null;
    public BigDecimal LastPriceIncrements = BigDecimal.ZERO;

    public int TradeVolume = 0;
    public BidOffer AtBidOrOffer = BidOffer.Undefined;
    public int[] OrderVolumes = new int[0];
    public boolean DueToSpread = false;
    public int OrderVolumeIndex = 0;        // Used by the chart data reader to publish individual volumes.

    // Bar details.
    public long BarStartTime = 0;
    public long BarCloseTime = 0;
    public Price BarOpenPrice = Price.Zero;
    public Price BarHighPrice = Price.Zero;
    public Price BarLowPrice = Price.Zero;
    public Price BarClosePrice = Price.Zero;
    public int BarVolume = 0;
    public int BarBidVolume = 0;
    public int BarOfferVolume = 0;
    public int BarTrades = 0;
    public int BarTradesAtBid = 0;
    public int BarTradesAtOffer = 0;

    // The TPO open/close prices for the 1 minute TPO interval.
    public long TPOStartTime = 0;
    public Price TPOBasePrice = Price.Zero;

    public Price TPOPrice = null;
    public int TPOVolume = 0;
    public int TPOVolumeAtBid = 0;
    public int TPOVolumeAtOffer = 0;
    public boolean TPOIsOpening = false;
    public boolean TPOIsClosing = false;

    // The last bid and offer values we wrote.
    public Price BidPrice = null;
    public int BidRealVolume = 0;
    public int BidImpliedVolume = 0;
    public Price OfferPrice = null;
    public int OfferRealVolume = 0;
    public int OfferImpliedVolume = 0;

    // The last market mode we wrote.
    public MarketMode Mode = MarketMode.Undefined;

    // The last settlement price we wrote </summary>
    public Price SettlementPrice = null;
    public Price SettlementHeldPrice = null;
    public int ClearedVolume = 0;
    public int OpenInterest = 0;
    public Price VWAP = null;


    // RFQ.
    public BidOffer RFQBuySell = BidOffer.Undefined;
    public int RFQVolume = 0;

    // Incremental state.
    public BigDecimal LastBarLowPriceIncrements = BigDecimal.ZERO;
    public BigDecimal LastTPOBasePriceIncrements = BigDecimal.ZERO;
    public BigDecimal LastBidPriceIncrements = BigDecimal.ZERO;


    //<editor-fold desc="IMarketConversion Implementation">
    @Override
    public String getMarketID() {
        return MarketID;
    }

    @Override
    public int getDenominator() {
        return Denominator;
    }

    @Override
    public String getPriceCode() {
        return PriceCode;
    }

    @Override
    public Price getMinPriceIncrement() {
        if (MinPriceIncrement == null || MinPriceIncrement.equals(Price.Zero)) {
            MinPriceIncrement = new Price(new BigDecimal(Numerator).divide(new BigDecimal(Denominator), Price.Scale, RoundingMode.HALF_EVEN));
        }

        return MinPriceIncrement;
    }

    @Override
    public VPT getVPT() {
        return null;
    }

    @Override
    public Price getMinCabPrice() {
        return null;
    }

    @Override
    public int getRealDecimals() {
        return 0;
    }

    @Override
    public int getClearingDecimals() {
        return 0;
    }

    @Override
    public BigDecimal getPointValue() {
        if (PointValue == null || PointValue.equals(BigDecimal.ZERO)) {
            PointValue = new BigDecimal(TickValue).divide(new BigDecimal(Numerator), Price.Scale, RoundingMode.HALF_EVEN).multiply(new BigDecimal(Denominator));
        }

        return PointValue;
    }

    @Override
    public Integer getYieldYears() {
        return null;
    }

    @Override
    public Double getYieldParValue() {
        return null;
    }

    @Override
    public Double getYieldRate() {
        return null;
    }

    @Override
    public Integer getYieldValueDenominator() {
        return null;
    }

    @Override
    public Double getYieldRedemption() {
        return null;
    }

    @Override
    public Double getYieldPaymentsPerYear() {
        return null;
    }

    @Override
    public Integer getYieldBasis() {
        return null;
    }
    //</editor-fold>
}
