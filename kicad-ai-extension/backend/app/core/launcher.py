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
