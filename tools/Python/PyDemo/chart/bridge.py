"""Thread-safe bridge between chart-window callbacks and the asyncio app.

The lightweight-charts window runs in its own process; its Python-side event
callbacks (interval switcher, clicks, range changes) are dispatched on the
asyncio loop that runs ``show_async``. This is the same loop that drives
PyDemo's tkinter update loop, so scheduling work back into the app is just a
matter of launching coroutines safely and never letting a callback exception
escape into the chart's event dispatcher.

:class:`CallbackBridge` provides that: ``run_coro`` schedules a coroutine
factory on the loop (thread-safe), and ``guard`` wraps a sync callback so
exceptions are logged instead of killing the dispatcher.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Awaitable, Callable

log = logging.getLogger("pydemo.chart.bridge")


class CallbackBridge:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def run_coro(self, coro_factory: Callable[[], Awaitable]) -> None:
        """Schedule ``coro_factory()`` on the app loop from any thread."""
        def _launch() -> None:
            try:
                asyncio.ensure_future(coro_factory())
            except Exception:  # noqa: BLE001
                log.exception("chart callback failed to schedule coroutine")

        try:
            self._loop.call_soon_threadsafe(_launch)
        except RuntimeError:
            # Loop closed (app shutting down) - drop the callback.
            log.debug("event loop unavailable; dropping chart callback")

    def guard(self, fn: Callable) -> Callable:
        """Wrap a sync callback so exceptions are logged, not raised."""
        @functools.wraps(fn)
        def _wrapped(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except Exception:  # noqa: BLE001
                log.exception("chart callback %s raised", getattr(fn, "__name__", fn))
        return _wrapped
