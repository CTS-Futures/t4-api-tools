//! `Message.read*` helpers (mirroring .NET `BinaryWriter` conventions), plus
//! `decode_price` / `decode_price_n`.
//!
//! Port of `message_reader.{hpp,cpp}`.

use crate::byte_stream::ByteSource;
use crate::decimal::Decimal;
use crate::encoding::{decode_7bit_int, decode_7bit_long, decode_decimal};
use crate::error::Result;
use crate::n_date_time::NDateTime;
use crate::price::Price;

/// Assemble `n` little-endian bytes into an unsigned value.
fn read_le<S: ByteSource + ?Sized>(src: &mut S, n: usize) -> Result<u64> {
    let bytes = src.read_exact(n)?;
    let mut v = 0u64;
    for i in (0..n).rev() {
        v = (v << 8) | bytes[i] as u64;
    }
    Ok(v)
}

/// 4-byte little-endian signed integer.
pub fn read_integer<S: ByteSource + ?Sized>(src: &mut S) -> Result<i32> {
    Ok(read_le(src, 4)? as u32 as i32)
}

/// 8-byte little-endian signed long.
pub fn read_long<S: ByteSource + ?Sized>(src: &mut S) -> Result<i64> {
    Ok(read_le(src, 8)? as i64)
}

/// 8-byte little-endian IEEE-754 double.
pub fn read_double<S: ByteSource + ?Sized>(src: &mut S) -> Result<f64> {
    Ok(f64::from_bits(read_le(src, 8)?))
}

/// One-byte boolean.
pub fn read_boolean<S: ByteSource + ?Sized>(src: &mut S) -> Result<bool> {
    Ok(src.read_byte()? != 0)
}

/// 7-bit length prefix + UTF-8 body.
pub fn read_string<S: ByteSource + ?Sized>(src: &mut S) -> Result<String> {
    let length = decode_7bit_int(src)?;
    if length <= 0 {
        return Ok(String::new());
    }
    let bytes = src.read_exact(length as usize)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// One-byte length prefix + UTF-8 body.
pub fn read_short_string<S: ByteSource + ?Sized>(src: &mut S) -> Result<String> {
    let length = src.read_byte()?;
    if length == 0 {
        return Ok(String::new());
    }
    let bytes = src.read_exact(length as usize)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 8-byte tick long.
pub fn read_datetime<S: ByteSource + ?Sized>(src: &mut S) -> Result<NDateTime> {
    Ok(NDateTime::from_ticks(read_long(src)?))
}

/// 7-bit tick long.
pub fn read_7bit_datetime<S: ByteSource + ?Sized>(src: &mut S) -> Result<NDateTime> {
    Ok(NDateTime::from_ticks(decode_7bit_long(src)?))
}

/// Short-string price; `None` when the string is empty.
pub fn read_price<S: ByteSource + ?Sized>(src: &mut S) -> Result<Option<Price>> {
    let s = read_short_string(src)?;
    if s.is_empty() {
        return Ok(None);
    }
    let d = Decimal::from_string(&s).map_err(crate::error::DecodeError::InvalidData)?;
    Ok(Some(Price::new(d)))
}

/// 96-bit decimal → price.
pub fn decode_price<S: ByteSource + ?Sized>(src: &mut S) -> Result<Price> {
    Ok(Price::new(decode_decimal(src)?))
}

/// Header byte; if bit 0 is set, decode a decimal price, else `None`.
pub fn decode_price_n<S: ByteSource + ?Sized>(src: &mut S) -> Result<Option<Price>> {
    let hdr = src.read_byte()?;
    if hdr & 0x01 == 0x01 {
        Ok(Some(Price::new(decode_decimal(src)?)))
    } else {
        Ok(None)
    }
}
