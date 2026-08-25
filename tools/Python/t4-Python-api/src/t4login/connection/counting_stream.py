"""Port of ``com.t4login.connection.CountingInputStream``.

A stream wrapper that tracks the number of bytes read since the last reset.

The T4 binary protocol frames each record with a length prefix. After reading
the length, the stream reader resets the counter, processes the record's fields,
then checks whether all expected bytes have been consumed. Any remaining bytes
(from newer format versions with extra fields) are safely skipped. This class
enables that pattern without requiring callers to manually track positions.
"""

from __future__ import annotations

from typing import BinaryIO


class CountingInputStream:
    """Filter stream that maintains a resettable count of bytes read.

    Wraps any ``BinaryIO`` stream and adds byte-counting. Used internally by
    the chart data stream readers to track how many bytes have been consumed
    within the current record so that any trailing/unknown bytes can be skipped.
    """

    __slots__ = ("_stream", "_total_bytes_read")

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        self._total_bytes_read: int = 0

    def get_count(self) -> int:
        """Return the number of bytes read since the last ``reset_count()``."""
        return self._total_bytes_read

    def reset_count(self) -> None:
        """Reset the byte count to 0."""
        self._total_bytes_read = 0

    def read(self, n: int = 1) -> bytes:
        """Read up to *n* bytes from the underlying stream."""
        data = self._stream.read(n)
        if data:
            self._total_bytes_read += len(data)
        return data

    def read_exact(self, n: int) -> bytes:
        """Read exactly *n* bytes, raising EOFError if not enough data."""
        data = self._stream.read(n)
        if not data or len(data) < n:
            raise EOFError(f"Expected {n} bytes, got {len(data) if data else 0}")
        self._total_bytes_read += len(data)
        return data

    def skip(self, n: int) -> int:
        """Skip up to *n* bytes, returning the number actually skipped.

        The return value may be less than *n* if the stream is near end-of-file.
        Callers that require exactly *n* bytes to be skipped must check the
        return value; unlike :meth:`read_exact`, this method never raises.
        """
        data = self._stream.read(n)
        skipped = len(data) if data else 0
        self._total_bytes_read += skipped
        return skipped

    def available(self) -> int:
        """Return an estimate of bytes remaining (seeks to end and back).

        Returns 0 if the stream does not support seeking.
        """
        try:
            pos = self._stream.tell()
            self._stream.seek(0, 2)  # seek to end
            end = self._stream.tell()
            self._stream.seek(pos)
            return end - pos
        except (OSError, AttributeError):
            return 0
