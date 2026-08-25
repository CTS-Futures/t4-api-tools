package com.t4login.definitions.priceconversion;

/**
 * Contains the arguments needed to perform market price conversions.
 */
public interface IPriceFormatArgs {

    Price getMinCabPrice();
    String getPriceCode();
    int getDenominator();
    int getRealDecimals();
    int getClearingDecimals();
}
