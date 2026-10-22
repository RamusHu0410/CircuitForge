"""The live race connection (website only): one WebSocket per player. See app/race.py."""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.race import HUB, Player, clean_name, now_ms

router = APIRouter(tags=["race"])
logger = logging.getLogger(__name__)
MAX_MESSAGE = 2048


@router.websocket("/race/ws")
async def race(ws: WebSocket) -> None:
    settings = get_settings()
    # Browsers send Origin on WebSocket handshakes, and HTTP middleware doesn't see them: check it here,
    # so another website can't sign players into races.
    origin = ws.headers.get("origin")
    if origin is not None and origin not in settings.allowed_origins:
        await ws.close(code=1008)
        return
    await ws.accept()

    async def send(msg: dict) -> None:
        await ws.send_text(json.dumps(msg))

    player = Player(id=uuid.uuid4().hex[:10], name=clean_name(ws.query_params.get("name")), send=send)
    await send({"type": "hello", "id": player.id, "now": now_ms()})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MESSAGE:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                await HUB.handle(player, msg)
    except WebSocketDisconnect:
        pass
    finally:
        await HUB.leave(player)
