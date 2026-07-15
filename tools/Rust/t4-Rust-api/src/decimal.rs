//! Exact base-10 decimal: `value = unscaled * 10^(-scale)`, `scale >= 0`.
//!
//! Port of `decimal.{hpp,cpp}`. Mirrors the subset of Java `BigDecimal` /
//! `decimal.js` (ROUND_HALF_EVEN) the chart decoder uses. The wire decimal codec
//! produces `(unscaled, scale)` directly, so no general long division is needed
//! here — only `set_scale` (×/÷ powers of ten with half-even), `add`/`sub`/`mul`
//! (exact), and `divide_int` (int/int → fixed scale, half-even).

use core::cmp::Ordering;
use core::fmt;

use crate::big_int::BigInt;

/// Exact base-10 decimal.
#[derive(Clone, Debug, Default)]
pub struct Decimal {
    unscaled: BigInt,
    scale: i32,
}

/// `10^e` for `e <= 9` (fits in u64).
fn pow10_u64(e: u32) -> u64 {
    let mut r = 1u64;
    for _ in 0..e {
        r *= 10;
    }
    r
}

/// `floor(|mag| / 10^e)`, plus the exact remainder `|mag| mod 10^e`.
fn floor_div_pow10(mag: &BigInt, e: u32) -> (BigInt, BigInt) {
    let mut q = mag.abs();
    let mut remaining = e;
    while remaining > 0 {
        let step = remaining.min(9);
        let (nq, _) = q.div_mod_scalar(pow10_u64(step));
        q = nq;
        remaining -= step;
    }
    let remainder = mag.abs().sub(&q.mul(&BigInt::power_of_ten(e)));
    (q, remainder)
}

impl Decimal {
    /// The value zero (scale 0).
    pub fn zero() -> Self {
        Decimal::default()
    }

    /// Construct from an `(unscaled, scale)` pair.
    pub fn new(unscaled: BigInt, scale: i32) -> Self {
        Decimal { unscaled, scale }
    }

    /// Construct an integer-valued decimal (scale 0).
    pub fn from_i64(v: i64) -> Self {
        Decimal {
            unscaled: BigInt::from_i64(v),
            scale: 0,
        }
    }

    /// Parse a plain decimal string (optional sign, optional single dot).
    pub fn from_string(s: &str) -> Result<Self, String> {
        let bytes = s.as_bytes();
        let mut i = 0;
        let mut neg = false;
        if let Some(&c) = bytes.first() {
            if c == b'+' || c == b'-' {
                neg = c == b'-';
                i = 1;
            }
        }
        let mut digits = String::new();
        let mut scale = 0i32;
        let mut seen_dot = false;
        for &c in &bytes[i..] {
            if c == b'.' {
                if seen_dot {
                    return Err("Decimal::from_str: two dots".into());
                }
                seen_dot = true;
                continue;
            }
            if !c.is_ascii_digit() {
                return Err("Decimal::from_str: bad char".into());
            }
            digits.push(c as char);
            if seen_dot {
                scale += 1;
            }
        }
        if digits.is_empty() {
            digits.push('0');
        }
        let signed = if neg {
            format!("-{digits}")
        } else {
            digits
        };
        Ok(Decimal {
            unscaled: BigInt::from_decimal_str(&signed)?,
            scale,
        })
    }

    /// The unscaled integer.
    pub fn unscaled(&self) -> &BigInt {
        &self.unscaled
    }

    /// The scale (number of fractional digits).
    pub fn scale(&self) -> i32 {
        self.scale
    }

    /// `-1`, `0`, or `+1`.
    pub fn sign(&self) -> i32 {
        self.unscaled.sign()
    }

    /// True when the value is zero.
    pub fn is_zero(&self) -> bool {
        self.unscaled.is_zero()
    }

    /// Negation.
    pub fn negated(&self) -> Self {
        Decimal {
            unscaled: self.unscaled.negated(),
            scale: self.scale,
        }
    }

    /// Absolute value.
    pub fn abs(&self) -> Self {
        Decimal {
            unscaled: self.unscaled.abs(),
            scale: self.scale,
        }
    }

    fn scale_up_by(&self, n: i32) -> Self {
        if n <= 0 {
            return self.clone();
        }
        Decimal {
            unscaled: self.unscaled.mul(&BigInt::power_of_ten(n as u32)),
            scale: self.scale + n,
        }
    }

    /// Return an equal-value decimal rounded/extended to exactly `target_scale`,
    /// using banker's rounding (HALF_EVEN) when digits are dropped.
    pub fn set_scale_half_even(&self, target_scale: i32) -> Self {
        if target_scale == self.scale {
            return self.clone();
        }
        if target_scale > self.scale {
            return self.scale_up_by(target_scale - self.scale);
        }

        let drop = (self.scale - target_scale) as u32;
        let (mut q, remainder) = floor_div_pow10(&self.unscaled, drop);

        // Half-even on the dropped fraction: compare 2*remainder against 10^drop.
        let divisor = BigInt::power_of_ten(drop);
        let twice = remainder.add(&remainder);
        let mut round_up = false;
        match BigInt::compare(&twice, &divisor) {
            Ordering::Greater => round_up = true,
            Ordering::Equal => {
                let (_, odd) = q.div_mod_scalar(2);
                round_up = odd == 1;
            }
            Ordering::Less => {}
        }
        if round_up {
            q = q.add(&BigInt::from_i64(1));
        }
        if self.unscaled.sign() < 0 {
            q = q.negated();
        }
        Decimal {
            unscaled: q,
            scale: target_scale,
        }
    }

    /// Remove trailing zero fractional digits, reducing scale (never below 0).
    ///
    /// Mirrors Python's `Decimal(unscaled) / 10^scale` normalisation used by the
    /// wire decimal decoder (so `12.500000000000000000` prints as `12.5`).
    pub fn strip_trailing_zeros(&self) -> Self {
        if self.scale <= 0 || self.unscaled.is_zero() {
            return self.clone();
        }
        let mut u = self.unscaled.clone();
        let mut s = self.scale;
        while s > 0 {
            let (q, rem) = u.div_mod_scalar(10);
            if rem != 0 {
                break;
            }
            u = q;
            s -= 1;
        }
        Decimal {
            unscaled: u,
            scale: s,
        }
    }

    /// Exact sum.
    pub fn add(&self, o: &Decimal) -> Self {
        let t = self.scale.max(o.scale);
        let au = self.unscaled.mul(&BigInt::power_of_ten((t - self.scale) as u32));
        let bu = o.unscaled.mul(&BigInt::power_of_ten((t - o.scale) as u32));
        Decimal {
            unscaled: au.add(&bu),
            scale: t,
        }
    }

    /// Exact difference.
    pub fn subtract(&self, o: &Decimal) -> Self {
        let t = self.scale.max(o.scale);
        let au = self.unscaled.mul(&BigInt::power_of_ten((t - self.scale) as u32));
        let bu = o.unscaled.mul(&BigInt::power_of_ten((t - o.scale) as u32));
        Decimal {
            unscaled: au.sub(&bu),
            scale: t,
        }
    }

    /// Exact product.
    pub fn multiply(&self, o: &Decimal) -> Self {
        Decimal {
            unscaled: self.unscaled.mul(&o.unscaled),
            scale: self.scale + o.scale,
        }
    }

    /// `round(numerator / denominator)` at `target_scale`, HALF_EVEN. The
    /// denominator must be a positive integer within `div_mod_scalar` limits
    /// (market denominators and `10^k, k<=9` always are).
    pub fn divide_int(numerator: &BigInt, denominator: u64, target_scale: i32) -> Self {
        let sign = numerator.sign();
        let scaled = numerator
            .abs()
            .mul(&BigInt::power_of_ten(target_scale as u32));
        let (mut q, rem) = scaled.div_mod_scalar(denominator);
        let twice = rem * 2; // rem < denom, no overflow
        match twice.cmp(&denominator) {
            Ordering::Greater => q = q.add(&BigInt::from_i64(1)),
            Ordering::Equal => {
                let (_, odd) = q.div_mod_scalar(2);
                if odd == 1 {
                    q = q.add(&BigInt::from_i64(1));
                }
            }
            Ordering::Less => {}
        }
        if sign < 0 {
            q = q.negated();
        }
        Decimal {
            unscaled: q,
            scale: target_scale,
        }
    }

    /// Value comparison (ignores scale differences).
    pub fn compare(a: &Decimal, b: &Decimal) -> Ordering {
        let t = a.scale.max(b.scale);
        let au = a.unscaled.mul(&BigInt::power_of_ten((t - a.scale) as u32));
        let bu = b.unscaled.mul(&BigInt::power_of_ten((t - b.scale) as u32));
        BigInt::compare(&au, &bu)
    }

    /// Whether two decimals represent the same value.
    pub fn equals_value(&self, o: &Decimal) -> bool {
        Decimal::compare(self, o) == Ordering::Equal
    }
}

impl fmt::Display for Decimal {
    /// Plain decimal string (no scientific notation), e.g. `-109.050`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let digits = self.unscaled.abs().to_string(); // "0", "109050", ...
        let neg = self.unscaled.sign() < 0;
        let body = if self.scale <= 0 {
            digits
        } else {
            let s = self.scale as usize;
            if digits.len() <= s {
                format!("0.{}{}", "0".repeat(s - digits.len()), digits)
            } else {
                let cut = digits.len() - s;
                format!("{}.{}", &digits[..cut], &digits[cut..])
            }
        };
        if neg {
            f.write_str("-")?;
        }
        f.write_str(&body)
    }
}
