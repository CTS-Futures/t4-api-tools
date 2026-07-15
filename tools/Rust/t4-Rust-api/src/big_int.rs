//! Minimal arbitrary-precision signed integer (dependency-free).
//!
//! Port of `big_int.{hpp,cpp}`. Backs [`Decimal`](crate::Decimal) /
//! [`Price`](crate::Price). Only the subset the chart decoder needs is
//! implemented — notably **no general BigInt/BigInt long division** (the decode
//! path never needs it). Representation is sign-magnitude with base-1e9
//! little-endian limbs, making decimal rendering and power-of-ten scaling cheap.

use core::cmp::Ordering;
use core::fmt;

/// 1e9 per limb.
const KBASE: u32 = 1_000_000_000;
const KBASE64: u64 = KBASE as u64;

/// Sign-magnitude big integer with base-1e9 limbs.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BigInt {
    neg: bool,
    /// Little-endian, each limb `< KBASE`; empty means zero.
    mag: Vec<u32>,
}

impl BigInt {
    /// The value zero.
    pub fn zero() -> Self {
        BigInt::default()
    }

    /// Construct from an unsigned 64-bit value.
    pub fn from_u64(mut v: u64) -> Self {
        let mut mag = Vec::new();
        while v != 0 {
            mag.push((v % KBASE64) as u32);
            v /= KBASE64;
        }
        BigInt { neg: false, mag }
    }

    /// Construct from a signed 64-bit value.
    pub fn from_i64(v: i64) -> Self {
        let n = v < 0;
        let mut r = BigInt::from_u64(v.unsigned_abs());
        r.neg = !r.mag.is_empty() && n;
        r
    }

    /// Parse an optional leading `+`/`-` then decimal digits.
    pub fn from_decimal_str(s: &str) -> Result<Self, String> {
        let bytes = s.as_bytes();
        let mut i = 0;
        let mut neg = false;
        if let Some(&c) = bytes.first() {
            if c == b'+' || c == b'-' {
                neg = c == b'-';
                i = 1;
            }
        }
        if i >= bytes.len() {
            return Err("BigInt::from_decimal_str: no digits".into());
        }
        let ten = BigInt::from_i64(10);
        let mut r = BigInt::zero();
        for &c in &bytes[i..] {
            if !c.is_ascii_digit() {
                return Err("BigInt::from_decimal_str: bad digit".into());
            }
            r = r.mul(&ten).add(&BigInt::from_i64((c - b'0') as i64));
        }
        r.neg = !r.mag.is_empty() && neg;
        Ok(r)
    }

    /// `10^e`.
    pub fn power_of_ten(e: u32) -> Self {
        let q = (e / 9) as usize;
        let rem = e % 9;
        let mut lead = 1u32;
        for _ in 0..rem {
            lead *= 10;
        }
        let mut mag = vec![0u32; q];
        mag.push(lead);
        let mut r = BigInt { neg: false, mag };
        r.trim();
        r
    }

    /// True when the value is zero.
    pub fn is_zero(&self) -> bool {
        self.mag.is_empty()
    }

    /// `-1`, `0`, or `+1`.
    pub fn sign(&self) -> i32 {
        if self.mag.is_empty() {
            0
        } else if self.neg {
            -1
        } else {
            1
        }
    }

    /// Absolute value.
    pub fn abs(&self) -> Self {
        BigInt {
            neg: false,
            mag: self.mag.clone(),
        }
    }

    /// Negation (zero stays non-negative).
    pub fn negated(&self) -> Self {
        BigInt {
            neg: !self.mag.is_empty() && !self.neg,
            mag: self.mag.clone(),
        }
    }

    /// Signed three-way compare.
    pub fn compare(a: &BigInt, b: &BigInt) -> Ordering {
        let (sa, sb) = (a.sign(), b.sign());
        if sa != sb {
            return sa.cmp(&sb);
        }
        if sa == 0 {
            return Ordering::Equal;
        }
        let m = BigInt::cmp_mag(a, b);
        if sa > 0 {
            m
        } else {
            m.reverse()
        }
    }

    /// Sum.
    pub fn add(&self, o: &BigInt) -> Self {
        if self.neg == o.neg {
            let mut r = BigInt::add_mag(self, o);
            r.neg = !r.mag.is_empty() && self.neg;
            return r;
        }
        match BigInt::cmp_mag(self, o) {
            Ordering::Equal => BigInt::zero(),
            Ordering::Greater => {
                let mut r = BigInt::sub_mag(self, o);
                r.neg = !r.mag.is_empty() && self.neg;
                r
            }
            Ordering::Less => {
                let mut r = BigInt::sub_mag(o, self);
                r.neg = !r.mag.is_empty() && o.neg;
                r
            }
        }
    }

    /// Difference.
    pub fn sub(&self, o: &BigInt) -> Self {
        self.add(&o.negated())
    }

    /// Product.
    pub fn mul(&self, o: &BigInt) -> Self {
        if self.mag.is_empty() || o.mag.is_empty() {
            return BigInt::zero();
        }
        let mut mag = vec![0u32; self.mag.len() + o.mag.len()];
        for i in 0..self.mag.len() {
            let mut carry: u64 = 0;
            let ai = self.mag[i] as u64;
            for j in 0..o.mag.len() {
                let cur = mag[i + j] as u64 + ai * o.mag[j] as u64 + carry;
                mag[i + j] = (cur % KBASE64) as u32;
                carry = cur / KBASE64;
            }
            let mut k = i + o.mag.len();
            while carry != 0 {
                let cur = mag[k] as u64 + carry;
                mag[k] = (cur % KBASE64) as u32;
                carry = cur / KBASE64;
                k += 1;
            }
        }
        let mut r = BigInt {
            neg: self.neg != o.neg,
            mag,
        };
        r.trim();
        r
    }

    /// Divide `|self|` by a positive scalar `d`, returning `(quotient, remainder)`.
    ///
    /// The quotient carries `self`'s sign; the remainder is always `>= 0`. `d`
    /// must be small enough that `(d-1)*KBASE + (KBASE-1)` fits in `u64` (holds
    /// for `d` up to ~1.8e10, far above any market denominator or `10^k, k<=9`).
    pub fn div_mod_scalar(&self, d: u64) -> (BigInt, u64) {
        assert!(d != 0, "BigInt::div_mod_scalar: divide by zero");
        assert!(
            d <= (u64::MAX - (KBASE64 - 1)) / KBASE64 + 1,
            "BigInt::div_mod_scalar: divisor too large"
        );
        let mut mag = vec![0u32; self.mag.len()];
        let mut carry: u64 = 0;
        for i in (0..self.mag.len()).rev() {
            let cur = carry * KBASE64 + self.mag[i] as u64;
            mag[i] = (cur / d) as u32;
            carry = cur % d;
        }
        let mut q = BigInt { neg: self.neg, mag };
        q.trim();
        (q, carry)
    }

    // --- private helpers ---------------------------------------------------

    fn trim(&mut self) {
        while matches!(self.mag.last(), Some(&0)) {
            self.mag.pop();
        }
        if self.mag.is_empty() {
            self.neg = false;
        }
    }

    fn cmp_mag(a: &BigInt, b: &BigInt) -> Ordering {
        if a.mag.len() != b.mag.len() {
            return a.mag.len().cmp(&b.mag.len());
        }
        for i in (0..a.mag.len()).rev() {
            if a.mag[i] != b.mag[i] {
                return a.mag[i].cmp(&b.mag[i]);
            }
        }
        Ordering::Equal
    }

    fn add_mag(a: &BigInt, b: &BigInt) -> BigInt {
        let n = a.mag.len().max(b.mag.len());
        let mut mag = Vec::with_capacity(n + 1);
        let mut carry: u64 = 0;
        for i in 0..n {
            let mut s = carry;
            if i < a.mag.len() {
                s += a.mag[i] as u64;
            }
            if i < b.mag.len() {
                s += b.mag[i] as u64;
            }
            mag.push((s % KBASE64) as u32);
            carry = s / KBASE64;
        }
        if carry != 0 {
            mag.push(carry as u32);
        }
        let mut r = BigInt { neg: false, mag };
        r.trim();
        r
    }

    /// Requires `|a| >= |b|`.
    fn sub_mag(a: &BigInt, b: &BigInt) -> BigInt {
        let mut mag = Vec::with_capacity(a.mag.len());
        let mut borrow: i64 = 0;
        for i in 0..a.mag.len() {
            let mut s = a.mag[i] as i64 - borrow;
            if i < b.mag.len() {
                s -= b.mag[i] as i64;
            }
            if s < 0 {
                s += KBASE64 as i64;
                borrow = 1;
            } else {
                borrow = 0;
            }
            mag.push(s as u32);
        }
        let mut r = BigInt { neg: false, mag };
        r.trim();
        r
    }
}

impl From<i64> for BigInt {
    fn from(v: i64) -> Self {
        BigInt::from_i64(v)
    }
}

impl fmt::Display for BigInt {
    /// Signed decimal, no leading zeros.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.mag.is_empty() {
            return f.write_str("0");
        }
        if self.neg {
            f.write_str("-")?;
        }
        // Most-significant limb unpadded, the rest zero-padded to 9 digits.
        write!(f, "{}", self.mag[self.mag.len() - 1])?;
        for i in (0..self.mag.len() - 1).rev() {
            write!(f, "{:09}", self.mag[i])?;
        }
        Ok(())
    }
}
