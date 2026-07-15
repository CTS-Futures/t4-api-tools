package com.t4login.definitions.chartdata;

import com.t4login.datetime.NDateTime;
import com.t4login.definitions.priceconversion.IMarketConversion;
import com.t4login.definitions.priceconversion.Price;
import com.t4login.definitions.priceconversion.VPT;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Chart data format definitions.
 */
@SuppressWarnings("unused")
public final class ChartFormatAggr {

    public static class Bar {

            public NDateTime TradeDate;
            public NDateTime Time;
        public NDateTime CloseTime;
        public String MarketID;
        public Price OpenPrice;
        public Price HighPrice;
        public Price LowPrice;
            public Price ClosePrice;
        public int Volume;
        public int VolumeAtBid;
        public int VolumeAtOffer;
        public int Trades;
        public int TradesAtBid;
        public int TradesAtOffer;

        public Bar(NDateTime tradeDate,
                   NDateTime time,
                   NDateTime closeTime,
                   String marketID,
                   Price openPrice,
                   Price highPrice,
                   Price lowPrice,
                   Price closePrice,
                   int volume,
                   int volumeAtBid,
                   int volumeAtOffer,
                   int trades,
                   int tradesAtBid,
                   int tradesAtOffer) {
            this.TradeDate = tradeDate;
            this.Time = time;
            this.CloseTime = closeTime;
            this.MarketID = marketID;
            this.OpenPrice = openPrice;
            this.HighPrice = highPrice;
            this.LowPrice = lowPrice;
            this.ClosePrice = closePrice;
            this.Volume = volume;
            this.VolumeAtBid = volumeAtBid;
            this.VolumeAtOffer = volumeAtOffer;
            this.Trades = trades;
            this.TradesAtBid = tradesAtBid;
            this.TradesAtOffer = tradesAtOffer;
        }
    }

    public static class MarketDefinition implements IMarketConversion {

        public String MarketID;
        public int Numerator;
        public int Denominator;
        public String PriceCode;
        public BigDecimal TickValue;
        public String VPT;
        public Price MinCabPrice;

        private Price mMinPriceIncrement;
        private VPT mVPT;

        public MarketDefinition(String marketID,
                                int numerator,
                                int denominator,
                                String priceCode,
                                BigDecimal tickValue,
                                String vpt,
                                Price minCabPrice) {
            this.MarketID = marketID;
            this.Numerator = numerator;
            this.Denominator = denominator;
            this.PriceCode = priceCode;
            this.TickValue = tickValue;
            this.VPT = vpt;
            this.MinCabPrice = minCabPrice;

            mMinPriceIncrement = new Price(new BigDecimal(this.Numerator).divide(new BigDecimal(this.Denominator), Price.Scale, RoundingMode.HALF_EVEN));

            if ((this.VPT != null && this.VPT.length() > 0) || this.MinCabPrice != null) {
                mVPT = new VPT(this.VPT, this.MarketID, mMinPriceIncrement, this.MinCabPrice);
            } else {
                mVPT = null;
            }
        }

        @Override
        public String getMarketID() {
            return this.MarketID;
        }

        @Override
        public int getDenominator() {
            return this.Denominator;
        }

        @Override
        public String getPriceCode() {
            return this.PriceCode;
        }

        @Override
        public Price getMinPriceIncrement() {
            return mMinPriceIncrement;
        }

        @Override
        public com.t4login.definitions.priceconversion.VPT getVPT() {
            return mVPT;
        }

        @Override
        public Price getMinCabPrice() {
            return this.MinCabPrice;
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
            return null;
        }

        @Override
        public Integer getYieldYears() {
            return 0;
        }

        @Override
        public Double getYieldParValue() {
            return 0.0;
        }

        @Override
        public Double getYieldRate() {
            return 0.0;
        }

        @Override
        public Integer getYieldValueDenominator() {
            return 0;
        }

        @Override
        public Double getYieldRedemption() {
            return 0.0;
        }

        @Override
        public Double getYieldPaymentsPerYear() {
            return 0.0;
        }

        @Override
        public Integer getYieldBasis() {
            return 0;
        }
    }

    public static final int CVAL_T4BINAGGR_VERSION = 1;     // Current binary version.

    public static final int CTAG_SOF = 1;
    public static final int CTAG_MARKET_DEFINITION = 2;

    public static final int CTAG_MARKET_SWITCH = 3;

    public static final int CTAG_TRADEDATE_SWITCH = 4;

    public static final int CTAG_BAR_DELTA = 10;
    public static final int CTAG_BAR = 11;

    public static final int CTAG_MARKET_MODE = 20;
    public static final int CTAG_OPEN_INTEREST = 21;
    public static final int CTAG_SETTLEMENT_PRICE = 22;

    private ChartFormatAggr() {
    }

}
