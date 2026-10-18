"""Facts about the local KiCad install: version, settings folder, and the user's color theme.

The CircuitForge UI follows the user's KiCad schematic colors. KiCad stores the active theme
name in `<settings>/<version>/eeschema.json` (`appearance.color_theme`) and user themes in
`<settings>/<version>/colors/<name>.json`. Built-in themes (names starting with `_builtin`)
are compiled into KiCad and have no file; the UI's own defaults already match KiCad's default.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# KiCad theme key (section "schematic") -> CSS variable used by the frontend's schematic drawings.
THEME_TO_CSS = {
    "background": "--kc-bg",
    "wire": "--kc-wire",
    "component_outline": "--kc-sym",
    "component_body": "--kc-body",
    "reference": "--kc-text",
    "label_local": "--kc-label",
}

# KiCad writes colors as "rgb(r, g, b)" or "rgba(r, g, b, a)". Nothing else is passed to CSS.
_COLOR = re.compile(r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$")
_VERSION_DIR = re.compile(r"^\d+(\.\d+)*$")


def kicad_version(kicad_cli: str | None, timeout_s: float = 10.0) -> str | None:
    if not kicad_cli:
        return None
    try:
        result = subprocess.run([kicad_cli, "version"], capture_output=True, text=True, timeout=timeout_s)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[-1] if result.returncode == 0 and lines else None


def settings_roots() -> list[Path]:
    home = Path.home()
    system = platform.system()
    if system == "Darwin":
        return [home / "Library" / "Preferences" / "kicad"]
    if system == "Windows":
        return [Path(os.environ.get("APPDATA", home / "AppData" / "Roaming")) / "kicad"]
    config = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
    return [config / "kicad", home / ".var" / "app" / "org.kicad.KiCad" / "config" / "kicad"]


def _version_key(path: Path) -> tuple[int, ...]:
    return tuple(int(part) for part in path.name.split("."))


def latest_settings_dir(roots: list[Path] | None = None) -> Path | None:
    """The newest `<root>/<version>` folder that contains an eeschema.json."""
    found: list[Path] = []
    for root in roots if roots is not None else settings_roots():
        if root.is_dir():
            found += [p for p in root.iterdir() if p.is_dir() and _VERSION_DIR.match(p.name) and (p / "eeschema.json").is_file()]
    return max(found, key=_version_key) if found else None


def active_theme_name(settings_dir: Path) -> str | None:
    try:
        data = json.loads((settings_dir / "eeschema.json").read_text(encoding="utf-8"))
        name = data.get("appearance", {}).get("color_theme")
    except (OSError, ValueError, AttributeError):
        return None
    return name if isinstance(name, str) and name else None


def theme_css_vars(settings_dir: Path | None) -> dict[str, str]:
    """CSS variable overrides for the user's color theme; empty for built-in themes."""
    if settings_dir is None:
        return {}
    name = active_theme_name(settings_dir)
    if not name or name.startswith("_builtin") or "/" in name or "\\" in name or name.startswith("."):
        return {}
    try:
        theme = json.loads((settings_dir / "colors" / f"{name}.json").read_text(encoding="utf-8"))
        schematic = theme.get("schematic", {})
    except (OSError, ValueError, AttributeError):
        logger.info("could not read KiCad color theme %r", name)
        return {}
    return {
        css: value
        for key, css in THEME_TO_CSS.items()
        if isinstance(value := schematic.get(key), str) and _COLOR.match(value)
    }
