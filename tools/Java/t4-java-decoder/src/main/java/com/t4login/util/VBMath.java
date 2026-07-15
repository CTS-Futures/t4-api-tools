package com.t4login.util;

import java.math.BigDecimal;

public final class VBMath {

	private VBMath() {
	}

	/**
	 * Converts the value to an integer, using bankers rounding.
	 *
	 * @param value
	 * @return
	 */
	public final static int CInt(BigDecimal value) {
		return CInt(value.doubleValue());
	}

	/**
	 * Converts the double to an integer, using bankers rounding.
	 *
	 * @param value
	 * @return
	 */
	public final static int CInt(double value) {
		double d = value % 1.0;
		double ad = Math.abs(d);
		double m = Math.abs(value - d);
		double sign = value < 0.0 ? -1.0 : 1.0;

		if (ad > 0.5) {
			return (int) (sign * (m + 1.0));
		} else if (ad == 0.5) {
			return (int) (sign * (m + (m % 2.0)));
		} else {
			return (int) (sign * m);
		}
	}

	/**
	 * Converts the double to integer by truncating the decimal portion
	 * (returning the next lower integer result for negative numbers.)
	 * 
	 * @param value
	 * @return
	 */
	public final static int Int(double value) {
		double d = value % 1.0;
		double m = Math.abs(value - d);

		if (value < 0.0) {
			return -1 * (int) (m + 1.0);
		} else {
			return (int) m;
		}
	}

	/**
	 * Converts the double to integer by truncating the decimal portion.
	 *
	 * @param value
	 * @return
	 */
	public final static int Fix(double value) {
		double d = value % 1.0;
		double m = Math.abs(value - d);

		if (value < 0.0) {
			return -1 * (int) (m);
		} else {
			return (int) m;
		}
	}

	/**
	 * Converts the double to integer by truncating the decimal portion.
	 *
	 * @param value
	 * @return
	 */
	public final static BigDecimal Fix(BigDecimal value) {
		BigDecimal d = value.remainder(BigDecimal.ONE);
		//BigDecimal m = Math.abs(value - d);
		BigDecimal m = value.subtract(d).abs();

		if (value.compareTo(BigDecimal.ZERO) < 0) {
			return m.negate();
		} else {
			return m;
		}
	}
}
