"""Save generated files to disk without ever overwriting anything.

Each save gets its own folder containing a standalone KiCad project:
    <output dir>/<name>/<name>.kicad_sch
    <output dir>/<name>/<name>.kicad_pro
If that folder exists, `<name>_2`, `<name>_3`, ... is used instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.schemas.circuit import SchematicFiles

SAFE_NAME = re.compile(r"^[a-z0-9_]{1,48}$")


class OutputError(Exception):
    """User-facing message."""


@dataclass(frozen=True)
class WrittenFiles:
    folder: Path
    schematic: Path
    project: Path


def default_output_dir() -> Path:
    return Path.home() / "Documents" / "KiCad" / "ai_generated"


def resolve_output_dir(configured: str | None) -> Path:
    return Path(configured).expanduser() if configured else default_output_dir()


def write_project(base_dir: Path, files: SchematicFiles) -> WrittenFiles:
    name = files.name
    if not SAFE_NAME.match(name):  # defense in depth: the name is derived from user text
        raise OutputError(f"Unsafe file name: {name!r}")

    try:
        base_dir.mkdir(parents=True, exist_ok=True)
        for attempt in range(1, 1000):
            folder_name = name if attempt == 1 else f"{name}_{attempt}"
            folder = base_dir / folder_name
            try:
                folder.mkdir()  # atomic: fails if it already exists
            except FileExistsError:
                continue
            sch = folder / f"{folder_name}.kicad_sch"
            pro = folder / f"{folder_name}.kicad_pro"
            # File names inside the documents must match the folder name used on disk.
            project_text = files.project.replace(f'"{name}.kicad_pro"', f'"{folder_name}.kicad_pro"')
            schematic_text = files.schematic.replace(f'(project "{name}"', f'(project "{folder_name}"')
            with open(sch, "x", encoding="utf-8") as handle:
                handle.write(schematic_text)
            with open(pro, "x", encoding="utf-8") as handle:
                handle.write(project_text)
            return WrittenFiles(folder=folder, schematic=sch, project=pro)
    except OSError as exc:
        raise OutputError(f"Could not save in {base_dir}: {exc.strerror or exc}") from None
    raise OutputError(f"Too many saved designs named '{name}' in {base_dir}.")
