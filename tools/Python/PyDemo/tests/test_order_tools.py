"""Unit tests for OrderTools handler routing (no chart/window needed)."""

import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart.features.order_tools import OrderTools  # noqa: E402


class _FakeClient:
    def __init__(self):
        self.calls = []

    async def submit_order(self, side, vol, price, pt):
        self.calls.append(("submit", side, vol, float(price), pt))

    async def pull_order(self, uid):
        self.calls.append(("pull", uid))


class _FakeBridge:
    def run_coro(self, factory):
        asyncio.run(factory())

    def guard(self, fn):
        return fn


def _tools(orders=None, last=108.0, vol=2):
    client = _FakeClient()
    ot = OrderTools(None, _FakeBridge(), client,
                    order_provider=lambda: orders or {},
                    last_price_provider=lambda: last,
                    default_volume=vol)
    return ot, client


def test_context_buy_sell():
    ot, client = _tools()
    ot._on_context_action("buy", "105.0")
    ot._on_context_action("sell", "111.0")
    assert ("submit", "buy", 2, 105.0, "limit") in client.calls
    assert ("submit", "sell", 2, 111.0, "limit") in client.calls


def test_cancel_nearest():
    ot, client = _tools(orders={"o1": 105.0, "o2": 120.0})
    ot._on_context_action("cancel", "104.9")
    assert ("pull", "o1") in client.calls


def test_cancel_nearest_no_orders():
    ot, client = _tools(orders={})
    ot._on_context_action("cancel", "100")
    assert client.calls == []


def test_click_mode_gating():
    ot, client = _tools()
    ot.set_click_mode(False)  # set_click_mode without chart no-ops the run_script (chart=None)
    ot._click_mode = False    # ensure off (set_click_mode logged exception but set flag)
    ot.on_click(None, None, 100.0)
    assert client.calls == []
    ot._click_mode = True
    ot.on_click(None, None, 100.0)   # 100 < 108 -> buy
    assert ("submit", "buy", 2, 100.0, "limit") in client.calls


def test_infer_side_by_last_price():
    ot, _ = _tools(last=108.0)
    assert ot._infer_side(100.0) == "buy"    # below market
    assert ot._infer_side(120.0) == "sell"   # above market


def test_drag_uses_release_price():
    ot, client = _tools(last=108.0)
    ot._on_drag("100", "115.0")   # release 115 > 108 -> sell
    assert ("submit", "sell", 2, 115.0, "limit") in client.calls


def test_mode_toggle():
    ot, _ = _tools()
    ot._click_mode = False
    ot._on_mode("click")
    assert ot._click_mode is True
    ot._on_mode("click")
    assert ot._click_mode is False
