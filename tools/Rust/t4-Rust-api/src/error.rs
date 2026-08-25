//! Error type shared across the decoder.

use core::fmt;

/// Anything that can go wrong while decoding a T4 binary stream.
///
/// Mirrors the reference ports, which throw `EOFError` on a short read and a
/// runtime error when a chart payload lacks a recognisable SOF signature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// A read ran past the end of the buffer.
    UnexpectedEof,
    /// The bytes were structurally invalid (e.g. an impossible length prefix).
    InvalidData(String),
    /// A chart HTTP body contained no T4Bin / T4BinAggr SOF signature.
    NoSofSignature,
    /// HTTP transport error (only with the `client` feature).
    #[cfg(feature = "client")]
    Http(String),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecodeError::UnexpectedEof => write!(f, "unexpected end of stream"),
            DecodeError::InvalidData(m) => write!(f, "invalid data: {m}"),
            DecodeError::NoSofSignature => {
                write!(f, "no T4Bin/T4BinAggr SOF signature in payload")
            }
            #[cfg(feature = "client")]
            DecodeError::Http(m) => write!(f, "http error: {m}"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Convenience alias used throughout the crate.
pub type Result<T> = core::result::Result<T, DecodeError>;
