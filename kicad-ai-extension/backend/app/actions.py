"""What the CircuitForge window can do with a generated circuit, without any web framework.

Shared by the HTTP routes (app/api/routes/desktop.py: the browser and `npm run dev`) and the in-process
bridge (app/bridge.py: the window opened from KiCad, no server). Failures raise `ActionError` with a
user-facing message and the HTTP status the routes answer with.
"""

from __future__ import annotations

import base64
import binascii
import logging
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.core.clipboard import ClipboardError, copy_text, schematic_items
from app.core.erc import find_kicad_cli
from app.core.launcher import open_in_schematic_editor, open_project, reveal_folder
from app.core.output_writer import OutputError, resolve_output_dir, write_empty_board, write_project, write_sketch
from app.core.preview import PreviewError, export_pdf, export_svg
from app.schemas.circuit import Firmware, SchematicFiles, ShortText

logger = logging.getLogger(__name__)


class ActionError(Exception):
    """`str(error)` is shown to the user; `status` is the HTTP status the routes reply with."""

    def __init__(self, message: str, status: int = 500) -> None:
        super().__init__(message)
        self.status = status


class KiCadSession(BaseModel):
    """What the KiCad plugin knows when its button is clicked (the open project decides where saves go)."""

    model_config = ConfigDict(extra="forbid")

    kicad_version: ShortText | None = None
    project_name: ShortText | None = None
    project_dir: Annotated[str, Field(max_length=1000)] | None = None


@lru_cache
def _cli_version(cli: str) -> str | None:
    try:
        out = subprocess.run([cli, "version"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip().splitlines()[-1] if out.returncode == 0 and out.stdout.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def project_dir(session: KiCadSession) -> Path | None:
    d = session.project_dir
    if d and Path(d).is_absolute() and Path(d).is_dir():
        return Path(d)
    return None


# --- info -------------------------------------------------------------------------------


class DesktopInfo(BaseModel):
    kicad_found: bool
    kicad_version: str | None
    project_name: str | None
    project_dir: str | None
    opened_from_kicad: bool
    save_dir: str
    focus_seq: int = 0


def desktop_info(settings: Settings, session: KiCadSession, focus_seq: int = 0) -> DesktopInfo:
    cli = find_kicad_cli(settings.kicad_cli_path)
    project = project_dir(session)
    return DesktopInfo(
        kicad_found=cli is not None,
        kicad_version=session.kicad_version or (_cli_version(cli) if cli else None),
        project_name=session.project_name,
        project_dir=str(project) if project else None,
        opened_from_kicad=session.kicad_version is not None,
        save_dir=str(project / "ai_generated" if project else resolve_output_dir(settings.output_dir)),
        focus_seq=focus_seq,
    )


# --- preview ----------------------------------------------------------------------------


def preview_svg(files: SchematicFiles, settings: Settings) -> str:
    try:
        return export_svg(files, find_kicad_cli(settings.kicad_cli_path))
    except PreviewError as exc:
        raise ActionError(str(exc), 503) from exc


# --- save -------------------------------------------------------------------------------


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


def save(body: SaveFilesRequest, settings: Settings, session: KiCadSession) -> SaveFilesResponse:
    project = project_dir(session)
    base = project / "ai_generated" if project else resolve_output_dir(settings.output_dir)
    try:
        written = write_project(base, body.files)
        sketch = write_sketch(written.folder, body.firmware) if body.firmware else None
        board = write_empty_board(written) if body.open_as == "pcb" else None
    except OutputError as exc:
        raise ActionError(str(exc)) from exc
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


# --- place ------------------------------------------------------------------------------


class PlaceResponse(BaseModel):
    copied: bool
    symbols: int
    message: str


def place(files: SchematicFiles) -> PlaceResponse:
    try:
        items = schematic_items(files.schematic)
        copy_text(items)
    except ClipboardError as exc:
        raise ActionError(str(exc)) from exc
    symbols = items.count("\n(symbol\n") + (1 if items.startswith("(symbol\n") else 0)
    return PlaceResponse(
        copied=True,
        symbols=symbols,
        message="Copied. In KiCad's Schematic Editor press Cmd+V (Ctrl+V), then click to drop the circuit.",
    )


# --- export -----------------------------------------------------------------------------


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


def export(body: ExportRequest, settings: Settings) -> ExportResponse:
    base = Path(settings.export_dir).expanduser() if settings.export_dir else Path.home() / "Downloads" / "CircuitForge"
    cli = find_kicad_cli(settings.kicad_cli_path)
    try:
        written = write_project(base, body.files)  # new folder, never overwrites
    except OutputError as exc:
        raise ActionError(str(exc)) from exc
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
