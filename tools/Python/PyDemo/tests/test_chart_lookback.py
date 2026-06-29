"""Chart Bug 1: the interval-scaled history window sizing (pure function)."""

from chart.chart_window import lookback_days

TARGET = 500
FLOOR = 2
CEIL = 120


def _bars(interval_sec, days):
    """Approx bars over `days` at `interval_sec`, assuming ~23h trading/day."""
    if interval_sec >= 86400:
        return days
    return days * (23 * 3600) // interval_sec


def test_low_intervals_sit_at_floor():
    # 15s and 1m hit ~500 bars well within the 2-day floor, so they stay at it.
    assert lookback_days(15, TARGET, FLOOR, CEIL) == FLOOR
    assert lookback_days(60, TARGET, FLOOR, CEIL) == FLOOR


def test_higher_intervals_scale_up():
    # 15m must load many more days than the old fixed 2 — enough for ~500 bars.
    d15m = lookback_days(900, TARGET, FLOOR, CEIL)
    assert d15m > FLOOR
    assert _bars(900, d15m) >= TARGET * 0.9     # well above the old ~184 bars
    # 1h scales further still.
    d1h = lookback_days(3600, TARGET, FLOOR, CEIL)
    assert d1h > d15m
    assert _bars(3600, d1h) >= TARGET * 0.9


def test_clamped_to_ceiling():
    # A coarse interval × big target must never exceed the ceiling.
    assert lookback_days(3600, 100000, FLOOR, CEIL) == CEIL


def test_daily_uses_calendar_days():
    assert lookback_days(86400, 300, FLOOR, CEIL) == min(300, CEIL)
