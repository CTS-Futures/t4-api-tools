//! In-memory binary readers.
//!
//! Ports `byte_stream.hpp` (`ByteReader` + `CountingInputStream`). The counting
//! wrapper lets the chart readers detect and skip unread trailing bytes inside a
//! length-prefixed record.

use crate::error::{DecodeError, Result};

/// A source of bytes. Reads past the end return [`DecodeError::UnexpectedEof`],
/// mirroring the reference `EOFError`.
pub trait ByteSource {
    /// Read exactly one byte.
    fn read_byte(&mut self) -> Result<u8>;
    /// Read exactly `n` bytes.
    fn read_exact(&mut self, n: usize) -> Result<Vec<u8>>;
    /// Skip up to `n` bytes; returns the number actually skipped.
    fn skip(&mut self, n: usize) -> usize;
    /// Bytes remaining from the current position to the end.
    fn available(&self) -> usize;
}

/// Reader over a borrowed, contiguous byte buffer.
#[derive(Debug, Clone)]
pub struct ByteReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> ByteReader<'a> {
    /// Wrap a byte slice.
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    /// Total length of the underlying buffer.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Whether the underlying buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Current read position.
    pub fn position(&self) -> usize {
        self.pos
    }
}

impl ByteSource for ByteReader<'_> {
    fn read_byte(&mut self) -> Result<u8> {
        let b = *self.data.get(self.pos).ok_or(DecodeError::UnexpectedEof)?;
        self.pos += 1;
        Ok(b)
    }

    fn read_exact(&mut self, n: usize) -> Result<Vec<u8>> {
        let end = self.pos.checked_add(n).ok_or(DecodeError::UnexpectedEof)?;
        let slice = self.data.get(self.pos..end).ok_or(DecodeError::UnexpectedEof)?;
        self.pos = end;
        Ok(slice.to_vec())
    }

    fn skip(&mut self, n: usize) -> usize {
        let end = (self.pos + n).min(self.data.len());
        let skipped = end - self.pos;
        self.pos = end;
        skipped
    }

    fn available(&self) -> usize {
        self.data.len() - self.pos
    }
}

/// Wraps a [`ByteSource`] and counts bytes read since the last [`reset_count`].
///
/// [`reset_count`]: CountingReader::reset_count
#[derive(Debug, Clone)]
pub struct CountingReader<R: ByteSource> {
    inner: R,
    count: usize,
}

impl<R: ByteSource> CountingReader<R> {
    /// Wrap an inner source.
    pub fn new(inner: R) -> Self {
        Self { inner, count: 0 }
    }

    /// Bytes read since the last reset.
    pub fn count(&self) -> usize {
        self.count
    }

    /// Reset the running count to zero.
    pub fn reset_count(&mut self) {
        self.count = 0;
    }

    /// Access the wrapped source.
    pub fn inner(&self) -> &R {
        &self.inner
    }
}

impl<R: ByteSource> ByteSource for CountingReader<R> {
    fn read_byte(&mut self) -> Result<u8> {
        let b = self.inner.read_byte()?;
        self.count += 1;
        Ok(b)
    }

    fn read_exact(&mut self, n: usize) -> Result<Vec<u8>> {
        let data = self.inner.read_exact(n)?;
        self.count += data.len();
        Ok(data)
    }

    fn skip(&mut self, n: usize) -> usize {
        let skipped = self.inner.skip(n);
        self.count += skipped;
        skipped
    }

    fn available(&self) -> usize {
        self.inner.available()
    }
}
