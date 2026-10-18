"""Facts about the local KiCad install.

The CircuitForge UI keeps its own colors (Settings in the UI), so KiCad's color theme is not read.
"""

from __future__ import annotations

import subprocess


def kicad_version(kicad_cli: str | None, timeout_s: float = 10.0) -> str | None:
    if not kicad_cli:
        return None
    try:
        result = subprocess.run([kicad_cli, "version"], capture_output=True, text=True, timeout=timeout_s)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[-1] if result.returncode == 0 and lines else None
