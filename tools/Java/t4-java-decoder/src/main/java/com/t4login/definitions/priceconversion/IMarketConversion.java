package com.t4login.definitions.priceconversion;


import java.math.BigDecimal;

public interface IMarketConversion extends IPriceFormatArgs {

    String getMarketID();
    int getDenominator();
    String getPriceCode();
    Price getMinPriceIncrement();
    VPT getVPT();
    Price getMinCabPrice();
    int getRealDecimals();
    int getClearingDecimals();
    BigDecimal getPointValue();
    Integer getYieldYears();
    Double getYieldParValue();
    Double getYieldRate();
    Integer getYieldValueDenominator();
    Double getYieldRedemption();
    Double getYieldPaymentsPerYear();
    Integer getYieldBasis();
}
