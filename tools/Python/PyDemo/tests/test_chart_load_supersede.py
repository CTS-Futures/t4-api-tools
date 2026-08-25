"""Chart overlap fix: concurrent _load_history calls are serialized by a
generation token so only the newest load mutates the chart (set/recompute).

This guards against duplicate indicator line series: an interval switch + market
update interleaving (or rapid switches) used to run two _load_history passes,
each calling chart.set() + indicators.recompute(), stacking lines on top of each
other (chart.set() does NOT wipe create_line series).
"""

import asyncio

import chart.chart_window as cw_mod
from chart.chart_window import ChartWindow


class FakeChart:
    def __init__(self):
        self.is_alive = True
        self.set_calls = 0
        self.precision_calls = 0

    def precision(self, _d):
        self.precision_calls += 1

    def set(self, _df):
        self.set_calls += 1

    def fit(self):
        pass

    def watermark(self, _s):
        pass


class FakeIndicators:
    def __init__(self):
        self.recompute_calls = 0

    def recompute(self, _df):
        self.recompute_calls += 1


class FakeClient:
    market_details = {}          # .get(market_id) -> None (decimals default 2)
    jw_token = "tok"
    md_exchange_id = "EX"
    md_contract_id = "C"
    apiUrl = None
    priceFormat = 0


class FakeHistory:
    """Stands in for chart.history.ChartHistory; returns an empty bar set fast."""

    def __init__(self, *_a, **_k):
        pass

    def fetch(self, **_k):
        return [], "test"

    def close(self):
        pass


def _make_cw(loop, monkeypatch):
    monkeypatch.setattr(cw_mod, "ChartHistory", FakeHistory)
    cw = ChartWindow(FakeClient(), loop)
    cw._chart = FakeChart()
    cw._indicators = FakeIndicators()
    cw._loaded_market_id = "M"
    return cw


def test_stale_load_aborts_before_mutation(monkeypatch):
    async def run():
        cw = _make_cw(asyncio.get_running_loop(), monkeypatch)
        cw._load_gen = 5            # a newer load request has bumped the token
        await cw._load_history("M", gen=3)   # stale -> must abort
        assert cw._chart.set_calls == 0
        assert cw._indicators.recompute_calls == 0

    asyncio.run(run())


def test_current_load_mutates_once(monkeypatch):
    async def run():
        cw = _make_cw(asyncio.get_running_loop(), monkeypatch)
        cw._load_gen = 5
        await cw._load_history("M", gen=5)   # current -> proceeds
        assert cw._chart.set_calls == 1
        assert cw._indicators.recompute_calls == 1

    asyncio.run(run())


def test_dead_chart_aborts(monkeypatch):
    async def run():
        cw = _make_cw(asyncio.get_running_loop(), monkeypatch)
        cw._chart.is_alive = False           # window closed mid-load
        await cw._load_history("M", gen=cw._load_gen)
        assert cw._chart.set_calls == 0

    asyncio.run(run())
