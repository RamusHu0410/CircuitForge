"""Write generated files to disk without ever overwriting anything.

Each generation gets its own folder containing a standalone KiCad project:
    <project dir>/ai_generated/<name>/<name>.kicad_sch
    <project dir>/ai_generated/<name>/<name>.kicad_pro
If that folder exists, `<name>_2`, `<name>_3`, ... is used instead.
Without an open KiCad project, files go to ~/Documents/KiCad/ai_generated/.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

SAFE_NAME = re.compile(r"^[a-z0-9_]{1,48}$")
OUTPUT_FOLDER = "ai_generated"


class OutputError(Exception):
    """User-facing message."""


@dataclass(frozen=True)
class WrittenFiles:
    folder: Path
    schematic: Path
    project: Path


def default_base_dir(project_dir: str | None) -> Path:
    if project_dir and Path(project_dir).is_dir():
        return Path(project_dir) / OUTPUT_FOLDER
    return Path.home() / "Documents" / "KiCad" / OUTPUT_FOLDER


def write_generated_project(base_dir: Path, name: str, schematic: str, project: str) -> WrittenFiles:
    # The name comes from the backend; never let it escape the output folder.
    if not SAFE_NAME.match(name):
        raise OutputError(f"The backend returned an unsafe file name: {name!r}")
    if not schematic.startswith("(kicad_sch"):
        raise OutputError("The backend did not return a KiCad schematic.")

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
            # The project file name must match the schematic; rename references accordingly.
            project_text = project.replace(f'"{name}.kicad_pro"', f'"{folder_name}.kicad_pro"')
            schematic_text = schematic.replace(f'(project "{name}"', f'(project "{folder_name}"')
            with open(sch, "x", encoding="utf-8") as handle:
                handle.write(schematic_text)
            with open(pro, "x", encoding="utf-8") as handle:
                handle.write(project_text)
            return WrittenFiles(folder=folder, schematic=sch, project=pro)
    except OSError as exc:
        raise OutputError(f"Could not save the schematic in {base_dir}: {exc.strerror or exc}") from None
    raise OutputError(f"Too many generated designs named '{name}' in {base_dir}.")
