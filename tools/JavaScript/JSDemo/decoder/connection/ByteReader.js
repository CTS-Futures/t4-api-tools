/**
 * Lightweight binary reader over a Uint8Array.
 *
 * Replaces Python `BinaryIO` for cases where the entire payload is in
 * memory (which is the only mode the chart decoder uses). Tracks an
 * internal position cursor; reads beyond the end return shorter buffers
 * (mirroring `BinaryIO.read(n)` semantics).
 */
export class ByteReader {
  /**
   * @param {Uint8Array | ArrayBuffer} data
   */
  constructor(data) {
    if (data instanceof ArrayBuffer) {
      this._bytes = new Uint8Array(data);
    } else {
      this._bytes = data;
    }
    this._pos = 0;
  }

  /** Total bytes in the underlying buffer. */
  get length() {
    return this._bytes.length;
  }

  /** Current read position. */
  get position() {
    return this._pos;
  }

  /** Bytes remaining from the current position to the end. */
  remaining() {
    return this._bytes.length - this._pos;
  }

  /**
   * Read up to `n` bytes; returns the actual subarray (may be shorter at EOF).
   * @param {number} n
   * @returns {Uint8Array}
   */
  read(n = 1) {
    const end = Math.min(this._pos + n, this._bytes.length);
    const out = this._bytes.subarray(this._pos, end);
    this._pos = end;
    return out;
  }

  /**
   * Read exactly one byte; throws on EOF.
   * @returns {number}
   */
  readByte() {
    if (this._pos >= this._bytes.length) {
      throw new Error('Unexpected end of stream in readByte');
    }
    return this._bytes[this._pos++];
  }

  /**
   * Read exactly `n` bytes; throws on short read.
   * @param {number} n
   * @returns {Uint8Array}
   */
  readExact(n) {
    if (this._pos + n > this._bytes.length) {
      throw new Error(`Expected ${n} bytes, got ${this._bytes.length - this._pos}`);
    }
    const out = this._bytes.subarray(this._pos, this._pos + n);
    this._pos += n;
    return out;
  }

  /**
   * Skip up to `n` bytes; returns the number actually skipped.
   * @param {number} n
   */
  skip(n) {
    const start = this._pos;
    this._pos = Math.min(this._pos + n, this._bytes.length);
    return this._pos - start;
  }
}
