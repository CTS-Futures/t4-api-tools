//! Numeric-stack tests: BigInt, Decimal (half-even), Price.

use t4decoder::{BigInt, Decimal, MarketDefinition, Price};

#[test]
fn bigint_basics() {
    let a = BigInt::from_i64(1_000_000_007);
    let b = BigInt::from_i64(999_999_999);
    assert_eq!(a.add(&b).to_string(), "2000000006");
    assert_eq!(a.mul(&b).to_string(), "1000000005999999993");
    assert_eq!(BigInt::from_i64(-5).abs().to_string(), "5");
    assert_eq!(BigInt::power_of_ten(18).to_string(), "1000000000000000000");
    let (q, r) = BigInt::from_i64(100).div_mod_scalar(7);
    assert_eq!((q.to_string().as_str(), r), ("14", 2));
}

#[test]
fn decimal_half_even() {
    let cases = [
        ("2.5", 0, "2"),   // round half to even (2)
        ("3.5", 0, "4"),   // round half to even (4)
        ("0.125", 2, "0.12"),
        ("0.135", 2, "0.14"),
        ("-2.5", 0, "-2"),
    ];
    for (input, scale, want) in cases {
        let got = Decimal::from_string(input).unwrap().set_scale_half_even(scale);
        assert_eq!(got.to_string(), want, "{input} @ scale {scale}");
    }
}

#[test]
fn decimal_divide_int_scale18() {
    // 20001 / 4 = 5000.25 quantised to scale 18.
    let d = Decimal::divide_int(&BigInt::from_i64(20001), 4, 18);
    assert_eq!(d.to_string(), "5000.250000000000000000");
}

#[test]
fn price_from_ticks() {
    let md = MarketDefinition::new(
        "ES".into(),
        1,
        4,
        "0.25".into(),
        Decimal::from_string("12.5").unwrap(),
        String::new(),
        None,
    );
    let p = Price::from_ticks(&md, 20001);
    assert_eq!(p.to_string(), "5000.250000000000000000");
    assert_eq!(Price::zero().to_string(), "0");
}
