"""Internal connection utilities for the T4 binary protocol.

Provides stream wrappers (e.g. :class:`~t4login.connection.counting_stream.CountingInputStream`)
used by the chart data stream readers to track byte positions within the
binary payload during decoding.
"""
