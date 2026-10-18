"""Endpoints for the CircuitForge desktop window.

The window (app/desktop.py) loads the UI from this backend, so every call is
same-origin and no CORS setup is needed. The KiCad plugin calls `/desktop/open`
with what it knows about the user's session (KiCad version, open project).
Everything here is local-only state for a single user on 127.0.0.1.
"""

from __future__ import annotations

import base64
import binascii
import logging
import subprocess
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.core.clipboard import ClipboardError, copy_text, schematic_items
from app.core.erc import find_kicad_cli
from app.core.launcher import open_in_schematic_editor, open_project, reveal_folder
from app.core.output_writer import OutputError, resolve_output_dir, write_empty_board, write_project, write_sketch
from app.core.preview import PreviewError, export_pdf, export_svg
from app.schemas.circuit import Firmware, SchematicFiles, ShortText

router = APIRouter(prefix="/desktop", tags=["desktop window"])
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[3]


class KiCadSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kicad_version: ShortText | None = None
    project_name: ShortText | None = None
    project_dir: Annotated[str, Field(max_length=1000)] | None = None


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.session = KiCadSession()
        self.window: subprocess.Popen[bytes] | None = None
        self.focus_seq = 0  # bumped to ask an already-open window to come to the front

    def window_open(self) -> bool:
        return self.window is not None and self.window.poll() is None


STATE = _State()


@lru_cache
def _cli_version(cli: str) -> str | None:
    try:
        out = subprocess.run([cli, "version"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip().splitlines()[-1] if out.returncode == 0 and out.stdout.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def _project_dir() -> Path | None:
    d = STATE.session.project_dir
    if d and Path(d).is_absolute() and Path(d).is_dir():
        return Path(d)
    return None


# --- info / window -------------------------------------------------------------------


class DesktopInfo(BaseModel):
    kicad_found: bool
    kicad_version: str | None
    project_name: str | None
    project_dir: str | None
    opened_from_kicad: bool
    save_dir: str
    focus_seq: int


@router.get("/info", response_model=DesktopInfo, summary="KiCad + session info for the window")
def info(settings: Annotated[Settings, Depends(get_settings)]) -> DesktopInfo:
    cli = find_kicad_cli(settings.kicad_cli_path)
    project = _project_dir()
    return DesktopInfo(
        kicad_found=cli is not None,
        kicad_version=STATE.session.kicad_version or (_cli_version(cli) if cli else None),
        project_name=STATE.session.project_name,
        project_dir=str(project) if project else None,
        opened_from_kicad=STATE.session.kicad_version is not None,
        save_dir=str(project / "ai_generated" if project else resolve_output_dir(settings.output_dir)),
        focus_seq=STATE.focus_seq,
    )


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
def preview(files: SchematicFiles, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    try:
        svg = export_svg(files, find_kicad_cli(settings.kicad_cli_path))
    except PreviewError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return Response(content=svg, media_type="image/svg+xml")


class SaveFilesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: SchematicFiles
    firmware: Firmware | None = None
    open_in_kicad: bool = True
    # "schematic": open the Schematic Editor. "pcb": also add an empty board and open the project in
    # KiCad, so the user can open the board and press F8 (Update PCB from Schematic).
    open_as: Literal["schematic", "pcb"] = "schematic"


class SaveFilesResponse(BaseModel):
    folder: str
    schematic_path: str
    firmware_path: str | None = None
    board_path: str | None = None
    opened_in_kicad: bool
    open_error: str | None = None


@router.post("/save", response_model=SaveFilesResponse, summary="Save as a new project next to the open one")
def save(body: SaveFilesRequest, settings: Annotated[Settings, Depends(get_settings)]) -> SaveFilesResponse:
    project = _project_dir()
    base = project / "ai_generated" if project else resolve_output_dir(settings.output_dir)
    try:
        written = write_project(base, body.files)
        sketch = write_sketch(written.folder, body.firmware) if body.firmware else None
        board = write_empty_board(written) if body.open_as == "pcb" else None
    except OutputError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    open_error = None
    if body.open_in_kicad:
        cli = find_kicad_cli(settings.kicad_cli_path)
        open_error = open_project(written.project, cli) if body.open_as == "pcb" else open_in_schematic_editor(written.schematic, cli)
    return SaveFilesResponse(
        folder=str(written.folder),
        schematic_path=str(written.schematic),
        firmware_path=str(sketch) if sketch else None,
        board_path=str(board) if board else None,
        opened_in_kicad=body.open_in_kicad and open_error is None,
        open_error=open_error,
    )


class PlaceResponse(BaseModel):
    copied: bool
    symbols: int
    message: str


@router.post("/place", response_model=PlaceResponse, summary="Copy the circuit so it can be pasted into your schematic")
def place(files: SchematicFiles) -> PlaceResponse:
    try:
        items = schematic_items(files.schematic)
        copy_text(items)
    except ClipboardError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    symbols = items.count("\n(symbol\n") + (1 if items.startswith("(symbol\n") else 0)
    return PlaceResponse(
        copied=True,
        symbols=symbols,
        message="Copied. In KiCad's Schematic Editor press Cmd+V (Ctrl+V), then click to drop the circuit.",
    )


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: SchematicFiles
    firmware: Firmware | None = None
    png_base64: Annotated[str, Field(max_length=30_000_000)] | None = Field(
        default=None, description="The schematic as PNG, rendered by the window (kicad-cli can't make PNGs)"
    )
    reveal: bool = True


class ExportResponse(BaseModel):
    folder: str
    files: list[str]
    skipped: list[str] = []
    reveal_error: str | None = None


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@router.post("/export", response_model=ExportResponse, summary="Export pictures of the schematic, the code and the KiCad project")
def export(body: ExportRequest, settings: Annotated[Settings, Depends(get_settings)]) -> ExportResponse:
    base = Path(settings.export_dir).expanduser() if settings.export_dir else Path.home() / "Downloads" / "CircuitForge"
    cli = find_kicad_cli(settings.kicad_cli_path)
    try:
        written = write_project(base, body.files)  # new folder, never overwrites
    except OutputError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    folder = written.folder
    out = [written.schematic, written.project]
    skipped: list[str] = []

    for suffix, make in ((".svg", lambda: export_svg(body.files, cli).encode("utf-8")), (".pdf", lambda: export_pdf(body.files, cli))):
        try:
            path = folder / f"{folder.name}{suffix}"
            path.write_bytes(make())
            out.append(path)
        except (PreviewError, OSError) as exc:
            skipped.append(f"{suffix[1:].upper()}: {exc}")

    if body.png_base64:
        try:
            png = base64.b64decode(body.png_base64.split(",", 1)[-1], validate=True)
            if not png.startswith(_PNG_SIGNATURE):
                raise ValueError("not a PNG")
            path = folder / f"{folder.name}.png"
            path.write_bytes(png)
            out.append(path)
        except (binascii.Error, ValueError, OSError) as exc:
            skipped.append(f"PNG: {exc}")

    if body.firmware:
        try:
            out.append(write_sketch(folder, body.firmware))
        except OutputError as exc:
            skipped.append(f"code: {exc}")

    reveal_error = reveal_folder(folder) if body.reveal else None
    logger.info("exported %d files to %s", len(out), folder)
    return ExportResponse(folder=str(folder), files=[str(p) for p in out], skipped=skipped, reveal_error=reveal_error)
