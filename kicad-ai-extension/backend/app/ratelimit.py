"""A small sliding-window rate limiter (per client address), for the public website."""

from __future__ import annotations

import time
from collections import deque


class RateLimiter:
    def __init__(self, limit: int, window_s: float, max_clients: int = 10_000) -> None:
        self.limit = limit
        self.window = window_s
        self.max_clients = max_clients
        self.hits: dict[str, deque[float]] = {}

    def allow(self, client: str, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        if len(self.hits) > self.max_clients:  # forget idle clients rather than grow forever
            self.hits = {k: v for k, v in self.hits.items() if v and t - v[-1] < self.window}
        q = self.hits.setdefault(client, deque())
        while q and t - q[0] >= self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(t)
        return True
