/**
 * Port of `com.t4login.connection.CountingInputStream`.
 *
 * Wraps a {@link ByteReader} and tracks the number of bytes read since the
 * last `resetCount()`. The chart-data readers use this to detect unread
 * trailing bytes within a length-prefixed record and skip them safely.
 */
export class CountingInputStream {
  /**
   * @param {import('./ByteReader.js').ByteReader} reader
   */
  constructor(reader) {
    this._reader = reader;
    this._count = 0;
  }

  getCount() {
    return this._count;
  }

  resetCount() {
    this._count = 0;
  }

  /**
   * @param {number} n
   * @returns {Uint8Array}
   */
  read(n = 1) {
    const data = this._reader.read(n);
    this._count += data.length;
    return data;
  }

  readByte() {
    const b = this._reader.readByte();
    this._count += 1;
    return b;
  }

  /**
   * @param {number} n
   * @returns {Uint8Array}
   */
  readExact(n) {
    const data = this._reader.readExact(n);
    this._count += data.length;
    return data;
  }

  /**
   * @param {number} n
   */
  skip(n) {
    const skipped = this._reader.skip(n);
    this._count += skipped;
    return skipped;
  }

  available() {
    return this._reader.remaining();
  }
}
