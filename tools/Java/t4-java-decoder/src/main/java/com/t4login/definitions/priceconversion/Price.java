package com.t4login.definitions.priceconversion;

import com.t4login.util.VBMath;

import java.io.Serializable;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;

/**
 * Represents a price.
 */
public class Price implements Serializable, Comparable<Price>, Cloneable {

    //<editor-fold desc="Static Members">
    public static final String TAG = "Price";

    public static final int Scale = 18;
    public static final Price MaxValue = new Price(new BigDecimal("79228162514264337593543950335"));
    public static final Price MinValue = new Price(new BigDecimal("-79228162514264337593543950335"));
    public static final Price Zero = new Price(0);

    public enum RoundingDirection {
        Up,
        Down
    }
    //</editor-fold>

    //<editor-fold desc="Class Members and Constructors">

    private final BigDecimal mDecimalValue;
    private final double mDoubleValue;


    public Price(int value) {
        mDecimalValue = BigDecimal.valueOf(value).setScale(Scale, BigDecimal.ROUND_HALF_EVEN);
        mDoubleValue = (double)value;
    }

    public Price(double value) {
        mDecimalValue = BigDecimal.valueOf(value).setScale(Scale, BigDecimal.ROUND_HALF_EVEN);
        mDoubleValue = value;
    }

    public Price(BigDecimal value) {
        mDecimalValue = value.setScale(Scale, BigDecimal.ROUND_HALF_EVEN);
        mDoubleValue = mDecimalValue.doubleValue();
    }

    //</editor-fold>

    //<editor-fold desc="Clonable Implementation">
    public Object clone() throws CloneNotSupportedException {
        return super.clone();
    }
    //</editor-fold>

    //<editor-fold desc="Static Methods">
    public static Price of(int value) {
        return new Price(value);
    }

    public static Price of(double value) {
        return new Price(value);
    }

    public static Price of(String value) {
        return new Price(new BigDecimal(value));
    }

    /**
     * Converts the specified tick value to Price.
     * @param mkt The market parameters that apply to the tick value.
     * @param ticks The tick value.
     * @return The price corresponding to the tick value.
     */
    public static Price fromTicks(IMarketConversion mkt, int ticks) {

        BigDecimal decimalTicks = new BigDecimal(ticks);
        BigDecimal decimalDenominator = new BigDecimal(mkt.getDenominator());
        return new Price(decimalTicks.divide(decimalDenominator, Price.Scale, BigDecimal.ROUND_HALF_EVEN));
    }

    /**
     * Return the specified price if it is valid (non-null), otherwise converts the ticks and returns that instead.
     * (This is just a convenience method.)
     * @param price The price.
     * @param mkt The market parameters to convert the tick value.
     * @param ticks The tick value.
     * @return The price.
     */
    public static Price getOrConvert(Price price, IMarketConversion mkt, int ticks) {

        // TODO: Implement this.
        return null;
    }
    //</editor-fold>

    //<editor-fold desc="Public Methods">
    /**
     * Gets the decimal value of this Price.
     * <p/>
     * @return The decimal value of this price.
     */
    public BigDecimal getDecimalValue() {
        return mDecimalValue;
    }

    /**
     * Gets the value of this Price as a double.
     * <p/>
     * @return The value of this price.
     */
    public double getDoubleValue() {
        return mDoubleValue;
    }

    /**
     * Returns whether this price is integral, meaning there is no fractional part and the value could be stored as an integer.
     * This is used by the chart data storage to optimize memory utilization.
     * <p/>
     * @return True if the price value is integral.
     */
    public boolean isIntegral() {

        return mDecimalValue.stripTrailingZeros().scale() <= 0;
    }

    /**
     * Gets the value of this Price as an integer.
     * <p/>
     * @return The value of this price.
     */
    public int getIntegerValue() {
        return mDecimalValue.intValue();
    }

    /**
     * Returns the absolute value of this price.
     * <p/>
     * @return The absolute value of this price.
     */
    public Price abs() {
        if (mDecimalValue.compareTo(BigDecimal.ZERO) < 0) {
            return new Price(mDecimalValue.abs());
        } else {
            return this;
        }
    }

    /**
     * Returns the negated value of this Price.
     * <p/>
     * @return The negated value of this price.
     */
    public Price negated() {
        return new Price(mDecimalValue.negate());
    }

    /**
     * Adds the specified Price value to this price value.
     * <p/>
     * @param value The price to add.
     * @return A new price representing the sum of this and the specified price.
     */
    public Price add(Price value) {
        return new Price(mDecimalValue.add(value.mDecimalValue));
    }

    /**
     * Adds the specified Price value to this price value.
     * <p/>
     * @param value The price to add.
     * @return A new price representing the sum of this and the specified price.
     */
    public Price add(BigDecimal value) {
        return new Price(mDecimalValue.add(value));
    }

    /**
     * Subtracts the specified price value from this price value.
     * <p/>
     * @param value The price to subtract.
     * @return A new price representing the difference of this and the specified price.
     */
    public Price subtract(Price value) {
        return new Price(mDecimalValue.subtract(value.mDecimalValue));
    }

    /**
     * Subtracts the specified price value from this price value.
     * <p/>
     * @param value The price to subtract.
     * @return A new price representing the difference of this and the specified price.
     */
    public Price subtract(BigDecimal value) {
        return new Price(mDecimalValue.subtract(value));
    }

    public Price multiply(Price value) {
        return new Price(mDecimalValue.multiply(value.mDecimalValue));
    }

    public Price multiply(BigDecimal value) {
        return new Price(mDecimalValue.multiply(value));
    }

    public Price multiply(double value) {
        return new Price(mDecimalValue.multiply(new BigDecimal(value)));
    }

    public Price divide(Price value) {
        return new Price(mDecimalValue.divide(value.mDecimalValue, Scale, RoundingMode.HALF_EVEN));
    }

    public Price divide(BigDecimal value) {
        return new Price(mDecimalValue.divide(value, Scale, RoundingMode.HALF_EVEN));
    }

    public Price divide(double value) {
        return new Price(mDecimalValue.divide(new BigDecimal(value), Scale, RoundingMode.HALF_EVEN));
    }

    /**
     * Adds the specified number of price increments to this price.
     * <p/>
     * @param market The market defining this price.
     * @param increments The number of increments to add.
     * @return This price incremented.
     */
    public Price addIncrements(IMarketConversion market, int increments) {

        if (market.getVPT() == null || market.getVPT().getIsValid()) {
            return this.add(market.getMinPriceIncrement().multiply(new BigDecimal(increments)));
        } else {
            return market.getVPT().addIncrements(this, new BigDecimal(increments));
        }
    }

    /**
     * Adds the specified number of price increments to this price.
     * <p/>
     * @param market The market defining this price.
     * @param increments The number of increments to add.
     * @return This price incremented.
     */
    public Price addIncrements(IMarketConversion market, BigDecimal increments) {

        if (market.getVPT() == null || market.getVPT().getIsValid()) {
            return this.add(market.getMinPriceIncrement().multiply(increments));
        } else {
            return market.getVPT().addIncrements(this, increments);
        }
    }

    public Price round(IMarketConversion market) {
        BigDecimal increments = toIncrements(market);
        int wholeIncrements = VBMath.CInt(increments);
        return Price.fromIncrements(market, wholeIncrements);
    }

    public Price round(IMarketConversion market, RoundingDirection direction) {
        if (direction.equals(RoundingDirection.Down)) {
            return roundUp(market);
        } else {
            return roundDown(market);
        }
    }

    public Price roundUp(IMarketConversion market) {

        BigDecimal increments = toIncrements(market);

        if (increments.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) != 0) {
            increments = increments.setScale(0, RoundingMode.CEILING);
            return fromIncrements(market, increments);
        }

        return this;
    }

    public Price roundDown(IMarketConversion market) {

        BigDecimal increments = toIncrements(market);

        if (increments.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) != 0) {
            increments = increments.setScale(0, RoundingMode.FLOOR);
            return fromIncrements(market, increments);
        }

        return this;
    }

    public Price roundToNearest(IMarketConversion market) {

        Price up = roundUp(market);
        Price down = roundDown(market);

        if (up.subtract(this).abs().compareTo(down.subtract(this).abs()) < 0) {
            return up;
        } else {
            return down;
        }
    }

    public BigDecimal toIncrements(IMarketConversion market) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {
            return mDecimalValue.divide(market.getMinPriceIncrement().getDecimalValue(), RoundingMode.HALF_EVEN);
        } else {
            return market.getVPT().priceToIncrements(this);
        }
    }

    public int toWholeIncrements(IMarketConversion market) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {
            BigDecimal incrDec = mDecimalValue.divide(market.getMinPriceIncrement().mDecimalValue);
            return incrDec.setScale(0, RoundingMode.HALF_EVEN).intValue();
        } else {
            return market.getVPT().priceToIncrements(this).setScale(0, RoundingMode.HALF_EVEN).intValue();
        }
    }

    public int toWholeIncrements(IMarketConversion market, RoundingDirection round) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {

            BigDecimal incrDec = mDecimalValue.divide(market.getMinPriceIncrement().mDecimalValue);

            if (round == RoundingDirection.Down) {
                return incrDec.setScale(0, RoundingMode.FLOOR).intValue();
            } else {
                return incrDec.setScale(0, RoundingMode.CEILING).intValue();
            }
        } else {
            return market.getVPT().priceToIncrements(this).setScale(0, (round == RoundingDirection.Down ? RoundingMode.DOWN : RoundingMode.UP)).intValue();
        }
    }

    public static Price fromIncrements(IMarketConversion market, int increments) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {
            return new Price(new BigDecimal(increments).multiply(market.getMinPriceIncrement().getDecimalValue()));
        } else {
            return market.getVPT().incrementsToPrice(increments);
        }
    }

    public static Price fromIncrements(IMarketConversion market, BigDecimal increments) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {
            return new Price(increments.multiply(market.getMinPriceIncrement().getDecimalValue()));
        } else {
            return market.getVPT().incrementsToPrice(increments);
        }
    }

    /**
     * Converts this price to a tick value.
     * @param mkt The market parameters to apply to the tick value.
     * @return The price as a tick value. (Note: The result value may not be a whole tick increment. Use toTicksRounded() if that is necessary.)
     */
    public Integer toTicks(IMarketConversion mkt) {

        return mDecimalValue.multiply(new BigDecimal(mkt.getDenominator())).intValue();
    }

    /**
     * Converts this price to a tick value, rounding in the specified direction, if necessary.
     * @param mkt The market parameters that apply to the tick value.
     * @param dir The direction to round the result if not a whole tick increment.
     * @return The price as a tick value.
     */
    public Integer toTicksRounded(IMarketConversion mkt, RoundingDirection dir) {

        // TODO: Implement this.
        return null;
    }

    public boolean isWholeIncrement(IMarketConversion market) {

        if (market.getVPT() == null || !market.getVPT().getIsValid()) {
            return (mDecimalValue.remainder(market.getMinPriceIncrement().getDecimalValue()).compareTo(BigDecimal.ZERO) == 0);
        } else {
            return market.getVPT().isWholeIncrement(this);
        }
    }

    public BigDecimal toCash(IMarketConversion market) {

        return mDecimalValue.multiply(market.getPointValue());
    }

    public static Price fromCash(IMarketConversion market, BigDecimal cashValue) {
        return new Price(cashValue.divide(market.getPointValue(), Price.Scale, BigDecimal.ROUND_HALF_EVEN));
    }
    //</editor-fold>

    //<editor-fold desc="Overrides">

    @Override
    public String toString() {

        String formatted;
        if (mDecimalValue.compareTo(BigDecimal.ZERO) == 0) {
            // Workaround for Java 7 bug.
            formatted = "0";
        } else {
            formatted = mDecimalValue.stripTrailingZeros().toPlainString();
        }

        DecimalFormat format = (DecimalFormat) DecimalFormat.getInstance();
        DecimalFormatSymbols symbols = format.getDecimalFormatSymbols();
        char sep = symbols.getDecimalSeparator();

        if (sep != '.') {
            // Workaround bug due to toPlainString() using "." as decimal regardless of locale.
            formatted = formatted.replace('.', sep);
        }

        return formatted;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        Price price = (Price) o;

        return mDecimalValue != null ? mDecimalValue.compareTo(price.mDecimalValue) == 0 : price.mDecimalValue == null;
    }

    @Override
    public int hashCode() {
        return Double.valueOf(mDoubleValue).hashCode();
    }

    @Override
    public int compareTo(Price o) {
        if (o == null) {
            return 1;
        }

        return mDecimalValue.compareTo(o.mDecimalValue);
    }
    //</editor-fold>
}
