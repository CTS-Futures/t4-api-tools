//! Locate the embedded T4Bin / T4BinAggr payload inside an HTTP chart response.
//!
//! Port of `payload.{hpp,cpp}` (`extractT4BinPayload`). Pure and transport-free.

use crate::error::{DecodeError, Result};

// SOF record signatures: length, tag=SOF(1), version=1 (LE int32).
/// Aggregated (T4BinAggr): record length 5.
const AGGR_SOF: [u8; 6] = [0x05, 0x01, 0x01, 0x00, 0x00, 0x00];
/// Non-aggregated (T4Bin): record length 13.
const BIN_SOF: [u8; 6] = [0x0d, 0x01, 0x01, 0x00, 0x00, 0x00];

fn index_of(hay: &[u8], need: &[u8; 6]) -> Option<usize> {
    if hay.len() < need.len() {
        return None;
    }
    hay.windows(need.len()).position(|w| w == need)
}

/// Return the payload slice starting at the first T4Bin or T4BinAggr SOF
/// signature. Empty input returns empty. Returns [`DecodeError::NoSofSignature`]
/// if a non-empty input contains no SOF signature.
pub fn extract_t4bin_payload(content: &[u8]) -> Result<&[u8]> {
    if content.is_empty() {
        return Ok(content);
    }

    let aggr_idx = index_of(content, &AGGR_SOF);
    let bin_idx = index_of(content, &BIN_SOF);

    let start = match (aggr_idx, bin_idx) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return Err(DecodeError::NoSofSignature),
    };
    Ok(&content[start..])
}
