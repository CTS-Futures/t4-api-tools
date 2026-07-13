package com.t4login.definitions.priceconversion;

import com.t4login.Log;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;

@SuppressWarnings({"WeakerAccess", "unused"})
public class VPT {

    public static final String TAG = "VTT";

    //<editor-fold desc="VPTLimit Class, LimitDir enum">
    private enum LimitDir {
        GreaterThan, LessThan
    }

    @SuppressWarnings("WeakerAccess")
    private class VPTLimit {
        private VPTLimit left = null;
        private VPTLimit right = null;
        private Price minPriceIncrement;
        private Price leftLimit;
        private Price rightLimit;
        private BigDecimal leftNums;
        private BigDecimal rightNums;

        public VPTLimit(Price minPriceIncrement) {
            this.minPriceIncrement = minPriceIncrement;
            this.leftLimit = Price.MinValue;
            this.rightLimit = Price.MaxValue;
            this.leftNums = Price.MinValue.getDecimalValue();
            this.rightNums = Price.MaxValue.getDecimalValue();
        }

        public VPTLimit(LimitDir dir, Price minPriceIncrement) {
            this.minPriceIncrement = minPriceIncrement;

            if (dir.equals(LimitDir.GreaterThan)) {
                this.leftLimit = null;
                this.rightLimit = Price.MaxValue;
                this.leftNums = BigDecimal.ONE;
                this.rightNums = Price.MaxValue.getDecimalValue();
            } else {
                this.leftLimit = Price.MinValue;
                this.rightLimit = null;
                this.leftNums = Price.MinValue.getDecimalValue();
                this.rightNums = BigDecimal.ONE;
            }
        }

        public void addLimit(LimitDir dir, Price limit, Price num) {
            if (dir.equals(LimitDir.GreaterThan)) {
                if (this.rightLimit.equals(Price.MaxValue)) {
                    this.rightLimit = limit;
                    this.rightNums = rightLimit.getDecimalValue().divide(this.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.right = new VPTLimit(dir, num);
                } else if (limit.compareTo(this.rightLimit) > 0) {
                    this.right.addLimit(dir, limit.subtract(rightLimit), num);
                } else {
                    VPTLimit temp = this.right;
                    this.right = new VPTLimit(dir, num);
                    this.right.rightLimit = this.rightLimit.subtract(limit);
                    this.right.rightNums = this.right.rightLimit.getDecimalValue().divide(this.right.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.rightLimit = limit;
                    this.rightNums = this.rightLimit.getDecimalValue().divide(this.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.right.right = temp;
                }
            } else {
                if (this.leftLimit.equals(Price.MinValue)) {
                    this.leftLimit = limit;
                    this.leftNums = this.leftLimit.getDecimalValue().divide(this.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.left = new VPTLimit(dir, num);
                } else if (limit.compareTo(this.leftLimit) < 0) {
                    this.left.addLimit(dir, limit.subtract(this.leftLimit), num);
                } else {
                    VPTLimit temp = this.left;
                    this.left = new VPTLimit(dir, num);
                    this.left.leftLimit = this.leftLimit.subtract(limit);
                    this.left.leftNums = this.leftLimit.getDecimalValue().divide(this.left.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.leftLimit = limit;
                    this.leftNums = this.leftLimit.getDecimalValue().divide(this.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
                    this.left.left = temp;
                }
            }
        }

        public BigDecimal getIncrements(Price price) {
            if (this.rightLimit != null && price.compareTo(this.rightLimit) > 0) {
                return this.rightNums.add(this.right.getIncrements(price.subtract(this.rightLimit)));
            } else if (this.leftLimit != null && price.compareTo(this.leftLimit) < 0) {
                return this.leftNums.add(this.left.getIncrements(price.subtract(this.leftLimit)));
            } else {
                return price.getDecimalValue().divide(this.minPriceIncrement.getDecimalValue(), RoundingMode.HALF_EVEN);
            }
        }

        public Price getPrice(BigDecimal increments) {
            if (increments.compareTo(this.rightNums) > 0) {
                return this.rightLimit.add(this.right.getPrice(increments.subtract(this.rightNums)));
            } else if (increments.compareTo(this.leftNums) < 0) {
                return this.leftLimit.add(this.left.getPrice(increments.subtract(this.leftNums)));
            } else {
                return new Price(increments.multiply(this.minPriceIncrement.getDecimalValue()));
            }
        }

        public BigDecimal getIncrementForPrice(Price price) {
            if (this.rightLimit != null && price.compareTo(this.rightLimit) > 0) {
                return this.right.getIncrementForPrice(price.subtract(this.rightLimit));
            } else if (this.leftLimit != null && price.compareTo(this.leftLimit) < 0) {
                return this.left.getIncrementForPrice(price.subtract(this.leftLimit));
            } else {
                return this.minPriceIncrement.getDecimalValue();
            }
        }

        public BigDecimal getIncrementForIncrements(BigDecimal increments) {
            if (increments.compareTo(this.rightNums) > 0) {
                return this.right.getIncrementForIncrements(increments.subtract(this.rightNums));
            } else if (increments.compareTo(this.leftNums) < 0) {
                return this.left.getIncrementForIncrements(increments.subtract(this.leftNums));
            } else {
                return this.minPriceIncrement.getDecimalValue();
            }
        }

        public boolean isWholeIncrement(Price price) {
            if (right != null && price.compareTo(rightLimit) > 0) {
                return right.isWholeIncrement(price.subtract(rightLimit));
            } else if (left != null && price.compareTo(leftLimit) < 0) {
                return left.isWholeIncrement(price.subtract(leftLimit));
            } else {
                return (price.getDecimalValue().remainder(minPriceIncrement.getDecimalValue()).compareTo(BigDecimal.ZERO) == 0);
            }
        }
    }
    //</editor-fold>

    public final String spec;
    public final String marketID;
    public final Price baseIncrement;
    public final Price minCabPrice;

    private boolean isValid;
    private VPTLimit vpt;

    public VPT(String vttSpec) {
        this(vttSpec, "", new Price(BigDecimal.ONE), null);
    }

    /**
     * Creates a new VPT instance.
     * <p/>
     *
     * @param vptSpec       The VPT specification.
     * @param marketID      The market id (used for tracing).
     * @param baseIncrement The base increment.
     * @param minCabPrice   The optional min cab price.
     */
    public VPT(String vptSpec, String marketID, Price baseIncrement, Price minCabPrice) {

        this.spec = vptSpec != null ? vptSpec : "";
        this.marketID = marketID;
        this.baseIncrement = baseIncrement;
        this.minCabPrice = minCabPrice;

        try {

            String[] parts = this.spec.split(";");

            if (parts.length == 1 && parts[0].equals("")) {
                parts = new String[0];
            }

            // Get the default increment.
            if (parts.length > 0) {
                baseIncrement = new Price(new BigDecimal(parts[0]));
            }

            // Create the root node.
            this.vpt = new VPTLimit(baseIncrement);

            // Min cab price?
            if (minCabPrice != null && minCabPrice.compareTo(baseIncrement) < 0) {
                this.vpt.addLimit(LimitDir.GreaterThan, new Price(BigDecimal.ZERO), minCabPrice);
                this.vpt.addLimit(LimitDir.GreaterThan, minCabPrice, baseIncrement.subtract(minCabPrice));
                this.vpt.addLimit(LimitDir.GreaterThan, baseIncrement, baseIncrement);
            }

            // Process the remaining rules.
            for (int i = 1; i < parts.length; i++) {

                String[] limParts = parts[i].split("=");

                if (limParts.length == 2) {

                    Price limitPrice = new Price(new BigDecimal(limParts[0].substring(2)));
                    Price limitIncrement = new Price(new BigDecimal(limParts[1]));

                    if (limParts[0].toUpperCase(Locale.US).startsWith("P>")) {
                        this.vpt.addLimit(LimitDir.GreaterThan, limitPrice, limitIncrement);
                    } else if (limParts[0].toUpperCase(Locale.US).startsWith("P<")) {
                        this.vpt.addLimit(LimitDir.LessThan, limitPrice, limitIncrement);
                    } else {
                        this.isValid = false;
                        throw new IllegalArgumentException(String.format("'%s' is an invalid condition format. Expected 'P>' or 'P<'. VTT: '%s'", limParts[0], vptSpec));
                    }
                }
            }

            this.isValid = true;

        } catch (Exception ex) {
            this.isValid = false;
            Log.e(TAG, "Error parsing VTT.", ex);
        }

        if (!this.isValid) {
            this.vpt = new VPTLimit(new Price(BigDecimal.ONE));
        }
    }

    @Override
    public String toString() {
        return this.spec;
    }

    public String getSpec() {
        return this.spec;
    }

    public boolean getIsValid() {
        return this.isValid;
    }

    /**
     * Gets whether the specified price is a whole price increment or not.
     * <p/>
     * @param price The price to check.
     * @return True if the price is a whole price increment, false if the price is a fractional price increment.
     */
    public boolean isWholeIncrement(Price price) {
        return vpt.isWholeIncrement(price);
    }

    /**
     * Converts the price to a count of price increments.
     *<p/>
     * @param price The price.
     * @return The increment count (number of price intervals) for the price.
     */
    public BigDecimal priceToIncrements(Price price) {
        return this.vpt.getIncrements(price);
    }

    /**
     * Converts a count of price increments to a price.
     *<p/>
     * @param increments The number of price increments.
     * @return The price corresponding to the increment count.
     */
    public Price incrementsToPrice(BigDecimal increments) {
        return this.vpt.getPrice(increments);
    }

    /**
     * Converts a count of price increments to a price.
     *<p/>
     * @param increments The number of price increments.
     * @return The price corresponding to the increment count.
     */
    public Price incrementsToPrice(int increments) {
        return this.vpt.getPrice(new BigDecimal(increments));
    }

    /**
     * Returns the effective price increment for the price.
     *
     * @param price The price.
     * @return The effective price increment.
     */
    public BigDecimal getIncrementValueForPrice(Price price) {
        return this.vpt.getIncrementForPrice(price);
    }

    /**
     * Returns the effective price increment for the specified price increment count.
     *
     * @param increments The numerator count (number of price increments).
     * @return The effective numerator value.
     */
    public BigDecimal getIncrementValueForIncrements(BigDecimal increments) {
        return this.vpt.getIncrementForIncrements(increments);
    }

    /**
     * Adds the specified number of price increments to the price.
     *
     * @param price The price.
     * @param increments  The number of price increments to add.
     * @return The resulting price.
     */
    public Price addIncrements(Price price, BigDecimal increments) {
        return incrementsToPrice(priceToIncrements(price).add(increments));
    }

}
