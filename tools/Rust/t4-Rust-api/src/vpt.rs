//! Variable Price Tick — currently a documented stub.
//!
//! Port of `vpt.hpp`. The full VPT tree (non-uniform tick sizes parsed from
//! specs like `"25;P>100=50"`) needs general decimal/decimal division and is
//! exercised only by markets that publish a VPT spec. Neither
//! [`ChartDataState`](crate::ChartDataState) (its `vpt()` is `None`) nor the
//! aggregated golden fixture uses one, so the decoders fall back to the
//! `increments * min_price_increment` path. [`Vpt::is_valid`] returns `false`
//! here so callers always take that fallback.

/// A variable-price-tick spec (stub — see module docs).
#[derive(Clone, Debug, Default)]
pub struct Vpt {
    spec: String,
}

impl Vpt {
    /// Wrap a raw VPT spec string.
    pub fn new(spec: impl Into<String>) -> Self {
        Vpt { spec: spec.into() }
    }

    /// Always `false` in this stub — callers fall back to uniform ticks.
    pub fn is_valid(&self) -> bool {
        false
    }

    /// The raw spec string.
    pub fn spec(&self) -> &str {
        &self.spec
    }
}
