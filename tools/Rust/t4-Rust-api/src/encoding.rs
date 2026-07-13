//! Variable-length 7-bit codec + 96-bit decimal format.
//!
//! Port of `encoding.{hpp,cpp}`. Sign semantics mirror the Java/C# original
//! byte-for-byte:
//!   - positive ints  → 1..=5 bytes
//!   - negative ints  → always 5 bytes (final byte masked `& 0x0F`)
//!   - positive longs → 1..=9 bytes
//!   - negative longs → always 10 bytes

use crate::big_int::BigInt;
use crate::byte_stream::ByteSource;
use crate::decimal::Decimal;
use crate::error::Result;

const INT32_MIN: i32 = i32::MIN; // 0x8000_0000 sentinel
const TWO32: u64 = 4_294_967_296;

/// Decode a 7-bit-encoded signed 32-bit integer.
pub fn decode_7bit_int<S: ByteSource + ?Sized>(src: &mut S) -> Result<i32> {
    // Reconstruct in unsigned space (matches Java's int wrap), then reinterpret.
    let mut count: u32 = 0;
    let mut shift: u32 = 0;
    loop {
        let b = src.read_byte()?;
        // wrapping_shl matches Java's shift-amount masking for malformed input.
        count |= ((b & 0x7F) as u32).wrapping_shl(shift);
        shift += 7;
        if b & 0x80 == 0 {
            break;
        }
    }
    Ok(count as i32)
}

/// Decode a 7-bit-encoded signed 64-bit integer.
pub fn decode_7bit_long<S: ByteSource + ?Sized>(src: &mut S) -> Result<i64> {
    let mut count: u64 = 0;
    let mut shift: u32 = 0;
    loop {
        let b = src.read_byte()?;
        count |= ((b & 0x7F) as u64).wrapping_shl(shift);
        shift += 7;
        if b & 0x80 == 0 {
            break;
        }
    }
    Ok(count as i64)
}

/// Encode a signed 32-bit integer.
pub fn encode_7bit_int(value: i32) -> Vec<u8> {
    let mut out = Vec::new();
    if value >= 0 {
        let mut v = value as u32;
        while v >= 0x80 {
            out.push((v | 0x80) as u8);
            v >>= 7;
        }
        out.push(v as u8);
    } else {
        // Fixed 5 bytes, arithmetic right shift (sign-preserving) like Java `>>`.
        let mut v = value;
        for _ in 0..4 {
            out.push((v | 0x80u8 as i32) as u8);
            v >>= 7;
        }
        out.push((v & 0x0F) as u8);
    }
    out
}

/// Encode a signed 64-bit integer.
pub fn encode_7bit_long(value: i64) -> Vec<u8> {
    let mut out = Vec::new();
    if value >= 0 {
        let mut v = value as u64;
        while v >= 0x80 {
            out.push((v | 0x80) as u8);
            v >>= 7;
        }
        out.push(v as u8);
    } else {
        let mut v = value;
        for _ in 0..9 {
            out.push((v | 0x80i64) as u8);
            v >>= 7;
        }
        out.push((v & 0x0F) as u8);
    }
    out
}

/// Decode the 96-bit unscaled-decimal format (1 header byte, 2 bits per 32-bit
/// chunk, followed by up to four 7-bit magnitudes).
pub fn decode_decimal<S: ByteSource + ?Sized>(src: &mut S) -> Result<Decimal> {
    let hdr = src.read_byte()?;

    // Decode one 32-bit chunk given its 2-bit tag.
    fn decode_chunk<S: ByteSource + ?Sized>(src: &mut S, tag2: u8) -> Result<i32> {
        Ok(match tag2 {
            0x03 => INT32_MIN,
            0x02 => decode_7bit_int(src)?.wrapping_neg(),
            0x01 => decode_7bit_int(src)?,
            _ => 0,
        })
    }

    let b0 = decode_chunk(src, (hdr & 0xC0) >> 6)?;
    let b1 = decode_chunk(src, (hdr & 0x30) >> 4)?;
    let b2 = decode_chunk(src, (hdr & 0x0C) >> 2)?;
    let b3 = decode_chunk(src, hdr & 0x03)?;

    // 96-bit unsigned magnitude from the three low chunks (little-endian).
    let two32 = BigInt::from_u64(TWO32);
    let two64 = two32.mul(&two32);
    let mag = BigInt::from_u64(b2 as u32 as u64)
        .mul(&two64)
        .add(&BigInt::from_u64(b1 as u32 as u64).mul(&two32))
        .add(&BigInt::from_u64(b0 as u32 as u64));

    let scale = ((b3 as u32 & 0x00FF_0000) >> 16) as i32;
    let mag = if b3 < 0 { mag.negated() } else { mag }; // bit 31 of chunk 3 => negative

    // Normalise like Python's `Decimal(unscaled) / 10^scale` (drops trailing
    // zeros) so values such as tick_value render minimally (12.5, not 12.500…).
    Ok(Decimal::new(mag, scale).strip_trailing_zeros())
}

/// Encode a [`Decimal`] into the 96-bit header form (used by tests).
pub fn encode_decimal(value: &Decimal) -> Vec<u8> {
    let mut price_bits = [0i32; 4];

    // chunk 3: scale in bits 16.. plus sign bit 31.
    let mut bits3 = (value.scale() as u32) << 16;
    if value.sign() < 0 {
        bits3 |= 0x8000_0000;
    }
    price_bits[3] = bits3 as i32;

    // chunks 0..2: low 96 bits of |unscaled|, extracted as 32-bit limbs.
    let mag = value.unscaled().abs();
    let (q1, r0) = mag.div_mod_scalar(TWO32);
    let (q2, r1) = q1.div_mod_scalar(TWO32);
    let (_, r2) = q2.div_mod_scalar(TWO32);
    price_bits[0] = r0 as u32 as i32;
    price_bits[1] = r1 as u32 as i32;
    price_bits[2] = r2 as u32 as i32;

    fn tag(v: i32) -> u8 {
        if v == INT32_MIN {
            0x03
        } else if v < 0 {
            0x02
        } else if v > 0 {
            0x01
        } else {
            0x00
        }
    }

    let hdr = (tag(price_bits[0]) << 6)
        | (tag(price_bits[1]) << 4)
        | (tag(price_bits[2]) << 2)
        | tag(price_bits[3]);

    let mut out = vec![hdr];
    for &v in &price_bits {
        if v != 0 && v != INT32_MIN {
            let absv = v.unsigned_abs() as i32; // v == INT32_MIN already excluded
            out.extend_from_slice(&encode_7bit_int(absv));
        }
    }
    out
}
