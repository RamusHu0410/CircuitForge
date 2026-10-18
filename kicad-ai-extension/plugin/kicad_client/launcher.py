"""Open generated files for the user (Schematic Editor or file browser)."""

from __future__ import annotations

import logging
import os
import platform
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def _mac_schematic_editor_app(eeschema_path: str | None) -> Path | None:
    """KiCad on macOS ships 'Schematic Editor.app' next to 'KiCad.app'."""
    candidates = []
    if eeschema_path:
        for parent in Path(eeschema_path).parents:
            if parent.suffix == ".app":
                candidates.append(parent.parent / "Schematic Editor.app")
                break
    candidates.append(Path("/Applications/KiCad/Schematic Editor.app"))
    return next((c for c in candidates if c.exists()), None)


def open_schematic(path: Path, eeschema_path: str | None = None) -> str | None:
    """Open `path` in KiCad's standalone Schematic Editor. Returns an error message, or None."""
    try:
        if platform.system() == "Darwin":
            app = _mac_schematic_editor_app(eeschema_path)
            command = ["open", "-a", str(app), str(path)] if app else ["open", str(path)]
            subprocess.Popen(command)
        elif eeschema_path and Path(eeschema_path).exists():
            subprocess.Popen([eeschema_path, str(path)])
        elif platform.system() == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError as exc:
        logger.warning("could not open %s: %s", path, exc)
        return f"Could not open the schematic: {exc}"
    return None


def reveal(path: Path) -> str | None:
    """Show the file in Finder/Explorer/the file manager."""
    try:
        if platform.system() == "Darwin":
            subprocess.Popen(["open", "-R", str(path)])
        elif platform.system() == "Windows":
            subprocess.Popen(["explorer", "/select,", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    except OSError as exc:
        return f"Could not open the folder: {exc}"
    return None
