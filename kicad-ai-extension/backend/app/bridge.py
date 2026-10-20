"""The CircuitForge window's line to the engine when it's opened from KiCad: no server, same process.

pywebview gives the page every public method of `Api` as `window.pywebview.api.<name>(...)`. Each takes
the same JSON the HTTP API takes and returns `{"ok": true, "data": ...}` or
`{"ok": false, "status": <HTTP status>, "detail": "<message>"}`, so the UI (frontend/api/client.ts)
treats a failure here exactly like the same failure from the HTTP routes.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from app import actions, instance
from app.actions import ActionError, ExportRequest, KiCadSession, SaveFilesRequest
from app.ai.circuit_generator import GenerationError
from app.config import Settings
from app.schemas.circuit import GenerateRequest, SchematicFiles
from app.services.generation_service import GenerationService

logger = logging.getLogger(__name__)

Reply = dict[str, Any]


class Api:
    """Names starting with "_" stay hidden from the page."""

    def __init__(self, settings: Settings, state_dir: Path | None = None) -> None:
        self._settings = settings
        self._service = GenerationService(settings)
        self._state_dir = state_dir
        self._session = KiCadSession()

    # --- called from the page -------------------------------------------------------------

    def generate(self, body: Any) -> Reply:
        return self._reply(lambda: self._service.generate(GenerateRequest.model_validate(body)))

    def desktop_info(self) -> Reply:
        return self._reply(lambda: actions.desktop_info(self._settings, self._current_session()))

    def preview(self, files: Any) -> Reply:
        return self._reply(lambda: actions.preview_svg(SchematicFiles.model_validate(files), self._settings))

    def save(self, body: Any) -> Reply:
        return self._reply(lambda: actions.save(SaveFilesRequest.model_validate(body), self._settings, self._current_session()))

    def place(self, files: Any) -> Reply:
        return self._reply(lambda: actions.place(SchematicFiles.model_validate(files)))

    def export(self, body: Any) -> Reply:
        return self._reply(lambda: actions.export(ExportRequest.model_validate(body), self._settings))

    # --- internals ------------------------------------------------------------------------

    def _current_session(self) -> KiCadSession:
        """The project from the latest KiCad button click (the plugin writes it; see app/instance.py)."""
        if self._state_dir is not None:
            try:
                self._session = KiCadSession.model_validate(instance.read_session(self._state_dir))
            except ValidationError as exc:
                logger.warning("ignoring a bad session file: %s", exc)
        return self._session

    def _reply(self, call: Callable[[], object]) -> Reply:
        try:
            result = call()
        except ValidationError as exc:
            problems = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" if e["loc"] else e["msg"] for e in exc.errors())
            return {"ok": False, "status": 422, "detail": f"The request was rejected: {problems}"}
        except GenerationError as exc:
            return {"ok": False, "status": 422, "detail": str(exc)}
        except ActionError as exc:
            return {"ok": False, "status": exc.status, "detail": str(exc)}
        except Exception:  # never let one call take the window down
            logger.exception("bridge call failed")
            return {"ok": False, "status": 500, "detail": "Something went wrong in the engine. See the CircuitForge log for details."}
        data = result.model_dump(mode="json") if isinstance(result, BaseModel) else result
        return {"ok": True, "data": data}
