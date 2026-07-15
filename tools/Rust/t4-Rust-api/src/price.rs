//! Decimal-precision price quantised to scale 18 with HALF_EVEN rounding.
//!
//! Port of `price.{hpp,cpp}`. Matches Java `BigDecimal` at scale 18. Wraps the
//! dependency-free [`Decimal`](crate::Decimal).

use core::cmp::Ordering;
use core::fmt;

use crate::big_int::BigInt;
use crate::decimal::Decimal;
use crate::market::MarketConversion;

/// A price value, quantised to [`Price::SCALE`] fractional digits.
#[derive(Clone, Debug)]
pub struct Price {
    value: Decimal,
}

impl Default for Price {
    fn default() -> Self {
        // Matches C++ `Price()` — the raw zero decimal (scale 0), which renders
        // as "0". A price built from a value is quantised to SCALE.
        Price {
            value: Decimal::zero(),
        }
    }
}

impl Price {
    /// The fixed decimal scale of a quantised price.
    pub const SCALE: i32 = 18;

    /// Quantise a decimal to scale 18 (half-even).
    pub fn new(d: Decimal) -> Self {
        Price {
            value: d.set_scale_half_even(Self::SCALE),
        }
    }

    /// The value zero (scale 0), matching the default.
    pub fn zero() -> Self {
        Price::default()
    }

    /// The underlying decimal.
    pub fn value(&self) -> &Decimal {
        &self.value
    }

    /// True when zero.
    pub fn is_zero(&self) -> bool {
        self.value.is_zero()
    }

    /// `-1`, `0`, or `+1`.
    pub fn sign(&self) -> i32 {
        self.value.sign()
    }

    /// Tick value → price using the market denominator (scale 18, half-even).
    pub fn from_ticks<M: MarketConversion + ?Sized>(mkt: &M, ticks: i64) -> Self {
        let denom = mkt.denominator();
        Price::new(Decimal::divide_int(
            &BigInt::from_i64(ticks),
            denom as u64,
            Self::SCALE,
        ))
    }

    /// Increment count → price. Uses VPT if the market defines a valid one,
    /// otherwise `increments * min_price_increment`.
    pub fn from_increments<M: MarketConversion + ?Sized>(mkt: &M, increments: &Decimal) -> Self {
        // VPT is a stub (`is_valid() == false`), so this always takes the
        // uniform-tick fallback — matching the reference ports.
        match mkt.vpt() {
            Some(vpt) if vpt.is_valid() => {
                Price::new(increments.multiply(mkt.min_price_increment().value()))
            }
            _ => Price::new(increments.multiply(mkt.min_price_increment().value())),
        }
    }

    /// Sum.
    pub fn add(&self, o: &Price) -> Self {
        Price::new(self.value.add(&o.value))
    }

    /// Difference.
    pub fn subtract(&self, o: &Price) -> Self {
        Price::new(self.value.subtract(&o.value))
    }

    /// Product.
    pub fn multiply(&self, o: &Price) -> Self {
        Price::new(self.value.multiply(&o.value))
    }

    /// Add a raw decimal.
    pub fn add_decimal(&self, d: &Decimal) -> Self {
        Price::new(self.value.add(d))
    }

    /// Value comparison.
    pub fn compare_to(&self, o: &Price) -> Ordering {
        Decimal::compare(&self.value, &o.value)
    }

    /// Value equality.
    pub fn equals(&self, o: &Price) -> bool {
        self.compare_to(o) == Ordering::Equal
    }
}

impl fmt::Display for Price {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.value)
    }
}
