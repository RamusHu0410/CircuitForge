"""Live speed-run races on the website: rooms, quick match, the countdown and the leaderboard.

Everyone in a room builds the same challenge; the clock is the server's (a finish counts from the
server-side start, not from the browser). Whether a build passes is judged in the player's browser by
the circuit simulator, so a determined cheater could fake a pass; the leaderboard is a friendly one.

Kept free of FastAPI so it can be tested directly: a connection is anything with an async `send`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import string
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Challenge ids and their time limits (seconds). The challenges themselves live in the frontend
# (frontend/arena/challenges.ts); keep the ids in step.
CHALLENGES: dict[str, int] = {
    "first-light": 300,
    "button-lamp": 300,
    "divider": 420,
    "transistor": 600,
    "blink-code": 600,
    "toggle-code": 900,
    "heartbeat-555": 900,
    "steady-5v": 600,
    "low-pass": 600,
}
MAX_PLAYERS = 8
MAX_ROOMS = 500
COUNTDOWN_S = 3.5
QUICK_START_S = 12.0  # a public room starts this long after its second player joins
IDLE_ROOM_S = 30 * 60


def now_ms() -> float:
    return time.time() * 1000


def clean_name(name: object) -> str:
    text = re.sub(r"[\x00-\x1f<>]", "", str(name or "")).strip()[:20]
    return text or "player"


class LeaderboardEntry(BaseModel):
    name: str
    time_ms: int
    score: int
    at: float


@dataclass
class Player:
    id: str
    name: str
    send: Callable[[dict], Awaitable[None]]
    room: str | None = None
    ready: bool = False
    progress: float = 0.0  # 0..1, what the builder has done (parts placed / needed)
    attempts: int = 0
    finished_ms: int | None = None
    score: int | None = None
    msg_times: list[float] = field(default_factory=list)


@dataclass
class Room:
    code: str
    challenge: str
    host: str
    public: bool
    players: dict[str, Player] = field(default_factory=dict)
    state: str = "lobby"  # lobby | countdown | racing | done
    start_at: float | None = None  # server ms
    created: float = field(default_factory=now_ms)
    touched: float = field(default_factory=now_ms)
    task: asyncio.Task | None = None
    second_joined: float | None = None

    def view(self) -> dict:
        return {
            "code": self.code,
            "challenge": self.challenge,
            "host": self.host,
            "public": self.public,
            "state": self.state,
            "start_at": self.start_at,
            "limit_s": CHALLENGES.get(self.challenge, 600),
            "players": [
                {"id": p.id, "name": p.name, "ready": p.ready, "progress": round(p.progress, 3), "attempts": p.attempts, "finished_ms": p.finished_ms, "score": p.score}
                for p in self.players.values()
            ],
        }


class RaceHub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.board: dict[str, list[LeaderboardEntry]] = {}
        self.board_file: Path | None = None

    # --- leaderboard ------------------------------------------------------------------------

    def load_board(self, path: str | None) -> None:
        self.board_file = Path(path) if path else None
        if self.board_file and self.board_file.is_file():
            try:
                raw = json.loads(self.board_file.read_text(encoding="utf-8"))
                self.board = {k: [LeaderboardEntry(**e) for e in v] for k, v in raw.items() if k in CHALLENGES}
            except (OSError, ValueError, TypeError) as exc:
                logger.warning("ignoring unreadable leaderboard %s: %s", self.board_file, exc)

    def record(self, challenge: str, name: str, time_ms: int, score: int) -> None:
        entries = self.board.setdefault(challenge, [])
        entries.append(LeaderboardEntry(name=name, time_ms=time_ms, score=score, at=time.time()))
        entries.sort(key=lambda e: (e.time_ms, -e.score))
        del entries[50:]
        if self.board_file:
            try:
                self.board_file.write_text(json.dumps({k: [e.model_dump() for e in v] for k, v in self.board.items()}), encoding="utf-8")
            except OSError as exc:
                logger.warning("could not save the leaderboard: %s", exc)

    def leaderboard(self, challenge: str) -> list[LeaderboardEntry]:
        return list(self.board.get(challenge, [])[:20])

    # --- rooms --------------------------------------------------------------------------------

    def _code(self) -> str:
        for _ in range(100):
            code = "".join(random.choices(string.ascii_uppercase.replace("O", "").replace("I", ""), k=5))
            if code not in self.rooms:
                return code
        raise RuntimeError("no free room codes")

    async def _broadcast(self, room: Room) -> None:
        room.touched = now_ms()
        msg = {"type": "room", "room": room.view(), "now": now_ms()}
        for p in list(room.players.values()):
            try:
                await p.send(msg)
            except Exception:  # a closed socket: its own handler cleans it up
                pass

    def _cleanup(self) -> None:
        cutoff = now_ms() - IDLE_ROOM_S * 1000
        for code, room in list(self.rooms.items()):
            if not room.players or room.touched < cutoff:
                if room.task:
                    room.task.cancel()
                del self.rooms[code]

    async def _join(self, player: Player, room: Room) -> None:
        if player.room:
            await self.leave(player)
        if len(room.players) >= MAX_PLAYERS:
            await player.send({"type": "error", "message": "That room is full."})
            return
        if room.state != "lobby":
            await player.send({"type": "error", "message": "That race has already started."})
            return
        player.room = room.code
        player.ready = False
        player.progress = 0.0
        player.attempts = 0
        player.finished_ms = None
        player.score = None
        room.players[player.id] = player
        if room.public and len(room.players) == 2:
            room.second_joined = now_ms()
            room.task = asyncio.create_task(self._auto_start(room))
        await self._broadcast(room)

    async def _auto_start(self, room: Room) -> None:
        await asyncio.sleep(QUICK_START_S)
        if room.state == "lobby" and len(room.players) >= 2:
            await self._start(room)

    async def _start(self, room: Room) -> None:
        room.state = "countdown"
        room.start_at = now_ms() + COUNTDOWN_S * 1000
        await self._broadcast(room)
        if room.task and room.task is not asyncio.current_task():
            room.task.cancel()
        room.task = asyncio.create_task(self._run(room))

    async def _run(self, room: Room) -> None:
        await asyncio.sleep(COUNTDOWN_S)
        room.state = "racing"
        await self._broadcast(room)
        await asyncio.sleep(CHALLENGES.get(room.challenge, 600))
        if room.state == "racing":
            await self._finish(room)

    async def _finish(self, room: Room) -> None:
        room.state = "done"
        await self._broadcast(room)

    async def leave(self, player: Player) -> None:
        room = self.rooms.get(player.room or "")
        player.room = None
        if not room:
            return
        room.players.pop(player.id, None)
        if not room.players:
            if room.task:
                room.task.cancel()
            self.rooms.pop(room.code, None)
            return
        if room.host == player.id:
            room.host = next(iter(room.players))
        if room.state == "racing" and all(p.finished_ms is not None for p in room.players.values()):
            await self._finish(room)
        else:
            await self._broadcast(room)

    # --- messages -------------------------------------------------------------------------

    async def handle(self, player: Player, msg: dict) -> None:
        t = now_ms()
        player.msg_times = [x for x in player.msg_times if t - x < 1000] + [t]
        if len(player.msg_times) > 20:
            return  # flooding: drop
        kind = msg.get("type")
        room = self.rooms.get(player.room or "")

        if kind == "name":
            player.name = clean_name(msg.get("name"))
            if room:
                await self._broadcast(room)
        elif kind == "create":
            self._cleanup()
            if len(self.rooms) >= MAX_ROOMS:
                await player.send({"type": "error", "message": "The race server is full right now. Try again soon."})
                return
            challenge = msg.get("challenge") if msg.get("challenge") in CHALLENGES else "first-light"
            new = Room(code=self._code(), challenge=challenge, host=player.id, public=False)
            self.rooms[new.code] = new
            await self._join(player, new)
        elif kind == "join":
            target = self.rooms.get(str(msg.get("code", "")).upper().strip())
            if not target:
                await player.send({"type": "error", "message": "No room with that code."})
                return
            await self._join(player, target)
        elif kind == "quick":
            self._cleanup()
            open_room = next((r for r in self.rooms.values() if r.public and r.state == "lobby" and len(r.players) < 4), None)
            if not open_room:
                open_room = Room(code=self._code(), challenge=random.choice(list(CHALLENGES)), host=player.id, public=True)
                self.rooms[open_room.code] = open_room
            await self._join(player, open_room)
        elif kind == "leave":
            await self.leave(player)
        elif not room:
            await player.send({"type": "error", "message": "Join a room first."})
        elif kind == "challenge" and room.host == player.id and room.state == "lobby" and msg.get("challenge") in CHALLENGES:
            room.challenge = msg["challenge"]
            for p in room.players.values():
                p.ready = False
            await self._broadcast(room)
        elif kind == "ready" and room.state == "lobby":
            player.ready = bool(msg.get("ready"))
            await self._broadcast(room)
            if len(room.players) >= 2 and all(p.ready for p in room.players.values()):
                await self._start(room)
        elif kind == "start" and room.host == player.id and room.state == "lobby":
            if len(room.players) < 2:
                await player.send({"type": "error", "message": "A race needs at least two players. Invite someone with the room code, or race the bots."})
                return
            await self._start(room)
        elif kind == "progress" and room.state == "racing" and player.finished_ms is None:
            try:
                player.progress = max(0.0, min(1.0, float(msg.get("progress", 0))))
            except (TypeError, ValueError):
                return
            await self._broadcast(room)
        elif kind == "submit" and room.state == "racing" and player.finished_ms is None and room.start_at:
            player.attempts += 1
            if msg.get("ok") is True:
                player.finished_ms = int(t - room.start_at)
                player.progress = 1.0
                try:
                    player.score = max(0, min(100, int(msg.get("score", 0))))
                except (TypeError, ValueError):
                    player.score = 0
                self.record(room.challenge, player.name, player.finished_ms, player.score)
            if all(p.finished_ms is not None for p in room.players.values()):
                await self._finish(room)
            else:
                await self._broadcast(room)
        elif kind == "again" and room.state == "done" and room.host == player.id:
            room.state = "lobby"
            room.start_at = None
            for p in room.players.values():
                p.ready = False
                p.progress = 0.0
                p.attempts = 0
                p.finished_ms = None
                p.score = None
            await self._broadcast(room)


HUB = RaceHub()
