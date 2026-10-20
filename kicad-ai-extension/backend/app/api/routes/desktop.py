"""Endpoints for the CircuitForge window when it is served by this backend (browser, `npm run dev`).

The window opened from KiCad doesn't use these: it calls the same actions (app/actions.py) through
the in-process bridge (app/bridge.py). Here the UI is loaded from this backend, so every call is
same-origin and no CORS setup is needed. `/desktop/open` lets a plugin configured with a backend URL
open the window with what it knows about the user's session (KiCad version, open project).
Everything here is local-only state for a single user on 127.0.0.1.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict

from app import actions
from app.actions import (
    ActionError,
    DesktopInfo,
    ExportRequest,
    ExportResponse,
    KiCadSession,
    PlaceResponse,
    SaveFilesRequest,
    SaveFilesResponse,
)
from app.config import Settings, get_settings
from app.schemas.circuit import SchematicFiles

router = APIRouter(prefix="/desktop", tags=["desktop window"])
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[3]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.session = KiCadSession()
        self.window: subprocess.Popen[bytes] | None = None
        self.focus_seq = 0  # bumped to ask an already-open window to come to the front

    def window_open(self) -> bool:
        return self.window is not None and self.window.poll() is None


STATE = _State()


def _http_error(exc: ActionError) -> HTTPException:
    return HTTPException(exc.status, str(exc))


# --- info / window -------------------------------------------------------------------


@router.get("/info", response_model=DesktopInfo, summary="KiCad + session info for the window")
def info(settings: SettingsDep) -> DesktopInfo:
    return actions.desktop_info(settings, STATE.session, STATE.focus_seq)


class OpenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    context: KiCadSession | None = None


class OpenResponse(BaseModel):
    launched: bool
    already_open: bool


@router.post("/open", response_model=OpenResponse, summary="Open (or bring forward) the CircuitForge window")
def open_window(request: Request, body: OpenRequest | None = None) -> OpenResponse:
    with STATE.lock:
        if body and body.context:
            STATE.session = body.context
        if STATE.window_open():
            STATE.focus_seq += 1
            return OpenResponse(launched=False, already_open=True)
        url = str(request.base_url)
        try:
            # Same interpreter as this backend (its venv has pywebview); arguments as a list, no shell.
            STATE.window = subprocess.Popen([sys.executable, "-m", "app.desktop", "--url", url], cwd=BACKEND_DIR)
        except OSError as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Could not open the window: {exc}") from exc
        logger.info("opened CircuitForge window (pid %s) for %s", STATE.window.pid, STATE.session.project_name)
        return OpenResponse(launched=True, already_open=False)


# --- actions on a generated circuit -------------------------------------------------------


@router.post(
    "/preview",
    summary="Draw a generated schematic as SVG (KiCad's own renderer)",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}},
)
def preview(files: SchematicFiles, settings: SettingsDep) -> Response:
    try:
        return Response(content=actions.preview_svg(files, settings), media_type="image/svg+xml")
    except ActionError as exc:
        raise _http_error(exc) from exc


@router.post("/save", response_model=SaveFilesResponse, summary="Save as a new project next to the open one")
def save(body: SaveFilesRequest, settings: SettingsDep) -> SaveFilesResponse:
    try:
        return actions.save(body, settings, STATE.session)
    except ActionError as exc:
        raise _http_error(exc) from exc


@router.post("/place", response_model=PlaceResponse, summary="Copy the circuit so it can be pasted into your schematic")
def place(files: SchematicFiles) -> PlaceResponse:
    try:
        return actions.place(files)
    except ActionError as exc:
        raise _http_error(exc) from exc


@router.post("/export", response_model=ExportResponse, summary="Export pictures of the schematic, the code and the KiCad project")
def export(body: ExportRequest, settings: SettingsDep) -> ExportResponse:
    try:
        return actions.export(body, settings)
    except ActionError as exc:
        raise _http_error(exc) from exc
