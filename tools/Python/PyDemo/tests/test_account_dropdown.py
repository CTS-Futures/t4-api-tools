"""Unit tests for populate_accounts (no Tk window needed).

AccountDetails arrives inside every account snapshot, so populate_accounts runs
again on each subscribe. It must not force the first account back into the
dropdown, or switching accounts immediately re-subscribes the first one.
"""

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import t4_gui  # noqa: E402


class _FakeDropdown:
    """The slice of ttk.Combobox that populate_accounts touches."""

    def __init__(self, current=""):
        self.values = []
        self._current = current

    def __setitem__(self, key, value):
        if key == "values":
            self.values = list(value)

    def get(self):
        return self._current

    def set(self, value):
        self._current = value


class _FakeGUI:
    def __init__(self, names, current=""):
        self.client = SimpleNamespace(
            accounts={name: SimpleNamespace(account_name=name) for name in names}
        )
        self.account_dropdown = _FakeDropdown(current)
        self.scheduled = 0

    async def on_account_selected(self):
        self.scheduled += 1


def _populate(gui, monkeypatch=None):
    """Run populate_accounts with create_task stubbed out."""
    calls = []

    def _fake_create_task(coro):
        calls.append(coro)
        coro.close()  # never awaited; closing avoids a RuntimeWarning

    real = t4_gui.asyncio.create_task
    t4_gui.asyncio.create_task = _fake_create_task
    try:
        t4_gui.T4_GUI.populate_accounts(gui)
    finally:
        t4_gui.asyncio.create_task = real
    return len(calls)


def test_first_account_is_selected_on_a_fresh_connect():
    gui = _FakeGUI(["AAA", "BBB"], current="")
    scheduled = _populate(gui)

    assert gui.account_dropdown.values == ["AAA", "BBB"]
    assert gui.account_dropdown.get() == "AAA"
    assert scheduled == 1


def test_an_existing_selection_is_not_stomped():
    gui = _FakeGUI(["AAA", "BBB"], current="BBB")
    scheduled = _populate(gui)

    assert gui.account_dropdown.get() == "BBB", "must not snap back to the first account"
    assert scheduled == 0, "must not re-subscribe on an account-details refresh"


def test_selection_falls_back_when_its_account_disappears():
    gui = _FakeGUI(["AAA", "BBB"], current="GONE")
    scheduled = _populate(gui)

    assert gui.account_dropdown.get() == "AAA"
    assert scheduled == 1


def test_no_accounts_is_a_no_op():
    gui = _FakeGUI([], current="")
    scheduled = _populate(gui)

    assert gui.account_dropdown.values == []
    assert scheduled == 0
