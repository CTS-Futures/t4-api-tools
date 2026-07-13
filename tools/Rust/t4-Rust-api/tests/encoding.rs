//! Round-trip tests for the 7-bit and 96-bit-decimal codecs.

use t4decoder::{
    decode_7bit_int, decode_7bit_long, decode_decimal, encode_7bit_int, encode_7bit_long,
    encode_decimal, ByteReader, ByteSource, Decimal,
};

fn roundtrip_int(v: i32) {
    let bytes = encode_7bit_int(v);
    let mut r = ByteReader::new(&bytes);
    assert_eq!(decode_7bit_int(&mut r).unwrap(), v, "i32 {v}");
    assert_eq!(r.available(), 0, "i32 {v} left bytes");
}

fn roundtrip_long(v: i64) {
    let bytes = encode_7bit_long(v);
    let mut r = ByteReader::new(&bytes);
    assert_eq!(decode_7bit_long(&mut r).unwrap(), v, "i64 {v}");
    assert_eq!(r.available(), 0, "i64 {v} left bytes");
}

#[test]
fn seven_bit_int_roundtrip() {
    for v in [0, 1, 2, 63, 64, 127, 128, 16383, 16384, i32::MAX, -1, -2, -128, i32::MIN] {
        roundtrip_int(v);
    }
    // Positive ints are 1..=5 bytes; negatives are always exactly 5.
    assert_eq!(encode_7bit_int(0).len(), 1);
    assert_eq!(encode_7bit_int(-1).len(), 5);
}

#[test]
fn seven_bit_long_roundtrip() {
    for v in [0i64, 1, 127, 128, i64::from(i32::MAX) + 1, i64::MAX, -1, -2, i64::MIN] {
        roundtrip_long(v);
    }
    assert_eq!(encode_7bit_long(-1).len(), 10);
}

#[test]
fn decimal_roundtrip() {
    for s in ["0", "1", "12.5", "-109.05", "5000.250000000000000000", "0.000000001", "-0.25"] {
        let d = Decimal::from_string(s).unwrap();
        let bytes = encode_decimal(&d);
        let mut r = ByteReader::new(&bytes);
        let back = decode_decimal(&mut r).unwrap();
        assert!(back.equals_value(&d), "decimal {s}: got {back} want {d}");
    }
}
