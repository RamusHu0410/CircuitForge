"""Open a saved schematic in KiCad's Schematic Editor."""

from __future__ import annotations

import logging
import os
import platform
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def _mac_editor_app(kicad_cli: str | None) -> Path | None:
    """On macOS, 'Schematic Editor.app' sits next to 'KiCad.app' in the install folder."""
    candidates: list[Path] = []
    if kicad_cli:
        for parent in Path(kicad_cli).parents:
            if parent.suffix == ".app":
                candidates.append(parent.parent / "Schematic Editor.app")
                break
    candidates.append(Path("/Applications/KiCad/Schematic Editor.app"))
    return next((c for c in candidates if c.exists()), None)


def open_in_schematic_editor(path: Path, kicad_cli: str | None = None) -> str | None:
    """Open `path` in KiCad. Returns an error message, or None on success.

    Arguments are passed as a list (never through a shell), and `path` is a file
    this backend just created.
    """
    try:
        system = platform.system()
        if system == "Darwin":
            app = _mac_editor_app(kicad_cli)
            subprocess.Popen(["open", "-a", str(app), str(path)] if app else ["open", str(path)])
        elif system == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError as exc:
        logger.warning("could not open %s: %s", path, exc)
        return f"Saved, but could not open KiCad: {exc}"
    return None


def reveal_folder(path: Path) -> str | None:
    """Show a folder in Finder / Explorer / the file manager. Returns an error message, or None."""
    try:
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", str(path)])
        elif system == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError as exc:
        return f"Exported, but could not open the folder: {exc}"
    return None


def open_project(project: Path, kicad_cli: str | None = None) -> str | None:
    """Open a .kicad_pro in KiCad's project manager (needed for Update PCB from Schematic)."""
    try:
        system = platform.system()
        if system == "Darwin":
            app = _mac_editor_app(kicad_cli)
            kicad = app.parent / "KiCad.app" if app else None
            subprocess.Popen(["open", "-a", str(kicad), str(project)] if kicad and kicad.exists() else ["open", str(project)])
        elif system == "Windows":
            os.startfile(str(project))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(project)])
    except OSError as exc:
        return f"Saved, but could not open KiCad: {exc}"
    return None
