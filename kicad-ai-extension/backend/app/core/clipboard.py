"""Put a generated circuit on the system clipboard so it can be pasted into an open schematic.

KiCad's Schematic Editor pastes clipboard text that holds schematic items (the
same format it writes when you copy): `(lib_symbols ...)` followed by
`(symbol ...)`, `(wire ...)`, and so on, without the `(kicad_sch ...)` file
wrapper. This lets the user drop a generated circuit straight into the
schematic they have open (Cmd/Ctrl+V, then click to place) without this
backend ever writing to their files.
"""

from __future__ import annotations

import platform
import shutil
import subprocess

from app.core.sexpr import dumps, head, loads

# Top-level items that describe the file itself, not the circuit.
_FILE_LEVEL = {
    "version",
    "generator",
    "generator_version",
    "uuid",
    "paper",
    "title_block",
    "sheet_instances",
    "symbol_instances",
    "embedded_fonts",
}


class ClipboardError(RuntimeError):
    """User-facing message."""


def schematic_items(schematic_text: str) -> str:
    """Return the circuit items of a .kicad_sch document in KiCad's clipboard format."""
    doc = loads(schematic_text)
    if head(doc) != "kicad_sch":
        raise ClipboardError("Not a KiCad schematic.")
    items = [c for c in doc[1:] if isinstance(c, list) and head(c) not in _FILE_LEVEL]
    return "\n".join(dumps(item) for item in items) + "\n"


def wrap_as_schematic(items_text: str, version: int = 20250114) -> str:
    """Inverse of `schematic_items`, used by tests to check the snippet is still a valid schematic."""
    return f'(kicad_sch\n\t(version {version})\n\t(generator "eeschema")\n\t(paper "A4")\n{items_text})\n'


def copy_text(text: str) -> None:
    system = platform.system()
    if system == "Darwin":
        command = ["pbcopy"]
    elif system == "Windows":
        command = ["clip"]
    elif shutil.which("wl-copy"):
        command = ["wl-copy"]
    elif shutil.which("xclip"):
        command = ["xclip", "-selection", "clipboard"]
    else:
        raise ClipboardError("No clipboard tool found (install wl-copy or xclip).")
    try:
        subprocess.run(command, input=text.encode("utf-8"), check=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ClipboardError(f"Could not copy to the clipboard: {exc}") from exc


__all__ = ["ClipboardError", "copy_text", "schematic_items", "wrap_as_schematic"]
